import { config } from "./config.js";
import { store } from "./store.js";
import { categories } from "./providers/base.js";
import { providerFor, syncAllProviders } from "./providers/index.js";
import { buildProductListPdf } from "./pdf.js";
import { logger } from "./logger.js";

const PAGE_SIZE = 20;
const SEARCH_PAGE_SIZE = 20;
const money = (amount) => `${Number(amount || 0).toLocaleString()} MMK`;
const usdt = (amount) => `${Number(amount || 0).toFixed(2)} USDT`;
const esc = (text) => String(text ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Short key mapping for callback_data (Telegram limits to 64 bytes).
// We assign short numeric IDs to strings (family names, regions, search queries).
const keyMap = new Map(); // short key -> original string
const reverseMap = new Map(); // original string -> short key
let nextKey = 1;
function encodeData(value) {
  const str = String(value);
  if (reverseMap.has(str)) return reverseMap.get(str);
  const key = String(nextKey++);
  keyMap.set(key, str);
  reverseMap.set(str, key);
  return key;
}
function decodeData(key) {
  return keyMap.get(String(key)) || String(key);
}

// Safety wrapper to ensure callback_data never exceeds Telegram's 64-byte limit.
function safeCallback(data) {
  const bytes = Buffer.byteLength(data, "utf8");
  if (bytes > 64) {
    logger.warn("Callback data exceeds 64 bytes", { data, bytes });
    // Truncate and add error marker - this should never happen with proper encoding
    return data.slice(0, 60) + ":err";
  }
  return data;
}

function utcStamp(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

class TelegramBot {
  constructor(token, name) {
    this.token = token;
    this.name = name;
    this.offset = 0;
    this.running = false;
  }

  get active() { return Boolean(this.token); }

  async api(method, body) {
    if (!this.active) return null;
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} failed`);
    return data.result;
  }

  async apiMultipart(method, form) {
    if (!this.active) return null;
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} failed`);
    return data.result;
  }

  sendMessage(chatId, text, extra = {}) { return this.api("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }); }
  sendPhoto(chatId, photo, extra = {}) { return this.api("sendPhoto", { chat_id: chatId, photo, parse_mode: "HTML", ...extra }); }
  sendDocument(chatId, document, extra = {}) { return this.api("sendDocument", { chat_id: chatId, document, parse_mode: "HTML", ...extra }); }
  async sendPdf(chatId, buffer, filename, caption = "") {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
    form.append("document", new Blob([buffer], { type: "application/pdf" }), filename);
    return this.apiMultipart("sendDocument", form);
  }
  async editMessage(chatId, messageId, text, extra = {}) {
    try { return await this.api("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }); }
    catch (error) { if (String(error.message || "").includes("message is not modified")) return null; throw error; }
  }
  answerCallback(id, text = "") { return this.api("answerCallbackQuery", { callback_query_id: id, text, show_alert: false }).catch(() => {}); }

  async start(handler) {
    if (!this.active) { logger.warn(`${this.name} token missing`); return; }
    this.running = true;
    await this.api("setMyCommands", { commands: [
      { command: "menu", description: "Menu" },
      { command: "account", description: "View Account" },
      { command: "search", description: "Search products" },
      { command: "pricelist", description: "Get PDF price list" },
      { command: "pay", description: "Top Up" },
      { command: "apidocs", description: "API Docs" },
      { command: "apikey", description: "Create API Key" }
    ] }).catch(() => {});
    logger.info(`${this.name} bot started`);
    while (this.running) {
      try {
        const updates = await this.api("getUpdates", { offset: this.offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
        for (const update of updates || []) {
          this.offset = update.update_id + 1;
          await handler(update, this).catch((error) => logger.error(`${this.name} update failed`, { message: error.message }));
        }
      } catch (error) {
        logger.warn(`${this.name} polling failed`, { message: error.message });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

const userStates = new Map();
const adminStates = new Map();
const customerBot = new TelegramBot(config.customerBotToken, "customer");
const paymentBot = new TelegramBot(config.paymentBotToken, "payment/admin");

function keyboard(rows) {
  // Apply safeCallback to all buttons to ensure callback_data stays under 64 bytes
  const safeRows = rows.map((row) => row.map((btn) => {
    if (btn.callback_data) return { ...btn, callback_data: safeCallback(btn.callback_data) };
    return btn;
  }));
  return { reply_markup: { inline_keyboard: safeRows } };
}

const CATEGORY_ICONS = {
  game_topups: "🎮",
  gift_cards: "🎁",
  ai_products: "🤖",
  digital_products: "📦"
};

function categoryButtons(user) {
  const rows = [
    [{ text: `🎮 ${categories.game_topups}`, callback_data: "cat:game_topups:0" }],
    [{ text: `🎁 ${categories.gift_cards}`, callback_data: "cat:gift_cards:0" }],
    [{ text: `🤖 ${categories.ai_products}`, callback_data: "cat:ai_products:0" }],
    [{ text: `📦 ${categories.digital_products}`, callback_data: "cat:digital_products:0" }]
  ];
  // Recent categories shortcut so returning users jump back where they left off.
  const recent = user ? store.recentCategories(user.id).filter((c) => categories[c]) : [];
  if (recent.length) {
    const recentRow = recent.slice(0, 3).map((c) => ({
      text: `↩️ ${CATEGORY_ICONS[c] || ""} ${String(categories[c]).split(" (")[0]}`.trim(),
      callback_data: `cat:${c}:0`
    }));
    rows.push(recentRow);
  }
  rows.push([{ text: "🔍 Search Products", callback_data: "search" }, { text: "📄 Price List (PDF)", callback_data: "pricelist" }]);
  rows.push([{ text: "👤 My Account", callback_data: "account" }, { text: "💳 Top Up", callback_data: "pay:start" }]);
  rows.push([{ text: "🔑 API Key", callback_data: "apikey" }, { text: "📚 API Docs", callback_data: "apidocs" }]);
  return keyboard(rows);
}

function welcomeText(user) {
  const contact = store.data.settings.welcomeContact || store.data.settings.contactText || config.contactText;
  const recent = store.recentCategories(user.id).filter((c) => categories[c]);
  let recentLine = "";
  if (recent.length) {
    const names = recent.slice(0, 3).map((c) => `${CATEGORY_ICONS[c] || ""} ${String(categories[c]).split(" (")[0]}`.trim()).join(" • ");
    recentLine = `\n🕘 <b>Recent:</b> ${esc(names)}`;
  }
  return `🎉 <b>${esc(config.storeName)}</b>

Welcome, ${esc(user.firstName || user.username || "customer")}!

💰 <b>Balance:</b> ${money(user.balance)}
📞 <b>Contact:</b> ${esc(contact)}${recentLine}

⚡ <i>All products are delivered instantly after purchase.</i>
Pick a category below to browse products.`;
}

async function showHome(bot, chatId, user, editMessageId = null) {
  const text = welcomeText(user);
  const buttons = categoryButtons(user);
  if (editMessageId) return bot.editMessage(chatId, editMessageId, text, buttons);
  return bot.sendMessage(chatId, text, buttons);
}

function productStatus(product) {
  if (!product) return "Unavailable";
  if (!product.enabled) return "Temporarily disabled";
  if (Number(product.stock || 0) <= 0) return "Out of stock";
  return `In stock (${product.stock})`;
}

// Builds a pager row where the callback data has the page number injected at ":PAGE:".
// If ":PAGE" is not present, the number is appended to the end (backwards compatible).
function pagerRow(base, page, totalPages) {
  if (totalPages <= 1) return [];
  const withPage = (n) => base.includes(":PAGE") ? base.replace(":PAGE", `:${n}`) : `${base}:${n}`;
  const row = [];
  if (page > 0) row.push({ text: "⬅️ Prev", callback_data: withPage(page - 1) });
  const windowStart = Math.max(0, Math.min(page - 2, totalPages - 5));
  const windowEnd = Math.min(totalPages, windowStart + 5);
  for (let i = windowStart; i < windowEnd; i++) {
    row.push({ text: i === page ? `• ${i + 1} •` : `${i + 1}`, callback_data: withPage(i) });
  }
  if (page < totalPages - 1) row.push({ text: "Next ➡️", callback_data: withPage(page + 1) });
  return row;
}

// Category -> list of product families. Order: non-G2Bulk first, then most-viewed, then cheapest.
async function showCategory(bot, chatId, category, page, editMessageId = null, user = null) {
  if (user) store.trackCategory(user.id, category);
  const families = store.families(category);
  const totalPages = Math.max(1, Math.ceil(families.length / PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = families.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const rows = slice.map((entry) => {
    const hot = entry.views >= 5 ? "🔥 " : "";
    return [{
      text: `${hot}${entry.family}  •  from ${money(entry.minPrice || 0)}  •  ${entry.inStock ? "✅" : "❌"}`.slice(0, 90),
      callback_data: `grp:${category}:${encodeData(entry.family)}:0`
    }];
  });
  const pager = pagerRow(`cat:${category}`, currentPage, totalPages);
  if (pager.length) rows.push(pager);
  rows.push([{ text: "🔍 Search", callback_data: "search" }, { text: "⬅️ Menu", callback_data: "home" }]);

  const header = `<b>${esc(categories[category] || category)}</b>\nPage ${currentPage + 1} of ${totalPages}  •  ${families.length} product families\n\n<i>🔥 = trending. Sorted by popularity, then lowest price.</i>`;
  if (!families.length) {
    const emptyText = `${header}\n\n<i>No products in this category right now.</i>`;
    if (editMessageId) return bot.editMessage(chatId, editMessageId, emptyText, keyboard([[{ text: "⬅️ Menu", callback_data: "home" }]]));
    return bot.sendMessage(chatId, emptyText, keyboard([[{ text: "⬅️ Menu", callback_data: "home" }]]));
  }
  if (editMessageId) return bot.editMessage(chatId, editMessageId, header, keyboard(rows));
  return bot.sendMessage(chatId, header, keyboard(rows));
}

// Family -> region selector (if multiple regions) then package list.
async function showGroup(bot, chatId, category, familyKey, page, editMessageId = null, region = "") {
  const family = decodeData(familyKey);
  store.trackFamilyView(family);
  const regions = store.regionsForFamily(family);
  const multipleRegions = regions.length > 1;

  // If multiple regions exist and none selected yet, show region selector first.
  if (multipleRegions && !region) {
    const rows = regions.map((r) => [{ text: `🌐 ${r}  packages`, callback_data: `grp:${category}:${familyKey}:0:${encodeData(r)}` }]);
    rows.push([{ text: `📦 All regions`, callback_data: `grp:${category}:${familyKey}:0:${encodeData("__all__")}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: `cat:${category}:0` }, { text: "🏠 Menu", callback_data: "home" }]);
    const note = store.familyNote(family);
    let header = `<b>${esc(family)}</b>\n<i>Choose a region to see prices for that area.</i>`;
    if (note?.text) header += `\n\n📝 ${esc(note.text)}`;
    if (note?.image) {
      try { await bot.sendPhoto(chatId, note.image, { caption: header, ...keyboard(rows) }); return null; } catch {}
    }
    if (editMessageId) return bot.editMessage(chatId, editMessageId, header, keyboard(rows));
    return bot.sendMessage(chatId, header, keyboard(rows));
  }

  const filter = { family };
  if (region && region !== "__all__") filter.region = region;
  const products = store.products(filter).sort((a, b) => store.sellingPrice(a) - store.sellingPrice(b));
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = products.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const rows = slice.map((product) => {
    const stockDot = Number(product.stock || 0) > 0 && product.enabled ? "✅" : "❌";
    const label = `${stockDot}  ${product.name}  •  ${money(store.sellingPrice(product))}`;
    return [{ text: label.slice(0, 90), callback_data: `prod:${product.localId}` }];
  });

  // With region: grp:<cat>:<familyKey>:<page>:<regionEnc>
  // Without region: grp:<cat>:<familyKey>:<page>
  const pagerBase = region ? `grp:${category}:${familyKey}:PAGE:${encodeData(region)}` : `grp:${category}:${familyKey}:PAGE`;
  const pager = pagerRow(pagerBase, currentPage, totalPages);
  if (pager.length) rows.push(pager);

  const backRow = [];
  if (multipleRegions) backRow.push({ text: "🌐 Regions", callback_data: `grp:${category}:${familyKey}:0` });
  backRow.push({ text: "⬅️ Categories", callback_data: `cat:${category}:0` });
  backRow.push({ text: "🏠 Menu", callback_data: "home" });
  rows.push(backRow);

  const note = store.familyNote(family);
  const title = region && region !== "__all__" ? `${family}  (${region})` : family;
  let header = `<b>${esc(title)}</b>\nPage ${currentPage + 1} of ${totalPages}  •  ${products.length} packages\n\n<i>Sorted lowest to highest price. Tap a package for details.</i>`;
  if (note?.text) header += `\n\n📝 <b>Info:</b> ${esc(note.text)}`;

  if (note?.image && currentPage === 0 && !editMessageId) {
    try { await bot.sendPhoto(chatId, note.image, { caption: header, ...keyboard(rows) }); return null; } catch {}
  }
  if (editMessageId) return bot.editMessage(chatId, editMessageId, header, keyboard(rows));
  return bot.sendMessage(chatId, header, keyboard(rows));
}

// Individual product detail view -- professional layout without exposing provider name / IDs.
async function showProduct(bot, chatId, product, editMessageId = null) {
  if (!product) return bot.sendMessage(chatId, "Product not found.", keyboard([[{ text: "Menu", callback_data: "home" }]]));
  store.trackView(product);
  const stockOk = Number(product.stock || 0) > 0 && product.enabled;
  const sellingPrice = store.sellingPrice(product);
  const note = store.productNote(product);

  const lines = [];
  lines.push(`🛍️  <b>${esc(product.name)}</b>`);
  lines.push("");
  lines.push(`🏷️  <b>Category:</b> ${esc(categories[product.category] || product.category)}`);
  if (product.family) lines.push(`📂  <b>Product line:</b> ${esc(product.family)}`);
  if (product.region && product.region !== "Default") lines.push(`🌐  <b>Region:</b> ${esc(product.region)}`);
  lines.push(`🆔  <b>Item ID:</b> <code>${product.localId}</code>`);
  lines.push("");
  lines.push(`💵  <b>Price:</b> ${money(sellingPrice)}`);
  lines.push(`📦  <b>Availability:</b> ${stockOk ? `<b>${productStatus(product)}</b>` : `<i>${productStatus(product)}</i>`}`);
  if (note?.text) { lines.push(""); lines.push(`📝 <b>Info:</b>`); lines.push(esc(note.text)); }

  const buttons = [];
  if (stockOk) buttons.push([{ text: `✅ Buy for ${money(sellingPrice)}`, callback_data: `buy:${product.localId}` }]);
  else buttons.push([{ text: "⛔ Currently Unavailable", callback_data: "noop" }]);
  buttons.push([
    { text: "⬅️ Back", callback_data: `grp:${product.category}:${encodeData(product.family || "Other")}:0` },
    { text: "🏠 Menu", callback_data: "home" }
  ]);

  const text = lines.join("\n");
  if (note?.image) {
    try { await bot.sendPhoto(chatId, note.image, { caption: text, ...keyboard(buttons) }); return null; } catch {}
  }
  if (editMessageId) return bot.editMessage(chatId, editMessageId, text, keyboard(buttons));
  return bot.sendMessage(chatId, text, keyboard(buttons));
}

async function beginBuy(bot, chatId, userId, product) {
  if (!product) return bot.sendMessage(chatId, "Product not found.");
  if (!product.enabled || Number(product.stock || 0) <= 0) return bot.sendMessage(chatId, "This product is currently unavailable.");
  const sellingPrice = store.sellingPrice(product);
  const user = store.getUser(userId);
  if (!user) return bot.sendMessage(chatId, "Please send /menu first.");
  if (Number(user.balance || 0) < sellingPrice) {
    return bot.sendMessage(chatId, `❌ Not enough balance.\nPrice: <b>${money(sellingPrice)}</b>\nYour balance: ${money(user.balance)}\n\nUse Top Up to add funds.`, keyboard([[{ text: "💳 Top Up", callback_data: "pay:start" }, { text: "Menu", callback_data: "home" }]]));
  }
  // Games may require player_id or extra inputs -- if provider has validatePlayer, ask for player_id.
  if (product.type === "game_topup" && product.meta?.gameCode) {
    userStates.set(userId, { mode: "game_player_id", productLocalId: product.localId });
    return bot.sendMessage(chatId, `Send your <b>Player ID</b> to receive <b>${esc(product.name)}</b>.`);
  }
  const rows = [
    [{ text: "1", callback_data: `qty:${product.localId}:1` }, { text: "2", callback_data: `qty:${product.localId}:2` }, { text: "5", callback_data: `qty:${product.localId}:5` }],
    [{ text: "10", callback_data: `qty:${product.localId}:10` }, { text: "Custom", callback_data: `qty:${product.localId}:custom` }],
    [{ text: "❌ Cancel", callback_data: `prod:${product.localId}` }]
  ];
  return bot.sendMessage(chatId, `Confirm quantity for <b>${esc(product.name)}</b>.\nUnit price: ${money(sellingPrice)}\nStock: ${product.stock}`, keyboard(rows));
}

async function placeOrder(bot, chatId, user, product, qty, inputs = {}) {
  if (!product) return bot.sendMessage(chatId, "Product not found.");
  const quantity = Math.max(1, Math.min(Number(qty) || 1, 100));
  const unitPrice = store.sellingPrice(product);
  const baseUnit = store.basePriceMmk(product);
  const total = unitPrice * quantity;
  const baseTotal = baseUnit * quantity;
  const profit = total - baseTotal;
  const currentUser = store.getUser(user.id);
  if (!currentUser || Number(currentUser.balance || 0) < total) {
    return bot.sendMessage(chatId, `❌ Not enough balance for ${quantity} × ${esc(product.name)}.\nRequired: ${money(total)}`);
  }
  const provider = providerFor(product);
  const order = store.createOrder({ userId: user.id, productId: product.id, productName: product.name, qty: quantity, total, baseTotal, profit, status: "pending", inputs });
  try {
    store.adjustBalance(user.id, -total, `order:${order.id}`);
    let deliveryText = "Delivery pending. Support has been notified.";
    if (provider?.buy) {
      const result = await provider.buy(product, { qty: quantity, orderCode: order.id, inputs });
      deliveryText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    }
    store.updatePayment; // no-op reference to keep static analyzers quiet
    store.data.orders[order.id] = { ...store.data.orders[order.id], status: "delivered", deliveredAt: new Date().toISOString(), delivery: deliveryText };
    store.save();
    await bot.sendMessage(chatId, `✅ <b>Order ${order.id}</b> delivered.\n<b>${esc(product.name)}</b> × ${quantity}\nTotal: ${money(total)}\n\n<pre>${esc(String(deliveryText).slice(0, 3500))}</pre>`);
    await notifyAdmins(`📦 Order ${order.id}\nUser: <code>${user.id}</code>\nProduct: ${esc(product.name)}\nQty: ${quantity}\nRevenue: ${money(total)}\nProfit: ${money(profit)}`);
  } catch (error) {
    store.adjustBalance(user.id, total, `refund:${order.id}`);
    store.data.orders[order.id] = { ...store.data.orders[order.id], status: "failed", error: error.message };
    store.save();
    await bot.sendMessage(chatId, `❌ Order failed. Your balance was refunded.\nReason: ${esc(error.message)}`);
  }
}

async function showAccount(bot, chatId, user, editMessageId = null) {
  const payments = store.userPayments(user.id).slice(0, 5);
  const rows = payments.map((p) => `• <code>${p.id}</code>  ${money(p.amount)}  <b>${esc(p.status)}</b>`).join("\n") || "<i>No payment history yet.</i>";
  const text = `👤 <b>Account</b>\n\nUser ID: <code>${user.id}</code>\nBalance: <b>${money(user.balance)}</b>\n\n<b>Recent Payments:</b>\n${rows}`;
  const buttons = keyboard([
    [{ text: "💳 Top Up", callback_data: "pay:start" }, { text: "🔑 API Key", callback_data: "apikey" }],
    [{ text: "🏠 Menu", callback_data: "home" }]
  ]);
  if (editMessageId) return bot.editMessage(chatId, editMessageId, text, buttons);
  return bot.sendMessage(chatId, text, buttons);
}

async function startPayment(bot, chatId, userId, editMessageId = null) {
  const methods = store.paymentMethods();
  if (!methods.length) return bot.sendMessage(chatId, "No payment methods are configured yet.");
  userStates.set(userId, { mode: "topup_amount" });
  const text = "💳 <b>Top Up</b>\n\nSend the amount in MMK you want to add (e.g. <code>5000</code>).";
  if (editMessageId) return bot.editMessage(chatId, editMessageId, text, keyboard([[{ text: "⬅️ Menu", callback_data: "home" }]]));
  return bot.sendMessage(chatId, text, keyboard([[{ text: "⬅️ Menu", callback_data: "home" }]]));
}

async function notifyAdmins(text, extra = {}) {
  const admins = new Set([...(config.adminTelegramIds || []), ...store.data.admins]);
  for (const id of admins) { try { await paymentBot.sendMessage(id, text, extra); } catch {} }
}
async function notifyAdminsPhoto(fileId, caption = "") {
  const admins = new Set([...(config.adminTelegramIds || []), ...store.data.admins]);
  for (const id of admins) { try { await paymentBot.sendPhoto(id, fileId, { caption }); } catch {} }
}

// PDF price list -- grouped by category, item id first, then name, family, region, price. UTC 00:00 timestamp.
function generatePriceListPdf() {
  const columns = [
    { header: "ID", width: 6, align: "left" },
    { header: "Product", width: 36, align: "left" },
    { header: "Family", width: 14, align: "left" },
    { header: "Region", width: 10, align: "left" },
    { header: "Price", width: 14, align: "right" }
  ];
  const catKeys = Object.keys(categories);
  const sections = catKeys.map((cat) => {
    const products = store.products({ category: cat, sort: "family_price" });
    return {
      title: categories[cat],
      rows: products.map((p) => [
        String(p.localId),
        p.name,
        p.family || "-",
        p.region && p.region !== "Default" ? p.region : "-",
        money(store.sellingPrice(p))
      ])
    };
  }).filter((s) => s.rows.length > 0);
  const totalCount = sections.reduce((sum, s) => sum + s.rows.length, 0);
  return buildProductListPdf({
    title: config.storeName || "Product Price List",
    subtitle: "Full product catalogue -- search by ID inside the bot",
    generatedAt: utcStamp(),
    columns,
    sections,
    footer: `Total products: ${totalCount}. Timestamps are UTC 00:00.`
  });
}

async function sendPriceListPdf(bot, chatId) {
  const buffer = generatePriceListPdf();
  const stamp = utcStamp().replace(/[: ]/g, "-");
  await bot.sendPdf(chatId, buffer, `price-list-${stamp}.pdf`, `📄 <b>Price list</b>\nGenerated ${esc(utcStamp())}\nUse <code>/search &lt;id&gt;</code> or the Search button to find a product.`);
}

async function runSearch(bot, chatId, user, query, page = 0, editMessageId = null) {
  const q = String(query || "").trim();
  if (!q) return bot.sendMessage(chatId, "Send a keyword or product ID after /search.");
  // Direct ID lookup
  const numeric = /^\d+$/.test(q) ? store.productByLocalId(q) : null;
  if (numeric) return showProduct(bot, chatId, numeric);

  // Get all matching products, then group by family so user sees family buttons first.
  const allMatches = store.products({ search: q, sort: "price" });
  if (!allMatches.length) return bot.sendMessage(chatId, `No products matched "<b>${esc(q)}</b>".`, keyboard([[{ text: "🏠 Menu", callback_data: "home" }]]));

  // Build family groups from matches.
  const familyMap = new Map();
  for (const p of allMatches) {
    const fam = p.family || "Other";
    if (!familyMap.has(fam)) familyMap.set(fam, { family: fam, count: 0, minPrice: Infinity, category: p.category });
    const entry = familyMap.get(fam);
    entry.count++;
    entry.minPrice = Math.min(entry.minPrice, store.sellingPrice(p));
  }
  const families = [...familyMap.values()].sort((a, b) => a.family.localeCompare(b.family));

  // If only 1 family matched, jump straight to that family's packages.
  if (families.length === 1) {
    const fam = families[0];
    return showGroup(bot, chatId, fam.category, encodeData(fam.family), 0, editMessageId);
  }

  // Multiple families: paginate the family list at 20 per page.
  const totalPages = Math.max(1, Math.ceil(families.length / SEARCH_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = families.slice(currentPage * SEARCH_PAGE_SIZE, currentPage * SEARCH_PAGE_SIZE + SEARCH_PAGE_SIZE);

  const rows = slice.map((fam) => [{
    text: `${fam.family}  •  ${fam.count} pkgs  •  from ${money(fam.minPrice)}`.slice(0, 90),
    callback_data: `grp:${fam.category}:${encodeData(fam.family)}:0`
  }]);

  // Pager for search results
  const qEnc = encodeData(q);
  if (totalPages > 1) {
    const pager = pagerRow(`srch:${qEnc}:PAGE`, currentPage, totalPages);
    if (pager.length) rows.push(pager);
  }
  rows.push([{ text: "🏠 Menu", callback_data: "home" }]);

  const header = `🔍 <b>Search: "${esc(q)}"</b>\n${families.length} product families found  •  Page ${currentPage + 1}/${totalPages}\n\n<i>Tap a product family to see packages.</i>`;
  if (editMessageId) return bot.editMessage(chatId, editMessageId, header, keyboard(rows));
  return bot.sendMessage(chatId, header, keyboard(rows));
}

async function handleCustomerMessage(update, bot) {
  const message = update.message;
  if (!message || !message.from) return;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const user = store.ensureUser(message.from);
  if (user.blocked) return bot.sendMessage(chatId, "Your account is blocked.");

  if (text.startsWith("/start") || text === "/menu") { userStates.delete(user.id); return showHome(bot, chatId, user); }
  if (text.startsWith("/account")) return showAccount(bot, chatId, user);
  if (text.startsWith("/pay")) return startPayment(bot, chatId, user.id);
  if (text.startsWith("/pricelist")) return sendPriceListPdf(bot, chatId);
  if (text.startsWith("/search")) return runSearch(bot, chatId, user, text.replace(/^\/search\s*/, ""));
  if (text.startsWith("/apidocs")) return bot.sendMessage(chatId, `API Docs: ${esc(config.docsUrl)}\nUse header: <code>X-API-Key: YOUR_KEY</code>`, keyboard([[{ text: "Menu", callback_data: "home" }]]));
  if (text.startsWith("/apikey")) { const key = store.generateUserApiKey(user.id); return bot.sendMessage(chatId, `Your API key was created. Keep it private.\n\n<code>${esc(key)}</code>\n\nUse it as: <code>X-API-Key: ${esc(key)}</code>`); }

  const state = userStates.get(user.id);

  if (state?.mode === "search_wait") {
    userStates.delete(user.id);
    return runSearch(bot, chatId, user, text);
  }

  if (state?.mode === "game_player_id") {
    userStates.set(user.id, { ...state, mode: "game_confirm", inputs: { player_id: text } });
    const product = store.productByLocalId(state.productLocalId);
    return bot.sendMessage(chatId, `Confirm purchase of <b>${esc(product.name)}</b> for player ID <code>${esc(text)}</code>.\nPrice: ${money(store.sellingPrice(product))}`, keyboard([
      [{ text: "✅ Confirm", callback_data: `gconfirm:${state.productLocalId}` }, { text: "❌ Cancel", callback_data: `prod:${state.productLocalId}` }]
    ]));
  }

  if (state?.mode === "custom_qty") {
    const qty = Math.max(1, Math.min(100, Number.parseInt(text, 10) || 0));
    if (!qty) return bot.sendMessage(chatId, "Send a number between 1 and 100.");
    userStates.delete(user.id);
    return placeOrder(bot, chatId, user, store.productByLocalId(state.productLocalId), qty);
  }

  if (state?.mode === "topup_amount") {
    const amount = Math.max(0, Number.parseInt(text.replace(/[^0-9]/g, ""), 10) || 0);
    if (!amount) return bot.sendMessage(chatId, "Send a whole number in MMK.");
    userStates.set(user.id, { mode: "topup_method", amount });
    const rows = store.paymentMethods().map((method) => [{ text: `${method.name} • ${method.account}`, callback_data: `paymethod:${method.id}` }]);
    rows.push([{ text: "Cancel", callback_data: "home" }]);
    return bot.sendMessage(chatId, `Amount: <b>${money(amount)}</b>\nChoose payment method:`, keyboard(rows));
  }

  if (state?.mode === "topup_screenshot") {
    if (!(message.photo || message.document)) return bot.sendMessage(chatId, "Please send the payment screenshot as a photo or document.");
    const fileId = message.photo?.at(-1)?.file_id || message.document?.file_id;
    userStates.set(user.id, { ...state, mode: "topup_name", screenshotFileId: fileId });
    return bot.sendMessage(chatId, "Screenshot received. Now send the transfer account name.");
  }

  if (state?.mode === "topup_name") {
    const payment = store.createPayment({ userId: user.id, amount: state.amount, method: state.method, transferName: text, screenshotFileId: state.screenshotFileId });
    userStates.delete(user.id);
    await bot.sendMessage(chatId, `Payment submitted.\nPayment ID: <code>${payment.id}</code>\nAdmin will review it soon.`);
    const adminText = `New payment pending\nID: <code>${payment.id}</code>\nUser: <code>${user.id}</code>\nAmount: <b>${money(payment.amount)}</b>\nMethod: ${esc(payment.method.name)}\nName: ${esc(payment.transferName)}`;
    const adminKeyboard = keyboard([[{ text: "Accept", callback_data: `accept:${payment.id}` }, { text: "Reject", callback_data: `reject:${payment.id}` }]]);
    await notifyAdmins(adminText, adminKeyboard);
    if (payment.screenshotFileId) await notifyAdminsPhoto(payment.screenshotFileId, adminText);
    return null;
  }

  return showHome(bot, chatId, user);
}

async function handleCustomerCallback(update, bot) {
  const q = update.callback_query;
  await bot.answerCallback(q.id);
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const user = store.ensureUser(q.from);
  const parts = q.data.split(":");
  const action = parts[0];
  const [a, b, c, d] = parts.slice(1);

  if (action === "noop") return null;
  if (action === "home") { userStates.delete(user.id); return showHome(bot, chatId, user, msgId); }
  if (action === "account") return showAccount(bot, chatId, user, msgId);
  if (action === "search") { userStates.set(user.id, { mode: "search_wait" }); return bot.sendMessage(chatId, "🔍 Send a keyword or product ID to search."); }
  if (action === "pricelist") return sendPriceListPdf(bot, chatId);
  if (action === "apidocs") return bot.editMessage(chatId, msgId, `API Docs: ${esc(config.docsUrl)}\nUse header: <code>X-API-Key: YOUR_KEY</code>`, keyboard([[{ text: "Menu", callback_data: "home" }]]));
  if (action === "apikey") { const key = store.generateUserApiKey(user.id); return bot.editMessage(chatId, msgId, `Your API key was created. Keep it private.\n\n<code>${esc(key)}</code>\n\nUse it as: <code>X-API-Key: ${esc(key)}</code>`, keyboard([[{ text: "Account", callback_data: "account" }, { text: "Menu", callback_data: "home" }]])); }
  if (action === "srch") {
    // srch:<encodedQuery>:<page>
    const query = decodeData(a);
    const page = Number(b || 0);
    return runSearch(bot, chatId, user, query, page, msgId);
  }
  if (action === "cat") return showCategory(bot, chatId, a, Number(b || 0), msgId, user);
  if (action === "grp") return showGroup(bot, chatId, a, b, Number(c || 0), msgId, d ? decodeData(d) : "");
  if (action === "prod") { store.trackView(store.productByLocalId(a)); return showProduct(bot, chatId, store.productByLocalId(a), msgId); }
  if (action === "buy") return beginBuy(bot, chatId, user.id, store.productByLocalId(a));
  if (action === "qty" && b === "custom") { userStates.set(user.id, { mode: "custom_qty", productLocalId: a }); return bot.sendMessage(chatId, "Send quantity from 1 to 100."); }
  if (action === "qty") return placeOrder(bot, chatId, user, store.productByLocalId(a), Number(b));
  if (action === "gconfirm") {
    const state = userStates.get(user.id);
    userStates.delete(user.id);
    return placeOrder(bot, chatId, user, store.productByLocalId(a), 1, state?.inputs || {});
  }
  if (action === "pay" && a === "start") return startPayment(bot, chatId, user.id, msgId);
  if (action === "paymethod") {
    const state = userStates.get(user.id);
    const method = store.paymentMethods().find((item) => item.id === a);
    if (!state?.amount || !method) return startPayment(bot, chatId, user.id);
    userStates.set(user.id, { mode: "topup_screenshot", amount: state.amount, method });
    return bot.sendMessage(chatId, `Transfer <b>${money(state.amount)}</b> to:\n${esc(method.name)}\nAccount: <code>${esc(method.account)}</code>\nName: ${esc(method.holder || "-")}\n\nThen send the payment screenshot here.`);
  }
}

// ---- Admin bot (payment reviews + broadcast) ----

async function handleAdminMessage(update, bot) {
  const message = update.message;
  if (!message || !message.from) return;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  if (!store.data.admins.length && !config.adminTelegramIds.length) store.addAdmin(message.from.id);
  if (!store.isAdmin(message.from.id)) return bot.sendMessage(chatId, `Admin access is not enabled for this chat. Chat ID: <code>${message.from.id}</code>`);
  const state = adminStates.get(String(message.from.id));

  if (state?.mode === "reject_reason") {
    const payment = store.updatePayment(state.paymentId, { status: "rejected", reviewedBy: String(message.from.id), rejectReason: text });
    adminStates.delete(String(message.from.id));
    await customerBot.sendMessage(payment.userId, `Payment rejected.\nID: <code>${payment.id}</code>\nReason: ${esc(text)}`).catch(() => {});
    return bot.sendMessage(chatId, "Payment rejected.");
  }

  if (state?.mode === "broadcast_wait") {
    // Accept text or photo (with caption). Send to every user.
    let sent = 0;
    let failed = 0;
    const userIds = store.allUserIds();
    if (message.photo) {
      const fileId = message.photo.at(-1).file_id;
      const caption = message.caption || "";
      for (const id of userIds) {
        try { await customerBot.sendPhoto(id, fileId, { caption }); sent++; } catch { failed++; }
      }
    } else if (message.document) {
      const fileId = message.document.file_id;
      const caption = message.caption || "";
      for (const id of userIds) {
        try { await customerBot.sendDocument(id, fileId, { caption }); sent++; } catch { failed++; }
      }
    } else if (text) {
      for (const id of userIds) {
        try { await customerBot.sendMessage(id, text); sent++; } catch { failed++; }
      }
    } else {
      return bot.sendMessage(chatId, "Send text, a photo (with caption), or a document to broadcast.");
    }
    adminStates.delete(String(message.from.id));
    return bot.sendMessage(chatId, `✅ Broadcast complete.\nSent: ${sent}\nFailed: ${failed}`);
  }

  if (text === "/broadcast") {
    adminStates.set(String(message.from.id), { mode: "broadcast_wait" });
    return bot.sendMessage(chatId, "📢 Send the next message (text, photo, or document) to broadcast to every user.");
  }

  if (text === "/stats") {
    const totals = store.totals();
    return bot.sendMessage(chatId, `📊 <b>Store Stats</b>\nOrders: <b>${totals.orderCount}</b>\nRevenue: <b>${money(totals.revenue)}</b>\nCost: <b>${money(totals.cost)}</b>\nProfit: <b>${money(totals.profit)}</b>\nAccepted top-ups: <b>${money(totals.acceptedTotal)}</b> (${totals.acceptedPayments})\nPending top-ups: <b>${money(totals.pendingTotal)}</b> (${totals.pendingPayments})`);
  }

  return bot.sendMessage(chatId, `Admin ready.\nChat ID: <code>${message.from.id}</code>\n/broadcast – send to all users\n/stats – store totals\nPending payments: ${Object.values(store.data.payments).filter((payment) => payment.status === "pending").length}`);
}

async function handleAdminCallback(update, bot) {
  const q = update.callback_query;
  await bot.answerCallback(q.id);
  const adminId = String(q.from.id);
  if (!store.isAdmin(adminId)) return bot.sendMessage(q.message.chat.id, "Not authorized.");
  const [action, id] = q.data.split(":");
  const payment = store.data.payments[id];
  if (!payment || payment.status !== "pending") return bot.sendMessage(q.message.chat.id, "Payment is no longer pending.");
  if (action === "accept") {
    store.updatePayment(id, { status: "accepted", reviewedBy: adminId });
    store.ensureUser({ id: payment.userId });
    store.adjustBalance(payment.userId, Number(payment.amount), id);
    await customerBot.sendMessage(payment.userId, `Payment accepted.\nAmount: <b>${money(payment.amount)}</b>\nNew balance: <b>${money(store.getUser(payment.userId).balance)}</b>`).catch(() => {});
    return bot.sendMessage(q.message.chat.id, `Accepted ${id}.`);
  }
  if (action === "reject") {
    adminStates.set(adminId, { mode: "reject_reason", paymentId: id });
    return bot.sendMessage(q.message.chat.id, "Send the rejection reason.");
  }
}

// Helper the admin panel can call to broadcast without going through the bot chat.
export async function adminBroadcast({ text = "", photoFileId = "", photoUrl = "", documentFileId = "", caption = "" } = {}) {
  const userIds = store.allUserIds();
  let sent = 0;
  let failed = 0;
  for (const id of userIds) {
    try {
      if (photoFileId || photoUrl) await customerBot.sendPhoto(id, photoFileId || photoUrl, { caption: caption || text });
      else if (documentFileId) await customerBot.sendDocument(id, documentFileId, { caption: caption || text });
      else if (text) await customerBot.sendMessage(id, text);
      else continue;
      sent++;
    } catch { failed++; }
  }
  return { sent, failed, total: userIds.length };
}

export function startTelegramBots() {
  customerBot.start(async (update, bot) => update.callback_query ? handleCustomerCallback(update, bot) : handleCustomerMessage(update, bot));
  paymentBot.start(async (update, bot) => update.callback_query ? handleAdminCallback(update, bot) : handleAdminMessage(update, bot));
}
