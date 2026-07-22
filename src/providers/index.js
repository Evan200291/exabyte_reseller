import { G2BulkProvider } from "./g2bulk.js";
import { RaccoonProvider } from "./raccoon.js";
import { TunvnProvider } from "./tunvn.js";
import { config } from "../config.js";
import { store } from "../store.js";
import { logger } from "../logger.js";

class EmptyProvider {
  constructor(id, name) { this.id = id; this.name = name; }
  async syncProducts() { return []; }
  async buy() { throw new Error(`${this.name} is reserved for a future API module`); }
}

export const providers = [
  new TunvnProvider(config.providers.tunvn),
  new RaccoonProvider(config.providers.raccoon),
  new G2BulkProvider(config.providers.g2bulk),
  new EmptyProvider("future_api_1", "Future API 1")
];

export function providerFor(product) {
  return providers.find((provider) => provider.id === product.providerId);
}

export async function syncAllProviders() {
  for (const provider of providers) {
    try {
      const products = await provider.syncProducts();
      if (products.length) store.replaceProviderProducts(provider.id, products);
      logger.info("Stock synchronized", { provider: provider.id, products: products.length });
    } catch (error) {
      store.apiError(provider.id, error.message, { area: error.providerArea, status: error.status, data: error.data, cause: error.cause?.code || error.cause?.message });
      logger.warn("Stock sync failed", { provider: provider.id, message: error.message, cause: error.cause?.code || error.cause?.message });
    }
  }
}


