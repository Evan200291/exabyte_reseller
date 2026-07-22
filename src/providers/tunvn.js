import { Provider, categoryForName, cleanProductName, familyForName, regionFrom, stockFrom } from "./base.js";

function priceOf(item) {
  return Number(item.price_usdt ?? item.usd_price ?? item.price ?? item.base_price ?? item.amount ?? item.rate ?? 0);
}

function listFrom(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["products", "items", "data", "stock", "packages"]) {
    if (Array.isArray(data?.[key])) return data[key];
    if (data?.[key] && typeof data[key] === "object") return Object.entries(data[key]).map(([slug, item]) => ({ slug, ...item }));
  }
  if (data && typeof data === "object") {
    const values = Object.values(data);
    if (values.every((v) => v && typeof v === "object")) return Object.entries(data).map(([slug, item]) => ({ slug, ...item }));
  }
  return [];
}

export class TunvnProvider extends Provider {
  headers() { return this.apiKey ? { "X-API-Key": this.apiKey } : {}; }

  async syncProducts() {
    if (!this.apiKey) return [];
    const endpoints = ["/api/products"];
    let rows = [];
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const response = await this.request(endpoint, { headers: this.headers(), timeoutMs: 3000 });
        rows = listFrom(response);
        if (rows.length) break;
      } catch (error) { lastError = error; }
    }
    if (!rows.length && lastError) throw Object.assign(lastError, { providerArea: "products" });
    return rows.flatMap((item) => {
      const rawName = item.name || item.product_name || item.title || item.service_name || item.slug || item.id;
      const name = cleanProductName(rawName);
      if (!name) return [];
      const category = categoryForName(name, "tunvn");
      const slug = item.id || item.product_id || item.slug || item.key || item.product_key || Buffer.from(name).toString("base64url");
      return [{
        id: `tunvn:${slug}`,
        providerId: this.id,
        providerName: this.name,
        category,
        family: familyForName(name, category === "ai_products" ? "Other AI" : category === "gift_cards" ? "Other Gift Cards" : "Other Digital"),
        region: regionFrom(name, item.region, item.country),
        name,
        basePrice: priceOf(item),
        baseCurrency: "USDT",
        stock: stockFrom(item, 0),
        type: item.type || "file",
        logo: "TV",
        meta: { productKey: slug, productId: item.id || item.product_id || slug, raw: item }
      }];
    });
  }

  async buy(product, order) {
    if (!this.apiKey) throw new Error("TunVN API key is missing");
    const payload = { product_id: product.meta.productId || product.meta.productKey, quantity: order.qty || 1, currency: "usdt", order_code: order.orderCode };
    const endpoints = ["/api/buy"];
    let lastError;
    for (const endpoint of endpoints) {
      try {
        return await this.request(endpoint, { method: "POST", headers: this.headers(), body: JSON.stringify(payload) });
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error("TunVN purchase endpoint is not available");
  }

  async balance() {
    if (!this.apiKey) return null;
    const endpoints = ["/api/balance", "/api/dealer/balance", "/api/wallet", "/api/me"];
    for (const endpoint of endpoints) {
      try {
        const response = await this.request(endpoint, { headers: this.headers(), timeoutMs: 5000 });
        const bal = response?.balance ?? response?.wallet ?? response?.credit ?? response?.data?.balance;
        if (bal !== undefined) return { balance: Number(bal), currency: response?.currency || "USDT", raw: response };
      } catch { /* try next */ }
    }
    return null;
  }
}

