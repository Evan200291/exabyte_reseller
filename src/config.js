import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (process.env[key] === undefined) process.env[key] = rest.join("=").trim();
  }
}

readEnvFile();

const intEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
};

const numEnv = (name, fallback) => {
  const value = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(value) ? value : fallback;
};

const listEnv = (name) => (process.env[name] || "").split(",").map((v) => v.trim()).filter(Boolean);

export function parsePaymentMethods(raw = process.env.PAYMENT_METHODS || "") {
  const source = raw || "KBZ Pay|09xxxxxxxxx|Account Name;Wave Pay|09xxxxxxxxx|Account Name;AYA Pay|09xxxxxxxxx|Account Name;CB Pay|09xxxxxxxxx|Account Name";
  return source.split(";").map((entry, index) => {
    const [name, account, holder] = entry.split("|").map((part) => (part || "").trim());
    return { id: `m${index + 1}`, name, account, holder };
  }).filter((method) => method.name && method.account).slice(0, 4);
}

export const config = {
  root,
  dataDir: path.join(root, "data"),
  logDir: path.join(root, "logs"),
  storeName: process.env.STORE_NAME || "Auto Delivery Store",
  contactText: process.env.CONTACT_TEXT || "Contact support for help.",
  adminHost: process.env.ADMIN_HOST || "127.0.0.1",
  adminPort: intEnv("ADMIN_PORT", 45452),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  customerBotToken: process.env.CUSTOMER_BOT_TOKEN || "",
  paymentBotToken: process.env.PAYMENT_BOT_TOKEN || "",
  adminTelegramIds: listEnv("ADMIN_TELEGRAM_IDS"),
  defaultRevenuePercent: numEnv("DEFAULT_REVENUE_PERCENT", 5),
  usdtToMmk: numEnv("USDT_TO_MMK", 4000),
  stockSyncSeconds: intEnv("STOCK_SYNC_SECONDS", 45),
  paymentMethods: parsePaymentMethods(),
  docsUrl: process.env.PUBLIC_API_DOCS_URL || "http://127.0.0.1:3000/api-docs",
  providers: {
    g2bulk: {
      id: "g2bulk",
      name: "G2Bulk",
      baseUrl: process.env.G2BULK_BASE_URL || "https://api.g2bulk.com/v1",
      apiKey: process.env.G2BULK_API_KEY || ""
    },
    raccoon: {
      id: "raccoon",
      name: "Raccoon API",
      baseUrl: process.env.RACCOON_BASE_URL || "http://103.75.186.223:5000",
      apiKey: process.env.RACCOON_API_KEY || ""
    },
    tunvn: {
      id: "tunvn",
      name: "TunVN",
      baseUrl: process.env.TUNVN_BASE_URL || "https://tunvnmmo.duckdns.org",
      apiKey: process.env.TUNVN_API_KEY || ""
    }
  }
};
