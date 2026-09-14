import { Bot, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { ENV } from "../config/env";

export const prisma = new PrismaClient();
export const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

// --- /start Command ---
bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("🎵 Browse Gospel Albums", "browse_catalog")
    .row()
    .text("📂 My Purchased Music", "my_library");

  await ctx.reply(
    `🙏 *Welcome to the Gospel Music Store!*\n\n` +
      `Directly support your favorite Gospel ministers and access full albums in high audio quality.\n\n` +
      `Tap below to explore available albums:`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
});

// --- Catalog Browser ---
bot.callbackQuery("browse_catalog", async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const albums = await prisma.album.findMany({
      where: { isPublished: true },
      include: { artist: true },
      orderBy: { createdAt: "desc" },
    });

    if (albums.length === 0) {
      return ctx.reply("Currently, no albums are available for purchase. Please check back soon!");
    }

    for (const album of albums) {
      const keyboard = new InlineKeyboard().text(
        `💳 Buy for ${album.priceEtb} ETB`,
        `buy_album_${album.id}`
      );

      const caption =
        `🎵 *${album.title}*\n` +
        `👤 *Minister:* ${album.artist.name}\n` +
        `💰 *Price:* ${album.priceEtb} ETB\n\n` +
        `${album.description || ""}`;

      if (album.coverImageFileId) {
        await ctx.replyWithPhoto(album.coverImageFileId, {
          caption,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        await ctx.reply(caption, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    }
  } catch (error) {
    console.error("Error loading catalog:", error);
    await ctx.reply("Failed to load album catalog. Please ensure database connection is configured.");
  }
});

// --- My Library Callback (Placeholder wired for Phase 5) ---
bot.callbackQuery("my_library", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = BigInt(ctx.from!.id);

  try {
    const paidOrders = await prisma.order.findMany({
      where: { telegramUserId: userId, status: "COMPLETED" },
      include: {
        album: {
          include: {
            artist: true,
            tracks: { orderBy: { trackNumber: "asc" } },
          },
        },
      },
    });

    if (paidOrders.length === 0) {
      return ctx.reply(
        "You have not purchased any albums yet. Tap *🎵 Browse Gospel Albums* to explore available music!",
        { parse_mode: "Markdown" }
      );
    }

    await ctx.reply(`🎼 *Your Music Collection:*\nSelect an album to replay:`, {
      parse_mode: "Markdown",
    });

    for (const order of paidOrders) {
      const keyboard = new InlineKeyboard().text(
        `▶️ Play "${order.album.title}"`,
        `play_album_${order.album.id}`
      );
      await ctx.reply(
        `*${order.album.title}* by ${order.album.artist.name}\nPurchased on: ${order.paidAt?.toLocaleDateString() || "Recently"}`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    }
  } catch (error) {
    console.error("Error accessing library:", error);
    await ctx.reply("Could not retrieve your music library at this time.");
  }
});
