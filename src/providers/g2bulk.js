import { Provider, categoryForName, cleanProductName, familyForName, regionFrom, stockFrom } from "./base.js";

function priceOf(item) {
  return Number(item.price ?? item.unit_price ?? item.amount ?? item.rate ?? item.usd_price ?? 0);
}

function itemsFrom(response, keys) {
  if (Array.isArray(response)) return response;
  for (const key of keys) if (Array.isArray(response?.[key])) return response[key];
  if (response?.data && Array.isArray(response.data)) return response.data;
  if (response?.data && typeof response.data === "object") return Object.values(response.data);
  if (response && typeof response === "object") {
    const values = Object.values(response).filter((v) => v && typeof v === "object");
    if (values.length && values.every((v) => v && typeof v === "object")) return values;
  }
  return [];
}

function pageMeta(response) {
  // G2Bulk-style pagination fields we've seen: total, total_pages, per_page, current_page, has_more, next
  const meta = response?.meta || response?.pagination || response || {};
  return {
    total: Number(meta.total ?? meta.total_items ?? meta.count ?? NaN),
    totalPages: Number(meta.total_pages ?? meta.pages ?? meta.last_page ?? NaN),
    currentPage: Number(meta.current_page ?? meta.page ?? NaN),
    hasMore: meta.has_more === true || meta.next != null || meta.has_next === true
  };
}

export class G2BulkProvider extends Provider {
  headers(withAuth = true) {
    return withAuth && this.apiKey ? { Authorization: `Bearer ${this.apiKey}`, "X-API-KEY": this.apiKey, "X-API-Key": this.apiKey } : {};
  }

