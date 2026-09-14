import { Bot } from "grammy";
import { ENV } from "../config/env";

if (!ENV.TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing from your .env file.");
  process.exit(1);
}

const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

console.log("Starting Audio File ID Inspector Bot...");

// Listen for audio uploads or forwarded music files
bot.on(":audio", async (ctx) => {
  const audio = ctx.msg?.audio;
  if (!audio) return;

  console.log(`\n🎧 Received Audio File: "${audio.title || "Untitled"}" by "${audio.performer || "Unknown"}"`);
  console.log(`   File ID: ${audio.file_id}`);
  console.log(`   Duration: ${audio.duration}s`);
  console.log(`   Size: ${audio.file_size ? Math.round(audio.file_size / 1024) + " KB" : "Unknown"}`);

  await ctx.reply(
    `🎵 *Audio File Details Captured:*\n\n` +
      `• *Title:* \`${audio.title || "Untitled"}\`\n` +
      `• *Performer:* \`${audio.performer || "Unknown"}\`\n` +
      `• *Duration:* \`${audio.duration}s\`\n` +
      `• *Mime Type:* \`${audio.mime_type || "audio/mpeg"}\`\n\n` +
      `🔑 *Telegram File ID (Tap to Copy):*\n` +
      `\`${audio.file_id}\``,
    { parse_mode: "Markdown" }
  );
});

// Also handle documents if audio files are sent as uncompressed audio documents
bot.on(":document", async (ctx) => {
  const doc = ctx.msg?.document;
  if (!doc) return;

  if (doc.mime_type?.startsWith("audio/")) {
    console.log(`\n📁 Received Audio Document: "${doc.file_name}"`);
    console.log(`   File ID: ${doc.file_id}`);

    await ctx.reply(
      `📁 *Audio Document Captured:*\n\n` +
        `• *Filename:* \`${doc.file_name || "Unknown"}\`\n` +
        `• *Mime Type:* \`${doc.mime_type}\`\n\n` +
        `🔑 *Telegram File ID (Tap to Copy):*\n` +
        `\`${doc.file_id}\``,
      { parse_mode: "Markdown" }
    );
  }
});

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Inspector Bot is online as @${botInfo.username}`);
    console.log("👉 Send or forward any audio file (.mp3 / .m4a) to the bot in Telegram to retrieve its file_id.");
  },
});
