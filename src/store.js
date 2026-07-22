import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const filePath = path.join(config.dataDir, "store.json");

const initial = {
  nextProductLocalId: 1,
  nextPaymentId: 1,
  nextOrderId: 1,
  admins: [],
  settings: {
    revenuePercent: config.defaultRevenuePercent,
    usdtToMmk: config.usdtToMmk,
    contactText: config.contactText,
    welcomeContact: config.contactText,
    paymentMethods: config.paymentMethods,
    revenueRules: []
  },
  users: {},
  products: {},
  familyNotes: {},
  productNotes: {},
  views: {},
  familyViews: {},
  payments: {},
  orders: {},
  apiErrors: [],
  events: []
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const normKey = (value) => String(value || "").trim().toLowerCase();

class Store {
  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const saved = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : {};
    this.data = { ...clone(initial), ...saved, settings: { ...clone(initial.settings), ...(saved.settings || {}) } };
    if (!Array.isArray(this.data.settings.paymentMethods) || !this.data.settings.paymentMethods.length) this.data.settings.paymentMethods = config.paymentMethods;
    if (!Array.isArray(this.data.settings.revenueRules)) this.data.settings.revenueRules = [];
    if (!this.data.familyNotes || typeof this.data.familyNotes !== "object") this.data.familyNotes = {};
    if (!this.data.productNotes || typeof this.data.productNotes !== "object") this.data.productNotes = {};
    if (!this.data.settings.welcomeContact) this.data.settings.welcomeContact = this.data.settings.contactText || config.contactText;
    this.save();
  }

  save() { fs.writeFileSync(filePath, JSON.stringify(this.data, null, 2)); }

  event(type, payload = {}) {
    this.data.events.unshift({ time: new Date().toISOString(), type, payload });
    this.data.events = this.data.events.slice(0, 500);
    this.save();
  }

  apiError(providerId, message, details = {}) {
    this.data.apiErrors.unshift({ time: new Date().toISOString(), providerId, message, details });
    this.data.apiErrors = this.data.apiErrors.slice(0, 200);
    this.save();
  }

  ensureUser(tgUser) {
    const id = String(tgUser.id);
    if (!this.data.users[id]) {
      this.data.users[id] = { id, username: tgUser.username || "", firstName: tgUser.first_name || "", balance: 0, blocked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    } else {
      this.data.users[id].username = tgUser.username || this.data.users[id].username;
      this.data.users[id].firstName = tgUser.first_name || this.data.users[id].firstName;
      this.data.users[id].updatedAt = new Date().toISOString();
    }
    this.save();
    return this.data.users[id];
  }

  getUser(id) { return this.data.users[String(id)]; }
  allUserIds() { return Object.keys(this.data.users); }

  adjustBalance(userId, amount, reason) {
    const user = this.data.users[String(userId)];
    if (!user) throw new Error("User not found");
    user.balance = Math.max(0, Number(user.balance || 0) + Number(amount || 0));
    user.updatedAt = new Date().toISOString();
    this.event("balance", { userId: String(userId), amount, reason });
    this.save();
    return user;
  }

  setUserBlocked(userId, blocked) {
    if (!this.data.users[String(userId)]) return null;
    this.data.users[String(userId)].blocked = blocked;
    this.save();
    return this.data.users[String(userId)];
  }

  replaceProviderProducts(providerId, products) {
    if (!Array.isArray(products) || products.length === 0) return this.upsertProducts(products || []);
    const incoming = new Set(products.map((product) => product.id));
    for (const [id, product] of Object.entries(this.data.products)) {
      if (product.providerId === providerId && !incoming.has(id)) delete this.data.products[id];
    }
    this.upsertProducts(products);
  }

  upsertProducts(products) {
    const now = new Date().toISOString();
    for (const item of products) {
      const existing = this.data.products[item.id];
      this.data.products[item.id] = {
        ...(existing || {}),
        ...item,
        localId: existing?.localId || this.data.nextProductLocalId++,
        enabled: existing?.enabled ?? true,
        revenuePercent: existing?.revenuePercent ?? null,
        lastSyncedAt: now
      };
    }
    this.save();
  }

  // Non-G2Bulk items always outrank G2Bulk items so customers see the primary
  // API stock first, and only fall back to G2Bulk when nothing else matches.
  providerPriority(providerId) {
    if (!providerId) return 2;
    return String(providerId).toLowerCase() === "g2bulk" ? 1 : 0;
  }

  trackView(product) {
    if (!product?.id) return;
    if (!this.data.views || typeof this.data.views !== "object") this.data.views = {};
    this.data.views[product.id] = Number(this.data.views[product.id] || 0) + 1;
    this.save();
  }

  viewCount(product) {
    return Number(this.data?.views?.[product?.id] || 0);
  }

  trackFamilyView(family) {
    if (!family) return;
    if (!this.data.familyViews || typeof this.data.familyViews !== "object") this.data.familyViews = {};
    const key = normKey(family);
    this.data.familyViews[key] = Number(this.data.familyViews[key] || 0) + 1;
    this.save();
  }

  familyViewCount(family) {
    return Number(this.data?.familyViews?.[normKey(family)] || 0);
  }

  trackCategory(userId, category) {
    const user = this.data.users[String(userId)];
    if (!user || !category) return;
    const list = Array.isArray(user.recentCategories) ? user.recentCategories : [];
    user.recentCategories = [category, ...list.filter((c) => c !== category)].slice(0, 4);
    this.save();
  }

  recentCategories(userId) {
    const user = this.data.users[String(userId)];
    return Array.isArray(user?.recentCategories) ? user.recentCategories : [];
  }

  products(filters = {}) {
    let rows = Object.values(this.data.products);
    if (filters.category) rows = rows.filter((p) => p.category === filters.category);
    if (filters.provider) rows = rows.filter((p) => p.providerId === filters.provider);
    if (filters.family) rows = rows.filter((p) => (p.family || "Other") === filters.family);
    if (filters.region) rows = rows.filter((p) => (p.region || "Default") === filters.region);
    if (filters.search) {
      const q = String(filters.search).toLowerCase().trim();
      if (q) {
        // Support multi-word / partial matches so "ne" matches "Netflix" and "free eu" matches "Freefire Europe".
        const terms = q.split(/\s+/).filter(Boolean);
        rows = rows.filter((p) => {
          const haystack = `${p.name} ${p.providerName || ""} ${p.category} ${p.family || ""} ${p.region || ""} ${p.localId}`.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        });
      }
    }
    const providerRank = (p) => this.providerPriority(p.providerId);
    if (filters.sort === "price") {
      rows.sort((a, b) => providerRank(a) - providerRank(b) || this.sellingPrice(a) - this.sellingPrice(b) || String(a.name).localeCompare(b.name));
    } else if (filters.sort === "popular") {
      rows.sort((a, b) => providerRank(a) - providerRank(b) || this.viewCount(b) - this.viewCount(a) || this.sellingPrice(a) - this.sellingPrice(b));
    } else if (filters.sort === "family_price") {
      rows.sort((a, b) => providerRank(a) - providerRank(b) || String(a.family || "").localeCompare(String(b.family || "")) || this.sellingPrice(a) - this.sellingPrice(b));
    } else {
      rows.sort((a, b) => providerRank(a) - providerRank(b) || `${a.family || ""}${a.name}`.localeCompare(`${b.family || ""}${b.name}`));
    }
    return rows;
  }

  families(category) {
    const map = new Map();
    for (const product of this.products({ category })) {
      const family = product.family || "Other";
      const current = map.get(family) || {
        family, count: 0, inStock: 0, minPrice: null, providerPriority: 2, views: 0,
        logos: new Set(), providers: new Set(), regions: new Set()
      };
      current.count += 1;
      if (Number(product.stock || 0) > 0 && product.enabled) current.inStock += 1;
      const price = this.sellingPrice(product);
      current.minPrice = current.minPrice === null ? price : Math.min(current.minPrice, price);
      current.providerPriority = Math.min(current.providerPriority ?? 2, this.providerPriority(product.providerId));
      current.views += this.viewCount(product);
      current.logos.add(product.logo || product.providerName || product.providerId);
      current.providers.add(product.providerName || product.providerId);
      if (product.region) current.regions.add(product.region);
      map.set(family, current);
    }
    return [...map.values()]
      .map((row) => ({
        ...row,
        views: row.views + this.familyViewCount(row.family),
        logos: [...row.logos],
        providers: [...row.providers],
        regions: [...row.regions]
      }))
      // Non-G2Bulk first, then most-viewed, then lowest price, then name.
      .sort((a, b) =>
        (a.providerPriority ?? 0) - (b.providerPriority ?? 0) ||
        (b.views || 0) - (a.views || 0) ||
        (a.minPrice || 0) - (b.minPrice || 0) ||
        a.family.localeCompare(b.family)
      );
  }

  regionsForFamily(family) {
    const set = new Set();
    for (const product of this.products({ family })) set.add(product.region || "Default");
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  productByLocalId(localId) { return Object.values(this.data.products).find((p) => String(p.localId) === String(localId)); }

  revenuePercent(product) {
    const rules = Array.isArray(this.data.settings.revenueRules) ? this.data.settings.revenueRules : [];
    const rule = rules.find((item) => {
      const match = String(item.match || "").trim().toLowerCase();
      if (!match) return false;
      return [product?.family, product?.name, product?.providerName, product?.category].some((value) => String(value || "").toLowerCase().includes(match));
    });
    return Number(rule?.percent ?? this.data.settings.revenuePercent ?? config.defaultRevenuePercent);
  }

  generateUserApiKey(userId) {
    const user = this.data.users[String(userId)];
    if (!user) throw new Error("User not found");
    user.apiKey = `XAPI_${crypto.randomBytes(24).toString("hex")}`;
    user.updatedAt = new Date().toISOString();
    this.event("api_key_created", { userId: String(userId) });
    this.save();
    return user.apiKey;
  }

  findUserByApiKey(apiKey) {
    const key = String(apiKey || "").trim();
    if (!key) return null;
    return Object.values(this.data.users).find((user) => user.apiKey === key && !user.blocked) || null;
  }

  setRevenueRules(rules) {
    this.data.settings.revenueRules = rules
      .map((rule) => ({ match: String(rule.match || "").trim(), percent: Number(rule.percent || 0) }))
      .filter((rule) => rule.match && Number.isFinite(rule.percent));
    this.save();
  }

  basePriceMmk(product) { return Math.ceil(Number(product?.basePrice || 0) * Number(this.data.settings.usdtToMmk || config.usdtToMmk)); }
  sellingPrice(product) { return Math.ceil(this.basePriceMmk(product) * (1 + this.revenuePercent(product) / 100)); }
  profitPerUnit(product) { return this.sellingPrice(product) - this.basePriceMmk(product); }

  paymentMethods() { return (this.data.settings.paymentMethods || []).filter((m) => m.name && m.account).slice(0, 4); }

  setPaymentMethods(methods) {
    this.data.settings.paymentMethods = methods.slice(0, 4).map((m, index) => ({ id: `m${index + 1}`, name: m.name || "", account: m.account || "", holder: m.holder || "" }));
    this.save();
  }

  setContactText(text) {
    this.data.settings.contactText = String(text || "");
    this.data.settings.welcomeContact = String(text || "");
    this.save();
  }

  // Product / family notes: shown to customers before they buy.
  // Notes support text (with emoji) and optional image (Telegram file_id or URL).
  setFamilyNote(family, note) {
    const key = normKey(family);
    if (!key) return;
    if (!note || (!note.text && !note.image)) { delete this.data.familyNotes[key]; this.save(); return; }
    this.data.familyNotes[key] = { family, text: String(note.text || ""), image: note.image || "", updatedAt: new Date().toISOString() };
    this.save();
  }

  familyNote(family) { return this.data.familyNotes[normKey(family)] || null; }

  setProductNote(localId, note) {
    const product = this.productByLocalId(localId);
    if (!product) return null;
    if (!note || (!note.text && !note.image)) { delete this.data.productNotes[product.id]; this.save(); return null; }
    this.data.productNotes[product.id] = { productId: product.id, text: String(note.text || ""), image: note.image || "", updatedAt: new Date().toISOString() };
    this.save();
    return this.data.productNotes[product.id];
  }

  productNote(product) {
    if (!product) return null;
    return this.data.productNotes[product.id] || this.familyNote(product.family) || null;
  }

  createPayment(payment) {
    const id = `PAY-${String(this.data.nextPaymentId++).padStart(5, "0")}`;
    this.data.payments[id] = { id, status: "pending", createdAt: new Date().toISOString(), ...payment };
    this.event("payment_created", { id, userId: payment.userId, amount: payment.amount });
    this.save();
    return this.data.payments[id];
  }

  updatePayment(id, patch) {
    if (!this.data.payments[id]) throw new Error("Payment not found");
    this.data.payments[id] = { ...this.data.payments[id], ...patch, updatedAt: new Date().toISOString() };
    this.event("payment_updated", { id, patch });
    this.save();
    return this.data.payments[id];
  }

  userPayments(userId) {
    const id = String(userId);
    return Object.values(this.data.payments).filter((p) => String(p.userId) === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  createOrder(order) {
    const id = `ORD-${String(this.data.nextOrderId++).padStart(5, "0")}`;
    this.data.orders[id] = { id, createdAt: new Date().toISOString(), profit: Number(order.profit || 0), ...order };
    this.event("order_created", { id, userId: order.userId, productId: order.productId, total: order.total, profit: order.profit });
    this.save();
    return this.data.orders[id];
  }

  totals() {
    const orders = Object.values(this.data.orders);
    const payments = Object.values(this.data.payments);
    const revenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const cost = orders.reduce((sum, o) => sum + Number(o.baseTotal || 0), 0);
    const profit = orders.reduce((sum, o) => sum + Number(o.profit || 0), 0);
    const acceptedPayments = payments.filter((p) => p.status === "accepted");
    const pendingPayments = payments.filter((p) => p.status === "pending");
    const acceptedTotal = acceptedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const pendingTotal = pendingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return {
      orderCount: orders.length,
      revenue,
      cost,
      profit,
      acceptedPayments: acceptedPayments.length,
      pendingPayments: pendingPayments.length,
      acceptedTotal,
      pendingTotal
    };
  }

  addAdmin(userId) {
    const id = String(userId);
    if (!this.data.admins.includes(id)) this.data.admins.push(id);
    this.save();
  }

  isAdmin(userId) {
    const id = String(userId);
    return config.adminTelegramIds.includes(id) || this.data.admins.includes(id);
  }
}

export const store = new Store();