  // Loops through paginated pages of a list endpoint. G2Bulk returns 5 items/page by default,
  // which is why Free Fire (and other games) only showed 5 packages before this fix.
  async fetchAllPages(endpoint, listKeys, { pageSize = 200, maxPages = 40 } = {}) {
    const all = [];
    const seenIds = new Set();
    let page = 1;
    let stop = false;
    while (page <= maxPages && !stop) {
      const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}&per_page=${pageSize}&limit=${pageSize}`;
      let response;
      try {
        response = await this.request(url, { headers: this.headers(true), timeoutMs: 8000 });
      } catch (error) {
        if (page === 1) throw error;
        break;
      }
      const rows = itemsFrom(response, listKeys);
      if (!rows.length) break;
      let added = 0;
      for (const row of rows) {
        const key = row.id ?? row.product_id ?? row.slug ?? row.code ?? row.name;
        const dedupe = `${key}`;
        if (seenIds.has(dedupe)) continue;
        seenIds.add(dedupe);
        all.push(row);
        added++;
      }
      const meta = pageMeta(response);
      // Stop conditions: no new items on this page, or backend told us we're done
      if (added === 0) break;
      if (Number.isFinite(meta.totalPages) && meta.totalPages > 0 && page >= meta.totalPages) stop = true;
      if (Number.isFinite(meta.total) && all.length >= meta.total) stop = true;
      if (rows.length < pageSize && !meta.hasMore && !Number.isFinite(meta.totalPages)) stop = true;
      page++;
    }
    return all;
  }

  async syncProducts() {
    if (!this.apiKey) return [];
    const products = [];
    const seen = new Set();

    // Try each product endpoint until one succeeds. Once it does, paginate fully.
    const productEndpoints = ["/products", "/api/products", "/v1/products"];
    let productRows = [];
    let lastError;
    for (const endpoint of productEndpoints) {
      try {
        productRows = await this.fetchAllPages(endpoint, ["products", "items", "vouchers", "gift_cards"]);
        if (productRows.length) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!productRows.length && lastError) throw Object.assign(lastError, { providerArea: "products" });

    for (const product of productRows) {
      const rawName = product.name || product.product_name || product.title || product.slug || product.code;
      const name = cleanProductName(rawName);
      if (!name || name.toLowerCase().includes("shopee price checker")) continue;
      const productId = product.id ?? product.product_id ?? product.slug ?? product.code ?? name;
      if (priceOf(product) <= 0) continue;
      const categoryTitle = cleanProductName(product.category_title || product.category || product.group || "");
      const region = regionFrom(product.region, product.country, categoryTitle, name);
      const category = categoryForName(`${name} ${categoryTitle}`, "g2bulk");
      // Keep the full category title as the family for game top-ups so regional games
      // (e.g. "Freefire Europe" vs "Freefire Indonesia") stay separate.
      const fallbackFamily = categoryTitle || (category === "gift_cards" ? "Other Gift Cards" : "Other");
      const family = category === "game_topups" && categoryTitle
        ? categoryTitle
        : familyForName(`${categoryTitle} ${name}`, fallbackFamily);
      const id = `g2bulk:product:${productId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      products.push({
        id,
        providerId: this.id,
        providerName: this.name,
        category,
        family,
        region,
        name,
        basePrice: priceOf(product),
        baseCurrency: "USD",
        stock: stockFrom(product, 999),
        type: category === "game_topups" ? "game_topup" : "voucher",
        logo: "G2",
        meta: { productId, gameCode: product.game_code || product.game || product.game_id || null, catalogueName: name, raw: product }
      });
    }

    // If the API exposes a separate /games listing with per-game catalogues, merge those too
    // so we never miss packages. Silently skips if not available.
    const gameEndpoints = ["/games", "/api/games", "/v1/games"];
    for (const endpoint of gameEndpoints) {
      let games = [];
      try {
        games = await this.fetchAllPages(endpoint, ["games", "items", "products"]);
      } catch { continue; }
      if (!games.length) continue;
      for (const game of games) {
        const code = game.code || game.slug || game.id || game.name;
        if (!code) continue;
        const gameName = cleanProductName(game.name || game.title || String(code));
        const family = gameName;
        const cataloguePaths = [
          `/games/${encodeURIComponent(code)}/catalogue`,
          `/games/${encodeURIComponent(code)}/products`,
          `/games/${encodeURIComponent(code)}/packages`,
          `/api/games/${encodeURIComponent(code)}/catalogue`,
          `/api/games/${encodeURIComponent(code)}/products`
        ];
        let catalogue = [];
        for (const path of cataloguePaths) {
          try {
            catalogue = await this.fetchAllPages(path, ["catalogue", "products", "items", "packages", "denominations"]);
            if (catalogue.length) break;
          } catch {}
        }
        if (!catalogue.length) continue;
        for (const item of catalogue) {
          if (priceOf(item) <= 0) continue;
          const planName = cleanProductName(item.name || item.catalogue_name || item.title || item.region || item.package || "Top-up");
          const region = regionFrom(item.region, item.country, planName, gameName);
          const id = `g2bulk:game:${code}:${Buffer.from(planName).toString("base64url")}`;
          if (seen.has(id)) continue;
          seen.add(id);
          products.push({
            id,
            providerId: this.id,
            providerName: this.name,
            category: "game_topups",
            family,
            region,
            name: planName === gameName ? gameName : `${gameName} - ${planName}`,
            basePrice: priceOf(item),
            baseCurrency: "USD",
            stock: stockFrom(item, 999),
            type: "game_topup",
            logo: "G2",
            meta: { gameCode: code, catalogueName: planName, raw: item }
          });
        }
      }
      break;
    }

    return products;
  }

  async buy(product, order) {
    if (!this.apiKey) throw new Error("G2Bulk API key is missing");
    if (product.type === "voucher") {
      return this.request(`/products/${encodeURIComponent(product.meta.productId)}/purchase`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ quantity: order.qty || 1, order_code: order.orderCode })
      });
    }
    // Game top-up via product id when we have one, else via game code + catalogue name.
    if (product.meta?.productId && !product.meta?.gameCode) {
      return this.request(`/products/${encodeURIComponent(product.meta.productId)}/purchase`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ quantity: order.qty || 1, ...order.inputs, order_code: order.orderCode })
      });
    }
    return this.request(`/games/${encodeURIComponent(product.meta.gameCode)}/order`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ catalogue_name: product.meta.catalogueName, ...order.inputs, order_code: order.orderCode })
    });
  }

  async validatePlayer(product, inputs) {
    if (!product?.meta?.gameCode || !inputs.player_id) return null;
    try {
      return await this.request(`/games/${encodeURIComponent(product.meta.gameCode)}/validate`, {
        method: "POST", headers: this.headers(true), body: JSON.stringify(inputs)
      });
    } catch { return null; }
  }
}
