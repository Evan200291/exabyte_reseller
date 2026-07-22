import { config } from "./config.js";
import { logger } from "./logger.js";
import { syncAllProviders } from "./providers/index.js";
import { startAdminPanel } from "./admin.js";
import { startTelegramBots } from "./telegram.js";

async function main() {
  logger.info("Starting Telegram auto-delivery store", { store: config.storeName });

  if (!config.customerBotToken) logger.warn("CUSTOMER_BOT_TOKEN is empty; customer bot will not poll Telegram.");
  if (!config.paymentBotToken) logger.warn("PAYMENT_BOT_TOKEN is empty; payment/admin bot will not poll Telegram.");
  if (!config.providers.g2bulk.apiKey) logger.warn("G2BULK_API_KEY is empty; G2Bulk purchases are disabled until configured.");
  if (!config.providers.raccoon.apiKey) logger.warn("RACCOON_API_KEY is empty; Raccoon products are disabled until configured.");

  startAdminPanel();
  startTelegramBots();

  syncAllProviders().catch((error) => logger.warn("Initial stock sync failed", { message: error.message }));
  setInterval(() => syncAllProviders().catch((error) => logger.warn("Scheduled stock sync failed", { message: error.message })), config.stockSyncSeconds * 1000);
}

process.on("unhandledRejection", (error) => logger.error("Unhandled rejection", { message: error.message }));
process.on("uncaughtException", (error) => logger.error("Uncaught exception", { message: error.message }));

main().catch((error) => {
  logger.error("Startup failed", { message: error.message });
  process.exit(1);
});

