import http from "node:http";
import { URL } from "node:url";
import { config } from "./config.js";
import { store } from "./store.js";
import { categories, apiDocs } from "./providers/base.js";
import { adminBroadcast } from "./telegram.js";
import { fetchAllBalances } from "./providers/index.js";
import { logger } from "./logger.js";

// Cache for API balances (refreshed every 5 minutes or on demand)
let balanceCache = { data: [], lastFetch: 0 };
async function getApiBalances(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && balanceCache.data.length && now - balanceCache.lastFetch < 300000) {
    return balanceCache.data;
  }
  try {
    balanceCache.data = await fetchAllBalances();
    balanceCache.lastFetch = now;
  } catch (error) {
    logger.warn("Failed to fetch API balances", { message: error.message });
  }
  return balanceCache.data;
}

const money = (amount) => `${Number(amount || 0).toLocaleString()} MMK`;
const usdt = (amount) => `${Number(amount || 0).toFixed(2)} USDT`;
const esc = (text) => String(text ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

function layout(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{--primary:#6366f1;--primary-dark:#4f46e5;--primary-soft:#eef2ff;--primary-tint:#f5f7ff;--accent:#10b981;--accent-dark:#059669;--ink:#1e293b;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--bad:#ef4444;--warn:#f59e0b;--shadow:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1);--shadow-lg:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1)}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);font-size:14px;line-height:1.5;min-height:100vh}
  .top{background:linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#3730a3 100%);padding:0 24px;display:flex;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:50;box-shadow:var(--shadow-lg)}
  .top b{color:#fff;font-size:18px;font-weight:800;padding:16px 0;margin-right:32px;letter-spacing:-0.02em}
  .top-nav{display:flex;gap:2px;flex-wrap:wrap;padding:8px 0}
  .top a{color:rgba(255,255,255,.8);text-decoration:none;font-size:13px;padding:10px 14px;border-radius:8px;font-weight:600;transition:all .15s}
  .top a:hover{background:rgba(255,255,255,.15);color:#fff}
  .wrap{padding:24px;max-width:1400px;margin:auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:var(--shadow);transition:box-shadow .2s}
  .card:hover{box-shadow:var(--shadow-lg)}
  .card h2{font-size:18px;font-weight:700;margin-bottom:12px;color:var(--ink)}
  .card h3{font-size:16px;font-weight:700;margin-bottom:12px;color:var(--ink)}
  .kpi{border-radius:16px;padding:20px;color:#fff;position:relative;overflow:hidden;box-shadow:var(--shadow-lg)}
  .kpi::before{content:'';position:absolute;top:-50%;right:-50%;width:100%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.1) 0%,transparent 60%);pointer-events:none}
  .kpi.green{background:linear-gradient(135deg,#10b981,#059669)}
  .kpi.blue{background:linear-gradient(135deg,#3b82f6,#1d4ed8)}
  .kpi.orange{background:linear-gradient(135deg,#f59e0b,#d97706)}
  .kpi.purple{background:linear-gradient(135deg,#8b5cf6,#6d28d9)}
  .kpi.pink{background:linear-gradient(135deg,#ec4899,#be185d)}
  .kpi.cyan{background:linear-gradient(135deg,#06b6d4,#0891b2)}
  .kpi.slate{background:linear-gradient(135deg,#475569,#334155)}
  .kpi small{opacity:.9;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
  .kpi h2{font-size:28px;font-weight:800;margin:8px 0 4px;letter-spacing:-0.02em}
  .kpi p{margin:0;font-size:12px;opacity:.85}
  .balance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
  .balance-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:4px}
  .balance-card .provider{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .balance-card .amount{font-size:22px;font-weight:800;color:var(--ink)}
  .balance-card .currency{font-size:12px;color:var(--muted)}
  .balance-card.error .amount{color:var(--bad);font-size:13px;font-weight:600}
  .balance-card.unconfigured{opacity:.5}
  .table{overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:var(--shadow)}
  table{width:100%;border-collapse:collapse;min-width:800px}
  th,td{padding:14px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
  th{position:sticky;top:0;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;z-index:1}
  tbody tr{transition:background .15s}tbody tr:hover{background:#f8fafc}tbody tr:last-child td{border-bottom:0}
  input,select,button,textarea{padding:10px 12px;border:1px solid var(--line);border-radius:8px;max-width:100%;background:#fff;color:var(--ink);font:inherit;transition:all .15s}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
  textarea{min-height:100px;width:100%;resize:vertical}
  button,.button{background:var(--primary);border:1px solid var(--primary);color:#fff;cursor:pointer;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;padding:10px 16px;font-size:13px;line-height:1;white-space:nowrap;transition:all .15s}
  button:hover,.button:hover{background:var(--primary-dark);border-color:var(--primary-dark);transform:translateY(-1px);box-shadow:var(--shadow)}
  .button.secondary{background:#fff;color:var(--primary);border-color:var(--line)}
  .button.secondary:hover{background:var(--primary-soft);border-color:var(--primary)}
  .button.warn{background:var(--warn);border-color:var(--warn)}
  .button.warn:hover{background:#d97706;border-color:#d97706}
  .button.danger{background:var(--bad);border-color:var(--bad)}
  .button.danger:hover{background:#dc2626;border-color:#dc2626}
  .muted{color:var(--muted)}.bad{color:var(--bad);font-weight:600}.good{color:var(--accent);font-weight:600}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .pill{display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;background:var(--primary-soft);color:var(--primary);font-weight:700;font-size:12px}
  .pill.success{background:#d1fae5;color:#059669}
  .pill.warning{background:#fef3c7;color:#d97706}
  .pill.danger{background:#fee2e2;color:#dc2626}
  .pager{justify-content:flex-end;padding:12px 16px}
  .pager a,.pager span.num{padding:8px 12px;border:1px solid var(--line);border-radius:8px;color:var(--ink);text-decoration:none;background:#fff;font-weight:600;font-size:13px;transition:all .15s}
  .pager .num.active{background:var(--primary);color:#fff;border-color:var(--primary)}
  .pager a:hover{background:var(--primary-soft);border-color:var(--primary)}
  .actions{display:flex;gap:6px;flex-wrap:wrap}.actions form{display:inline-flex;gap:6px}
  .small{font-size:12px}
  .logo{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--primary-soft),#dbeafe);color:var(--primary);margin-right:12px;font-weight:800;font-size:13px;letter-spacing:.02em;vertical-align:middle}
  .product-cell{min-width:240px}.product-title{font-weight:700;font-size:14px}
  .revenue-input{width:80px;font-weight:700;padding:8px 10px}
  .note-preview{max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
  pre{white-space:pre-wrap;font-size:12px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid var(--line)}
  .subnav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
  .subnav a{padding:10px 16px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:600;font-size:13px;transition:all .15s}
  .subnav a:hover{border-color:var(--primary);color:var(--primary)}
  .subnav a.active{background:var(--primary);color:#fff;border-color:var(--primary)}
  .section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:12px}
  @media(max-width:768px){body{font-size:13px}.wrap{padding:16px}.top{padding:0 16px}.top b{font-size:16px;margin-right:16px}.top a{font-size:12px;padding:8px 10px}.card{padding:16px;border-radius:12px}table{font-size:12px;min-width:700px}.kpi h2{font-size:24px}}
</style></head><body><div class="top"><b>${esc(config.storeName)}</b><nav class="top-nav">
  <a href="/">Dashboard</a>
  <a href="/products">Products</a>
  <a href="/notes">Notes</a>
  <a href="/broadcast">Broadcast</a>
  <a href="/payments/settings">Payment Methods</a>
  <a href="/users">Users</a>
  <a href="/payments">Payments</a>
  <a href="/orders">Orders</a>
  <a href="/errors">API Errors</a>
  <a href="/api-docs">API Docs</a>
</nav></div><main class="wrap">${body}</main></body></html>`;
}

function auth(req, res) {
  if (!config.adminPassword) return true;
  const expected = `Basic ${Buffer.from(`admin:${config.adminPassword}`).toString("base64")}`;
  if ((req.headers.authorization || "") === expected) return true;
  res.writeHead(401, { "WWW-Authenticate": "Basic realm=Admin" });
  res.end("Authentication required");
  return false;
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const contentType = String(req.headers["content-type"] || "");
  const raw = Buffer.concat(chunks).toString("utf8");
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function redirect(res, to) { res.writeHead(303, { Location: to }); res.end(); }
function json(res, data, status = 200) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data, null, 2)); }

function apiUser(req) {
  return store.findUserByApiKey(req.headers["x-api-key"] || req.headers["X-API-Key"] || "");
}
function requireApiUser(req, res) {
  const user = apiUser(req);
  if (user) return user;
  json(res, { success: false, error: "Missing or invalid X-API-Key" }, 401);
  return null;
}

// ---------- Dashboard ----------
async function dashboard() {
  const products = Object.values(store.data.products);
  const users = Object.values(store.data.users);
  const orders = Object.values(store.data.orders);
  const pending = Object.values(store.data.payments).filter((p) => p.status === "pending");
  const totals = store.totals();
  const recentOrders = orders.slice(-8).reverse();
  const recentPayments = Object.values(store.data.payments).slice(-8).reverse();

  // Fetch API balances
  const balances = await fetchAllBalances();
  const balanceCards = balances.map((b) => {
    const statusClass = b.error ? "balance-error" : (b.balance > 10 ? "balance-ok" : "balance-low");
    const display = b.error ? `<span class="bad">Error</span>` : `<h2>${usdt(b.balance)}</h2>`;
    const detail = b.error ? `<p class="small">${esc(b.error)}</p>` : `<p class="small">${b.currency || "USDT"}</p>`;
    return `<div class="balance-card ${statusClass}"><small>${esc(b.name)}</small>${display}${detail}</div>`;
  }).join("");

  const orderRows = recentOrders.map((o) => `<tr><td><code>${esc(o.id)}</code></td><td><code>${esc(o.userId)}</code></td><td>${esc(o.productName || "")}</td><td>${o.qty || 1}</td><td>${money(o.total || 0)}</td><td class="good">${money(o.profit || 0)}</td><td><span class="pill">${esc(o.status || "")}</span></td></tr>`).join("") || `<tr><td colspan="7" class="muted">No orders yet.</td></tr>`;
  const paymentRows = recentPayments.map((p) => `<tr><td><code>${esc(p.id)}</code></td><td><code>${esc(p.userId)}</code></td><td>${money(p.amount || 0)}</td><td>${esc(p.method?.name || "")}</td><td><span class="pill">${esc(p.status)}</span></td><td class="small muted">${esc(p.createdAt || "")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No payments yet.</td></tr>`;

  return layout("Dashboard", `
    <div class="grid">
      <div class="kpi"><small>Revenue</small><h2>${money(totals.revenue)}</h2><p>${totals.orderCount} orders</p></div>
      <div class="kpi blue"><small>Profit</small><h2>${money(totals.profit)}</h2><p>Cost: ${money(totals.cost)}</p></div>
      <div class="kpi orange"><small>Accepted Top-ups</small><h2>${money(totals.acceptedTotal)}</h2><p>${totals.acceptedPayments} payments</p></div>
      <div class="kpi purple"><small>Pending Top-ups</small><h2>${money(totals.pendingTotal)}</h2><p>${totals.pendingPayments} pending</p></div>
    </div>
    <div class="card"><h3>💰 API Provider Balances</h3><div class="balance-grid">${balanceCards || '<p class="muted">No providers configured.</p>'}</div></div>
    <div class="grid">
      <div class="card"><small class="muted">Users</small><h2>${users.length}</h2><span class="muted small">Blocked: ${users.filter((u) => u.blocked).length}</span></div>
      <div class="card"><small class="muted">Packages</small><h2>${products.length}</h2><span class="muted small">Out of stock: ${products.filter((p) => Number(p.stock || 0) <= 0).length}</span></div>
      <div class="card"><small class="muted">Pending Payments</small><h2>${pending.length}</h2><span class="muted small">Needs review</span></div>
      <div class="card"><small class="muted">Product Notes</small><h2>${Object.keys(store.data.familyNotes).length + Object.keys(store.data.productNotes).length}</h2><span class="muted small"><a href="/notes">Manage notes</a></span></div>
    </div>
    <div class="card"><h3>Recent Orders</h3><div class="table"><table><thead><tr><th>ID</th><th>User</th><th>Product</th><th>Qty</th><th>Total</th><th>Profit</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table></div></div>
    <div class="card"><h3>Recent Payments</h3><div class="table"><table><thead><tr><th>ID</th><th>User</th><th>Amount</th><th>Method</th><th>Status</th><th>Time</th></tr></thead><tbody>${paymentRows}</tbody></table></div></div>
    <div class="card"><h3>Store Settings</h3>
      <form method="post" action="/settings/general" class="row">
        <div style="flex:1;min-width:220px"><label class="small muted">USDT to MMK rate</label><br><input name="rate" type="number" step="0.01" value="${store.data.settings.usdtToMmk}"></div>
        <div style="flex:1;min-width:220px"><label class="small muted">Default revenue %</label><br><input name="revenuePercent" type="number" step="0.01" value="${store.data.settings.revenuePercent}"></div>
        <div style="flex:2;min-width:220px"><label class="small muted">Contact / welcome text</label><br><input name="contactText" value="${esc(store.data.settings.contactText || "")}" style="width:100%"></div>
        <div><button>Save Settings</button></div>
      </form>
    </div>`);
}

// ---------- Pagination ----------
function pageState(url, total, size = 25) {
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, totalPages - 1);
  return { page: current, totalPages, start: current * size, end: current * size + size, size };
}
function pagination(url, state) {
  const params = new URLSearchParams(url.searchParams);
  const link = (page, label, cls = "") => { params.set("page", String(page)); return `<a class="${cls}" href="${url.pathname}?${params.toString()}">${label}</a>`; };
  const parts = [];
  if (state.page > 0) parts.push(link(state.page - 1, "Prev"));
  const windowStart = Math.max(0, Math.min(state.page - 3, state.totalPages - 7));
  const windowEnd = Math.min(state.totalPages, windowStart + 7);
  for (let i = windowStart; i < windowEnd; i++) {
    if (i === state.page) parts.push(`<span class="num active">${i + 1}</span>`);
    else parts.push(link(i, `${i + 1}`, "num"));
  }
  if (state.page + 1 < state.totalPages) parts.push(link(state.page + 1, "Next"));
  return `<div class="card row pager">${parts.join(" ")}</div>`;
}

// ---------- Products (grouped by family) ----------
function groupedProducts(url) {
  const q = url.searchParams.get("q") || "";
  const category = url.searchParams.get("category") || "";
  const provider = url.searchParams.get("provider") || "";
  const groups = new Map();
  for (const product of store.products({ search: q, category, provider })) {
    const key = [product.category, product.providerId, product.family || "Other"].join("|");
    const current = groups.get(key) || { category: product.category, providerId: product.providerId, providerName: product.providerName, family: product.family || "Other", logo: product.logo || product.providerId.slice(0, 2).toUpperCase(), count: 0, inStock: 0, stock: 0, minSell: null, maxSell: null };
    current.count += 1;
    current.stock += Math.max(0, Number(product.stock || 0));
    if (Number(product.stock || 0) > 0) current.inStock += 1;
    const sell = store.sellingPrice(product);
    current.minSell = current.minSell === null ? sell : Math.min(current.minSell, sell);
    current.maxSell = current.maxSell === null ? sell : Math.max(current.maxSell, sell);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => (a.minSell || 0) - (b.minSell || 0) || a.family.localeCompare(b.family));
}

function productsPage(url) {
  const q = url.searchParams.get("q") || "";
  const category = url.searchParams.get("category") || "";
  const provider = url.searchParams.get("provider") || "";
  const allGroups = groupedProducts(url);
  const state = pageState(url, allGroups.length, 25);
  const visibleGroups = allGroups.slice(state.start, state.end);
  const rows = visibleGroups.map((g, index) => {
    const note = store.familyNote(g.family);
    const noteBadge = note ? `<span class="pill" title="${esc(note.text || "").slice(0, 80)}">📝 note</span>` : "";
    return `<tr>
      <td class="product-cell"><span class="logo">${esc(g.logo)}</span><span class="product-title">${esc(g.family)}</span> ${noteBadge}<br><span class="muted small">${esc(categories[g.category] || g.category)} • ${esc(g.providerName)}</span></td>
      <td>${g.count}</td>
      <td>${g.inStock ? `<span class="good">${g.inStock}/${g.count}</span><br><span class="muted small">Total: ${g.stock}</span>` : `<span class="bad">Out of Stock</span>`}</td>
      <td class="price-cell">${g.minSell === g.maxSell ? money(g.minSell || 0) : `${money(g.minSell || 0)}<br><span class="muted small">up to ${money(g.maxSell || 0)}</span>`}</td>
      <td><div class="row"><input class="revenue-input" name="percent${index}" value="${store.revenuePercent({ family: g.family, providerName: g.providerName, category: g.category, name: g.family })}" type="number" step="0.01"><input type="hidden" name="match${index}" value="${esc(g.family)}"><span class="muted small">%</span></div></td>
      <td class="actions">
        <a class="button secondary" href="/packages?family=${encodeURIComponent(g.family)}&category=${encodeURIComponent(g.category)}&provider=${encodeURIComponent(g.providerId)}">Packages</a>
        <a class="button secondary" href="/notes?family=${encodeURIComponent(g.family)}">Note</a>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No products match this filter.</td></tr>`;
  const categoryOptions = ["", ...Object.keys(categories)].map((c) => `<option value="${c}" ${c === category ? "selected" : ""}>${c ? categories[c] : "All categories"}</option>`).join("");
  return layout("Products", `
    <div class="card">
      <form class="row">
        <input name="q" value="${esc(q)}" placeholder="Search family, name, or item ID" style="flex:2">
        <select name="category">${categoryOptions}</select>
        <input name="provider" value="${esc(provider)}" placeholder="Provider">
        <button>Search</button>
      </form>
      <p class="muted small">Showing ${allGroups.length ? state.start + 1 : 0}-${Math.min(state.end, allGroups.length)} of ${allGroups.length} product families. Sorted by lowest price. Edit revenue % per family below.</p>
    </div>
    ${pagination(url, state)}
    <form method="post" action="/products/revenue?${url.searchParams.toString()}">
      <div class="table"><table><thead><tr><th>Product Family</th><th>Packages</th><th>Stock</th><th>Selling Price</th><th>Revenue %</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      <input type="hidden" name="count" value="${visibleGroups.length}">
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button>Save Revenue Changes</button></div>
    </form>
    ${pagination(url, state)}`);
}

function packagesPage(url) {
  const family = url.searchParams.get("family") || "";
  const category = url.searchParams.get("category") || "";
  const provider = url.searchParams.get("provider") || "";
  const region = url.searchParams.get("region") || "";
  const allProducts = store.products({ family, category, provider, region, sort: "price" });
  const state = pageState(url, allProducts.length, 25);
  const regionOptions = ["", ...store.regionsForFamily(family || "")].map((r) => `<option value="${r}" ${r === region ? "selected" : ""}>${r || "All regions"}</option>`).join("");
  const rows = allProducts.slice(state.start, state.end).map((p) => `<tr>
    <td><code>${p.localId}</code></td>
    <td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.region || "-")}</span></td>
    <td>${esc(p.providerName)}</td>
    <td>${usdt(p.basePrice)}<br><span class="muted small">${money(store.basePriceMmk(p))}</span></td>
    <td>${money(store.sellingPrice(p))}<br><span class="muted small">Revenue ${store.revenuePercent(p)}%</span></td>
    <td>${Number(p.stock || 0) > 0 ? `<span class="good">In: ${p.stock}</span>` : `<span class="bad">Out</span>`}</td>
    <td class="actions">
      <form method="post" action="/product/toggle"><input type="hidden" name="id" value="${p.localId}"><button>${p.enabled ? "Disable" : "Enable"}</button></form>
      <a class="button secondary" href="/notes?product=${p.localId}">Note</a>
    </td>
  </tr>`).join("") || `<tr><td colspan="7" class="muted">No packages.</td></tr>`;
  return layout("Packages", `
    <div class="card">
      <a href="/products">← Back to Products</a>
      <h3>${esc(family || "Packages")}</h3>
      <form class="row">
        <input type="hidden" name="family" value="${esc(family)}">
        <input type="hidden" name="category" value="${esc(category)}">
        <input type="hidden" name="provider" value="${esc(provider)}">
        <select name="region">${regionOptions}</select>
        <button>Filter</button>
      </form>
      <p class="muted small">Showing ${allProducts.length ? state.start + 1 : 0}-${Math.min(state.end, allProducts.length)} of ${allProducts.length} packages. Sorted lowest to highest price.</p>
    </div>
    ${pagination(url, state)}
    <div class="table"><table><thead><tr><th>ID</th><th>Package</th><th>API</th><th>Base</th><th>Selling</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${pagination(url, state)}`);
}

// ---------- Notes editor ----------
function notesPage(url) {
  const familyQ = url.searchParams.get("family") || "";
  const productQ = url.searchParams.get("product") || "";
  const targetProduct = productQ ? store.productByLocalId(productQ) : null;
  const targetKey = targetProduct ? `product:${targetProduct.id}` : (familyQ ? `family:${familyQ}` : "");
  const existingNote = targetProduct ? store.productNote(targetProduct) : (familyQ ? store.familyNote(familyQ) : null);

  const familyOptions = ["", ...new Set(Object.values(store.data.products).map((p) => p.family || "Other"))].sort().map((f) => `<option value="${f}" ${f === familyQ ? "selected" : ""}>${f || "-- pick a family --"}</option>`).join("");

  const familyRows = Object.values(store.data.familyNotes).map((n) => `<tr><td><b>${esc(n.family)}</b></td><td class="note-preview">${esc((n.text || "").slice(0, 100))}</td><td>${n.image ? `<span class="pill">🖼️ image</span>` : ""}</td><td class="actions"><a class="button secondary" href="/notes?family=${encodeURIComponent(n.family)}">Edit</a><form method="post" action="/notes/family/delete"><input type="hidden" name="family" value="${esc(n.family)}"><button class="button warn">Delete</button></form></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No family notes yet.</td></tr>`;

  const productRows = Object.values(store.data.productNotes).map((n) => {
    const product = store.data.products[n.productId];
    return `<tr><td><code>#${product?.localId ?? "?"}</code></td><td><b>${esc(product?.name || n.productId)}</b></td><td class="note-preview">${esc((n.text || "").slice(0, 100))}</td><td>${n.image ? `<span class="pill">🖼️ image</span>` : ""}</td><td class="actions"><a class="button secondary" href="/notes?product=${product?.localId ?? ""}">Edit</a><form method="post" action="/notes/product/delete"><input type="hidden" name="productId" value="${esc(n.productId)}"><button class="button warn">Delete</button></form></td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">No product-specific notes yet.</td></tr>`;

  const editorTitle = targetProduct ? `Product Note • ${esc(targetProduct.name)} <span class="muted small">(#${targetProduct.localId})</span>` : (familyQ ? `Family Note • ${esc(familyQ)}` : "Add or Edit Note");

  return layout("Product Notes", `
    <div class="card">
      <h2>Product notes shown to customers</h2>
      <p class="muted small">Notes support emoji 🎉 and an optional image. Product-specific notes take priority; if none, the family note is shown. Notes appear on category/package pages and the product detail view in the Telegram bot.</p>
    </div>
    <div class="card">
      <h3>${editorTitle}</h3>
      <form method="post" action="/notes/save" class="row" style="flex-direction:column;align-items:stretch">
        <div class="row" style="align-items:flex-end">
          <div style="flex:1;min-width:220px">
            <label class="small muted">Attach to family</label><br>
            <select name="family" ${targetProduct ? "disabled" : ""}>${familyOptions}</select>
          </div>
          <div style="flex:1;min-width:220px">
            <label class="small muted">Or attach to product (item ID)</label><br>
            <input name="productLocalId" value="${targetProduct?.localId || ""}" placeholder="e.g. 1042">
          </div>
        </div>
        <div>
          <label class="small muted">Note text (emoji supported)</label>
          <textarea name="text" placeholder="✨ Delivery within 5 minutes. Region: Global. No login required.">${esc(existingNote?.text || "")}</textarea>
        </div>
        <div class="row">
          <div style="flex:1;min-width:260px">
            <label class="small muted">Image URL (https://...) or Telegram file_id</label>
            <input name="image" value="${esc(existingNote?.image || "")}" placeholder="https://example.com/image.jpg" style="width:100%">
          </div>
        </div>
        <div class="row" style="justify-content:flex-end"><button>Save Note</button></div>
      </form>
    </div>
    <div class="card"><h3>Family Notes</h3><div class="table"><table><thead><tr><th>Family</th><th>Text preview</th><th>Image</th><th>Actions</th></tr></thead><tbody>${familyRows}</tbody></table></div></div>
    <div class="card"><h3>Product Notes</h3><div class="table"><table><thead><tr><th>ID</th><th>Product</th><th>Text preview</th><th>Image</th><th>Actions</th></tr></thead><tbody>${productRows}</tbody></table></div></div>`);
}

// ---------- Broadcast ----------
function broadcastPage(message = "") {
  const userCount = Object.keys(store.data.users).length;
  return layout("Broadcast", `
    <div class="card">
      <h2>📢 Send broadcast to every customer</h2>
      <p class="muted small">Message will be sent through the customer bot to all ${userCount} registered users. You can send text with emoji, an image URL, or a Telegram file_id. Blocked users receive nothing.</p>
      ${message ? `<div class="pill" style="margin-bottom:10px">${esc(message)}</div>` : ""}
      <form method="post" action="/broadcast" class="row" style="flex-direction:column;align-items:stretch">
        <div>
          <label class="small muted">Message text (HTML allowed: &lt;b&gt; &lt;i&gt; &lt;code&gt;)</label>
          <textarea name="text" placeholder="🎉 Big update! New products just added." style="min-height:140px"></textarea>
        </div>
        <div class="row">
          <div style="flex:1;min-width:260px">
            <label class="small muted">Image URL (https://...) — optional</label>
            <input name="photoUrl" placeholder="https://example.com/promo.jpg" style="width:100%">
          </div>
          <div style="flex:1;min-width:260px">
            <label class="small muted">Or Telegram file_id — optional</label>
            <input name="photoFileId" placeholder="AgACAg..." style="width:100%">
          </div>
        </div>
        <div class="row" style="justify-content:flex-end"><button>Send Broadcast</button></div>
      </form>
    </div>`);
}

// ---------- Other pages ----------
function paymentSettingsPage() {
  const methods = [...store.paymentMethods()];
  while (methods.length < 4) methods.push({ id: `m${methods.length + 1}`, name: "", account: "", holder: "" });
  const rows = methods.slice(0, 4).map((m, i) => `<div class="card"><h3>Bank ${i + 1}</h3><div class="row"><input name="name${i}" value="${esc(m.name)}" placeholder="Bank name"><input name="account${i}" value="${esc(m.account)}" placeholder="Account / phone"><input name="holder${i}" value="${esc(m.holder)}" placeholder="Account holder"></div></div>`).join("");
  return layout("Payment Methods", `<form method="post" action="/payments/settings">${rows}<button>Save Payment Methods</button></form>`);
}

function usersPage(url) {
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const allUsers = Object.values(store.data.users).filter((u) => !q || `${u.id} ${u.username} ${u.firstName}`.toLowerCase().includes(q));
  const state = pageState(url, allUsers.length, 25);
  const rows = allUsers.slice(state.start, state.end).map((u) => `<tr><td><code>${u.id}</code><br>${esc(u.username ? '@' + u.username : u.firstName)}</td><td>${money(u.balance)}</td><td>${u.blocked ? '<span class="bad">Blocked</span>' : '<span class="good">Active</span>'}</td><td class="actions"><form method="post" action="/user/balance"><input type="hidden" name="id" value="${u.id}"><input name="amount" placeholder="+/- MMK"><button>Adjust</button></form><form method="post" action="/user/block"><input type="hidden" name="id" value="${u.id}"><input type="hidden" name="blocked" value="${u.blocked ? '0' : '1'}"><button>${u.blocked ? 'Unblock' : 'Block'}</button></form></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No users.</td></tr>`;
  return layout("Users", `<div class="card"><form class="row"><input name="q" value="${esc(q)}" placeholder="Search by ID / username" style="flex:1"><button>Search</button></form></div>${pagination(url, state)}<div class="table"><table><thead><tr><th>User</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${pagination(url, state)}`);
}

function paymentsPage(url) {
  const status = url.searchParams.get("status") || "";
  const allPayments = Object.values(store.data.payments).filter((p) => !status || p.status === status).reverse();
  const state = pageState(url, allPayments.length, 25);
  const filterLinks = ["", "pending", "accepted", "rejected"].map((s) => `<a class="${s === status ? "active" : ""}" href="/payments${s ? `?status=${s}` : ""}">${s || "All"}</a>`).join("");
  const rows = allPayments.slice(state.start, state.end).map((p) => `<tr><td><code>${p.id}</code><br><span class="muted small">${p.createdAt}</span></td><td><code>${p.userId}</code></td><td>${money(p.amount)}</td><td>${esc(p.method?.name || "")}</td><td>${esc(p.transferName || "")}</td><td>${p.screenshotFileId ? `<code class="small">${esc(p.screenshotFileId).slice(0, 24)}…</code>` : `<span class="bad">Missing</span>`}</td><td><span class="pill">${p.status}</span></td><td class="actions">${p.status === "pending" ? `<form method="post" action="/payment/accept"><input type="hidden" name="id" value="${p.id}"><button>Accept</button></form><form method="post" action="/payment/reject"><input type="hidden" name="id" value="${p.id}"><input name="reason" placeholder="reason"><button class="button warn">Reject</button></form>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No payments.</td></tr>`;
  return layout("Payments", `<div class="subnav">${filterLinks}</div>${pagination(url, state)}<div class="table"><table><thead><tr><th>ID</th><th>User</th><th>Amount</th><th>Method</th><th>Name</th><th>Screenshot</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${pagination(url, state)}`);
}

function ordersPage(url) {
  const allOrders = Object.values(store.data.orders).reverse();
  const state = pageState(url, allOrders.length, 25);
  const rows = allOrders.slice(state.start, state.end).map((o) => `<tr><td><code>${o.id}</code><br><span class="muted small">${o.createdAt}</span></td><td><code>${o.userId}</code></td><td>${esc(o.productName || "")}</td><td>${o.qty || 1}</td><td>${money(o.total || 0)}</td><td class="good">${money(o.profit || 0)}</td><td>${esc(o.status || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">No orders.</td></tr>`;
  return layout("Orders", `${pagination(url, state)}<div class="table"><table><thead><tr><th>ID</th><th>User</th><th>Product</th><th>Qty</th><th>Total</th><th>Profit</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>${pagination(url, state)}`);
}

function errorsPage(url) {
  const allErrors = store.data.apiErrors;
  const state = pageState(url, allErrors.length, 25);
  const rows = allErrors.slice(state.start, state.end).map((e) => `<tr><td class="small">${e.time}</td><td>${esc(e.providerId)}</td><td class="bad">${esc(e.message)}</td><td><pre>${esc(JSON.stringify(e.details, null, 2))}</pre></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No errors.</td></tr>`;
  return layout("API Errors", `${pagination(url, state)}<div class="table"><table><thead><tr><th>Time</th><th>API</th><th>Error</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>${pagination(url, state)}`);
}

function apiDocsPage() {
  const rows = Object.entries(apiDocs).map(([name, path]) => `<tr><td>${esc(name)}</td><td><code>${esc(path)}</code></td><td>Send <code>X-API-Key</code> from Telegram bot <code>/apikey</code>.</td></tr>`).join("");
  return layout("API Docs", `<div class="card"><h2>Store API Documentation</h2><p>Customers create an API key in Telegram with <code>/apikey</code>. Use it in every request header as <code>X-API-Key: YOUR_KEY</code>.</p><pre>curl -H "X-API-Key: YOUR_KEY" http://127.0.0.1:3000/api/products</pre></div><div class="table"><table><thead><tr><th>Name</th><th>Endpoint</th><th>Authentication</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

// ---------- POST handler ----------
async function handlePost(req, res, url) {
  const data = await body(req);

  if (url.pathname === "/settings/general") {
    store.data.settings.usdtToMmk = Number(data.rate || store.data.settings.usdtToMmk);
    if (data.revenuePercent !== undefined && data.revenuePercent !== "") store.data.settings.revenuePercent = Number(data.revenuePercent);
    if (data.contactText !== undefined) store.setContactText(data.contactText);
    store.save();
    return redirect(res, "/");
  }

  if (url.pathname === "/settings/revenue-rules" || url.pathname === "/products/revenue") {
    const count = Number(data.count || 0);
    const existing = new Map((store.data.settings.revenueRules || []).map((rule) => [String(rule.match || "").toLowerCase(), rule]));
    for (let i = 0; i < count; i++) {
      const match = String(data[`match${i}`] || "").trim();
      if (!match) continue;
      const percent = String(data[`percent${i}`] ?? "").trim();
      if (percent === "") existing.delete(match.toLowerCase());
      else existing.set(match.toLowerCase(), { match, percent: Number(percent) });
    }
    store.setRevenueRules([...existing.values()]);
    return redirect(res, `/products?${url.searchParams.toString()}`);
  }

  if (url.pathname === "/payments/settings") {
    store.setPaymentMethods([0, 1, 2, 3].map((i) => ({ name: data[`name${i}`], account: data[`account${i}`], holder: data[`holder${i}`] })).filter((m) => m.name || m.account || m.holder));
    return redirect(res, "/payments/settings");
  }

  if (url.pathname === "/product/toggle") {
    const p = store.productByLocalId(data.id);
    if (p) { p.enabled = !p.enabled; store.save(); }
    const back = req.headers.referer || "/products";
    return redirect(res, back);
  }

  if (url.pathname === "/user/balance") { store.adjustBalance(data.id, Number(data.amount || 0), "admin_panel"); return redirect(res, "/users"); }
  if (url.pathname === "/user/block") { store.setUserBlocked(data.id, data.blocked === "1"); return redirect(res, "/users"); }
  if (url.pathname === "/payment/accept") {
    const p = store.updatePayment(data.id, { status: "accepted", reviewedBy: "admin_panel" });
    store.ensureUser({ id: p.userId });
    store.adjustBalance(p.userId, Number(p.amount), p.id);
    return redirect(res, "/payments");
  }
  if (url.pathname === "/payment/reject") { store.updatePayment(data.id, { status: "rejected", reviewedBy: "admin_panel", rejectReason: data.reason || "Rejected" }); return redirect(res, "/payments"); }

  if (url.pathname === "/notes/save") {
    const localId = String(data.productLocalId || "").trim();
    const family = String(data.family || "").trim();
    const note = { text: data.text || "", image: data.image || "" };
    if (localId) store.setProductNote(localId, note);
    else if (family) store.setFamilyNote(family, note);
    return redirect(res, "/notes");
  }
  if (url.pathname === "/notes/family/delete") { store.setFamilyNote(data.family || "", null); return redirect(res, "/notes"); }
  if (url.pathname === "/notes/product/delete") {
    const productId = data.productId;
    if (store.data.productNotes[productId]) { delete store.data.productNotes[productId]; store.save(); }
    return redirect(res, "/notes");
  }

  if (url.pathname === "/broadcast") {
    try {
      const result = await adminBroadcast({ text: data.text || "", photoUrl: data.photoUrl || "", photoFileId: data.photoFileId || "" });
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(broadcastPage(`Broadcast queued. Sent: ${result.sent}, Failed: ${result.failed}, Total users: ${result.total}`));
    } catch (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(broadcastPage(`Broadcast failed: ${error.message}`));
    }
    return;
  }

  res.writeHead(404); res.end("Not found");
}

// ---------- API ----------
function storeApi(user) { return { success: true, store: config.storeName, user: { id: user.id, balance: user.balance }, rate: store.data.settings.usdtToMmk, defaultRevenuePercent: store.data.settings.revenuePercent, categories, docs: apiDocs }; }
function productsApi(url) { return { success: true, products: store.products({ category: url.searchParams.get("category") || "", provider: url.searchParams.get("provider") || "", search: url.searchParams.get("q") || "", family: url.searchParams.get("family") || "", region: url.searchParams.get("region") || "" }).map((p) => ({ ...p, basePriceMmk: store.basePriceMmk(p), revenuePercent: store.revenuePercent(p), sellingPriceMmk: store.sellingPrice(p), stockStatus: Number(p.stock || 0) > 0 ? "in_stock" : "out_of_stock" })) }; }

export function startAdminPanel() {
  const server = http.createServer(async (req, res) => {
    try {
      if (!auth(req, res)) return;
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "POST") return handlePost(req, res, url);
      if (url.pathname.startsWith("/api/")) {
        const user = requireApiUser(req, res);
        if (!user) return;
        if (url.pathname === "/api/store") return json(res, storeApi(user));
        if (url.pathname === "/api/products") return json(res, productsApi(url));
        if (url.pathname.startsWith("/api/products/")) return json(res, { success: true, product: store.productByLocalId(url.pathname.split("/").at(-1)) || null });
        if (url.pathname === "/api/settings") return json(res, { success: true, settings: { usdtToMmk: store.data.settings.usdtToMmk, defaultRevenuePercent: store.data.settings.revenuePercent, categories } });
        if (url.pathname === "/api/payments") return json(res, { success: true, payments: Object.values(store.data.payments).filter((payment) => payment.userId === user.id) });
        if (url.pathname === "/api/orders") return json(res, { success: true, orders: Object.values(store.data.orders).filter((order) => order.userId === user.id) });
      }
      if (url.pathname === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(dashboard()); }
      if (url.pathname === "/products") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(productsPage(url)); }
      if (url.pathname === "/packages") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(packagesPage(url)); }
      if (url.pathname === "/notes") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(notesPage(url)); }
      if (url.pathname === "/broadcast") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(broadcastPage()); }
      if (url.pathname === "/payments/settings") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(paymentSettingsPage()); }
      if (url.pathname === "/users") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(usersPage(url)); }
      if (url.pathname === "/payments") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(paymentsPage(url)); }
      if (url.pathname === "/orders") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(ordersPage(url)); }
      if (url.pathname === "/errors") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(errorsPage(url)); }
      if (url.pathname === "/api-docs") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(apiDocsPage()); }
      res.writeHead(404); res.end("Not found");
    } catch (error) {
      logger.error("Admin request failed", { message: error.message, stack: error.stack });
      res.writeHead(500); res.end("Server error");
    }
  });
  server.listen(config.adminPort, config.adminHost, () => logger.info("Admin panel started", { url: `http://${config.adminHost}:${config.adminPort}` }));
}
