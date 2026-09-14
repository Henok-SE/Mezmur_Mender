import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";

export class DeliveryService {
  constructor(
    private readonly bot: Bot,
    private readonly prisma: PrismaClient
  ) {}

  /**
   * Delivers album tracks sequentially with strict anti-piracy protection.
   */
  async deliverPurchasedAlbum(telegramUserId: number | bigint, albumId: number, orderId: string): Promise<void> {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      include: {
        artist: true,
        tracks: { orderBy: { trackNumber: "asc" } },
      },
    });

    if (!album) {
      throw new Error(`Album with ID ${albumId} not found for delivery.`);
    }

    const recipientId = Number(telegramUserId);

    // 1. Send Congratulations & Confirmation
    await this.bot.api.sendMessage(
      recipientId,
      `🎉 *Payment Confirmed!*\n\nThank you for supporting *${album.artist.name}*!\nHere is your full album: *${album.title}*.\n\n_Note: Songs are protected against forwarding and downloads._`,
      { parse_mode: "Markdown" }
    );

    // 2. Deliver Each Track with protect_content = true
    for (const track of album.tracks) {
      try {
        await this.bot.api.sendAudio(recipientId, track.telegramFileId, {
          title: track.title,
          performer: album.artist.name,
          protect_content: true, // Strict Anti-piracy enforcement
        });
      } catch (error) {
        console.error(`Failed to send track "${track.title}" to user ${recipientId}:`, error);
      }
    }

    // 3. Send Persistent Access Reminder
    await this.bot.api.sendMessage(
      recipientId,
      `✨ You can re-listen to your purchased albums anytime by typing /my_albums or clicking "📂 My Purchased Music".`
    );
  }
}
