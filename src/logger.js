import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.logDir, { recursive: true });

function write(level, message, details = {}) {
  const row = { time: new Date().toISOString(), level, message, details };
  fs.appendFileSync(path.join(config.logDir, "app.log"), `${JSON.stringify(row)}\n`);
  const printable = details && Object.keys(details).length ? `${message} ${JSON.stringify(details)}` : message;
  console.log(`[${row.time}] ${level.toUpperCase()} ${printable}`);
}

export const logger = {
  info: (message, details) => write("info", message, details),
  warn: (message, details) => write("warn", message, details),
  error: (message, details) => write("error", message, details)
};
