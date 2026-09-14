import dotenv from "dotenv";

dotenv.config();

// Patch BigInt serialization for Fastify / JSON
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "4000", 10),
  HOST: process.env.HOST || "0.0.0.0",
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:4000",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
  TELEGRAM_STORAGE_VAULT_CHAT_ID: process.env.TELEGRAM_STORAGE_VAULT_CHAT_ID || "",
  DATABASE_URL: process.env.DATABASE_URL!,
  DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  CHAPA_SECRET_KEY: process.env.CHAPA_SECRET_KEY!,
  CHAPA_WEBHOOK_SECRET: process.env.CHAPA_WEBHOOK_SECRET || "",
  CHAPA_API_URL: process.env.CHAPA_API_URL || "https://api.chapa.co/v1",
};

// Fail fast if required variables are missing (in non-test environments or when checking configuration)
export function validateEnv() {
  const requiredVars = ["TELEGRAM_BOT_TOKEN", "DATABASE_URL", "CHAPA_SECRET_KEY"] as const;
  for (const v of requiredVars) {
    if (!process.env[v]) {
      throw new Error(`FATAL: Missing required environment variable: ${v}`);
    }
  }
}
