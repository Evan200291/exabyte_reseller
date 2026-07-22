import { Provider, categoryForName, cleanProductName, familyForName, regionFrom, stockFrom } from "./base.js";

const hiddenKeywords = ["shopee price checker"];

export class RaccoonProvider extends Provider {
  headers() { return this.apiKey ? { "X-API-KEY": this.apiKey } : {}; }

  async syncProducts() {
    if (!this.apiKey) return [];
    const response = await this.request("/api/dealer/stock", { headers: this.headers() });
    const products = response.products || {};
    return Object.entries(products).flatMap(([slug, item]) => {
      const rawName = item.name || slug;
      const name = cleanProductName(rawName);
      const lower = name.toLowerCase();
      if (hiddenKeywords.some((word) => lower.includes(word))) return [];
      const category = categoryForName(name, "raccoon");
      return [{
        id: `raccoon:${slug}`,
        providerId: this.id,
        providerName: this.name,
        category,
        family: familyForName(name, category === "ai_products" ? "Other AI" : "Other Digital"),
        region: regionFrom(name, item.region, item.country),
        name,
        basePrice: Number(item.price || 0),
        baseCurrency: response.currency || "USD",
        stock: stockFrom(item, 0),
        type: item.type || "file",
        logo: "Raccoon",
        meta: { productKey: slug, rawName }
      }];
    });
  }

  async buy(product, order) {
    if (!this.apiKey) throw new Error("Raccoon API key is missing");
    return this.request("/api/dealer/buy", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ product_key: product.meta.productKey, qty: order.qty || 1, order_code: order.orderCode })
    });
  }

  async balance() {
    if (!this.apiKey) return null;
    return this.request("/api/dealer/balance", { headers: this.headers() });
  }
}
