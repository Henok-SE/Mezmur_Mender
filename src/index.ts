import { bot } from "./bot/bot";
import { createServer } from "./server";
import { ENV } from "./config/env";

async function main() {
  const server = createServer();

  // 1. Start Fastify Web Server
  await server.listen({ port: ENV.PORT, host: ENV.HOST });
  console.log(`🚀 Mezmur Mender Webhook server listening on http://${ENV.HOST}:${ENV.PORT}`);

  // 2. Launch Telegram Bot in Long-Polling Mode
  console.log("🤖 Starting Telegram bot...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is now online and listening for commands!`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
