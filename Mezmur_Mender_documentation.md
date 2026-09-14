# Gospel Music Marketplace Bot (Production Documentation)

This document provides complete, production-grade documentation and implementation blueprints for the **Gospel Music Marketplace Bot**. Built with **TypeScript**, **Node.js**, **grammY**, **Fastify**, **Prisma ORM (PostgreSQL)**, and **Chapa**, this architecture is optimized for speed, reliability, anti-piracy, and seamless scaling from one initial client to a full multi-vendor platform.

---

## 1. System Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Fan as Buyer (Telegram User)
    participant Bot as grammY Bot
    participant Fastify as Fastify API Server
    participant DB as PostgreSQL (Prisma)
    participant Chapa as Chapa Payment Gateway
    actor Singer as Gospel Singer / Admin

    Note over Singer,Bot: Pre-condition: Admin uploads album to Master Storage Vault & registers file_ids
    Fan->>Bot: /start or taps "🎵 Browse Albums"
    Bot->>DB: Fetch published albums
    DB-->>Bot: Return album catalog
    Bot-->>Fan: Displays album cover, description, price & "Buy Album" button
    
    Fan->>Bot: Clicks "💳 Buy Album (200 ETB)"
    Bot->>DB: Create Order (status: PENDING, tx_ref: gospel_xxx)
    Bot->>Chapa: POST /v1/transaction/initialize (amount, tx_ref, callback_url)
    Chapa-->>Bot: Returns checkout_url
    Bot-->>Fan: Sends inline button with Chapa payment link (Telebirr / CBE / Cards)

    Fan->>Chapa: Completes payment via Telebirr or CBE Birr
    Chapa->>Fastify: POST /api/v1/payments/chapa/webhook (x-chapa-signature)
    Fastify->>Fastify: Validate HMAC SHA256 Signature
    Fastify->>DB: Update Order (status: COMPLETED, paid_at: NOW)
    Fastify->>Bot: Trigger delivery event (userId, albumId)
    
    loop For each track in Album
        Bot-->>Fan: sendAudio(track.telegramFileId, protect_content=true)
    end
    Bot-->>Fan: Sends completion receipt & /my_albums link
```

---

## 2. Directory Structure

```text
gospel-music-bot/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma
└── src/
    ├── config/
    │   └── env.ts
    ├── bot/
    │   ├── bot.ts
    │   ├── handlers/
    │   │   ├── start.handler.ts
    │   │   ├── catalog.handler.ts
    │   │   ├── purchase.handler.ts
    │   │   └── library.handler.ts
    │   └── keyboards/
    │       └── album.keyboards.ts
    ├── services/
    │   ├── chapa.service.ts
    │   └── delivery.service.ts
    ├── routes/
    │   └── webhook.route.ts
    ├── scripts/
    │   └── seed-first-album.ts
    ├── server.ts
    └── index.ts
```

---

## 3. Database Schema (`prisma/schema.prisma`)

This schema supports your first client immediately while maintaining full multi-vendor marketplace readiness.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum OrderStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}

enum PayoutAccountType {
  TELEBIRR
  CBE_BIRR
  BANK_TRANSFER
}

model Artist {
  id                 Int               @id @default(autoincrement())
  name               String            @db.VarChar(255)
  bio                String?           @db.Text
  phoneNumber        String            @db.VarChar(30)
  payoutAccountType  PayoutAccountType @default(TELEBIRR)
  payoutAccountNumber String           @db.VarChar(100)
  isActive           Boolean           @default(true)
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt
  albums             Album[]

  @@map("artists")
}

model Album {
  id                Int       @id @default(autoincrement())
  artistId          Int
  artist            Artist    @relation(fields: [artistId], references: [id], onDelete: Cascade)
  title             String    @db.VarChar(255)
  description       String?   @db.Text
  coverImageFileId  String?   @db.VarChar(255) // Telegram file_id for cover art
  priceEtb          Decimal   @db.Decimal(10, 2)
  priceUsd          Decimal?  @default(0.00) @db.Decimal(10, 2)
  isPublished       Boolean   @default(false)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  tracks            Track[]
  orders            Order[]

  @@map("albums")
}

model Track {
  id              Int      @id @default(autoincrement())
  albumId         Int
  album           Album    @relation(fields: [albumId], references: [id], onDelete: Cascade)
  trackNumber     Int
  title           String   @db.VarChar(255)
  telegramFileId  String   @db.VarChar(255) // Cached Telegram file_id
  durationSeconds Int?
  createdAt       DateTime @default(now())

  @@unique([albumId, trackNumber])
  @@map("tracks")
}

model Order {
  id             String      @id @default(uuid())
  telegramUserId BigInt
  telegramUsername String?   @db.VarChar(255)
  albumId        Int
  album          Album       @relation(fields: [albumId], references: [id])
  amount         Decimal     @db.Decimal(10, 2)
  currency       String      @default("ETB") @db.VarChar(10)
  txRef          String      @unique @db.VarChar(255)
  chapaReference String?     @db.VarChar(255)
  status         OrderStatus @default(PENDING)
  createdAt      DateTime    @default(now())
  paidAt         DateTime?

  @@index([telegramUserId])
  @@index([txRef])
  @@map("orders")
}
```

---

## 4. Environment Variables (`.env.example`)

```env
# App Configuration
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
APP_BASE_URL=https://bot.yourdomain.com

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
# Private storage channel used by admin to upload and inspect file_ids
TELEGRAM_STORAGE_VAULT_CHAT_ID=-1001234567890

# Database
DATABASE_URL=postgresql://postgres:securepassword@localhost:5432/gospel_bot?schema=public

# Chapa Payment Gateway
CHAPA_SECRET_KEY=CHASECK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxx
CHAPA_WEBHOOK_SECRET=your_configured_webhook_secret_hash
CHAPA_API_URL=https://api.chapa.co/v1
```

---

## 5. Core Implementation

### A. Environment Config (`src/config/env.ts`)
```typescript
import dotenv from "dotenv";
dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "4000", 10),
  HOST: process.env.HOST || "0.0.0.0",
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:4000",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
  TELEGRAM_STORAGE_VAULT_CHAT_ID: process.env.TELEGRAM_STORAGE_VAULT_CHAT_ID!,
  DATABASE_URL: process.env.DATABASE_URL!,
  CHAPA_SECRET_KEY: process.env.CHAPA_SECRET_KEY!,
  CHAPA_WEBHOOK_SECRET: process.env.CHAPA_WEBHOOK_SECRET!,
  CHAPA_API_URL: process.env.CHAPA_API_URL || "https://api.chapa.co/v1",
};

if (!ENV.TELEGRAM_BOT_TOKEN) {
  throw new Error("FATAL: TELEGRAM_BOT_TOKEN is not defined in environment.");
}
if (!ENV.CHAPA_SECRET_KEY) {
  throw new Error("FATAL: CHAPA_SECRET_KEY is not defined in environment.");
}
```

---

### B. Chapa Payment Integration (`src/services/chapa.service.ts`)
```typescript
import axios from "axios";
import crypto from "crypto";
import { ENV } from "../config/env";

export interface InitializePaymentParams {
  amount: number;
  currency: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  txRef: string;
  callbackUrl: string;
  returnUrl: string;
  customizationTitle: string;
  customizationDescription: string;
}

export class ChapaService {
  private readonly client = axios.create({
    baseURL: ENV.CHAPA_API_URL,
    headers: {
      Authorization: `Bearer ${ENV.CHAPA_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  /**
   * Initializes a Chapa checkout session and retrieves the payment URL.
   */
  async initializePayment(params: InitializePaymentParams): Promise<string> {
    const payload = {
      amount: params.amount.toString(),
      currency: params.currency,
      email: params.email || "buyer@gospelbot.et",
      first_name: params.firstName || "Telegram",
      last_name: params.lastName || "User",
      tx_ref: params.txRef,
      callback_url: params.callbackUrl,
      return_url: params.returnUrl,
      "customization[title]": params.customizationTitle,
      "customization[description]": params.customizationDescription,
    };

    const response = await this.client.post("/transaction/initialize", payload);

    if (response.data && response.data.status === "success") {
      return response.data.data.checkout_url;
    }

    throw new Error(`Failed to initialize Chapa transaction: ${response.data?.message || "Unknown error"}`);
  }

  /**
   * Verifies the authenticity of an incoming Chapa webhook request.
   */
  verifyWebhookSignature(signatureHeader: string | undefined, rawBody: string): boolean {
    if (!signatureHeader || !ENV.CHAPA_WEBHOOK_SECRET) {
      return false;
    }

    const calculatedHash = crypto
      .createHmac("sha256", ENV.CHAPA_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(calculatedHash, "utf-8"),
      Buffer.from(signatureHeader, "utf-8")
    );
  }
}

export const chapaService = new ChapaService();
```

---

### C. Protected Audio Delivery Service (`src/services/delivery.service.ts`)
```typescript
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
          protect_content: true, // Anti-piracy enforcement
        });
      } catch (error) {
        console.error(`Failed to send track ${track.title} to user ${recipientId}:`, error);
      }
    }

    // 3. Send Persistent Access Reminder
    await this.bot.api.sendMessage(
      recipientId,
      `✨ You can re-listen to your purchased albums anytime by typing /my_albums.`
    );
  }
}
```

---

### D. Telegram Bot Setup & Handlers (`src/bot/bot.ts`)
```typescript
import { Bot, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { ENV } from "../config/env";
import { chapaService } from "../services/chapa.service";

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
  const albums = await prisma.album.findMany({
    where: { isPublished: true },
    include: { artist: true },
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
});

// --- Checkout Handler ---
bot.callbackQuery(/^buy_album_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const albumId = parseInt(ctx.match[1], 10);
  const user = ctx.from;

  if (!user) return;

  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: { artist: true },
  });

  if (!album) {
    return ctx.reply("Album not found or unavailable.");
  }

  // Check if user already owns this album
  const existingOrder = await prisma.order.findFirst({
    where: {
      telegramUserId: BigInt(user.id),
      albumId: album.id,
      status: "COMPLETED",
    },
  });

  if (existingOrder) {
    return ctx.reply(
      `You already own *${album.title}*! Use /my_albums to listen to it anytime.`,
      { parse_mode: "Markdown" }
    );
  }

  // Generate unique transaction reference
  const txRef = `gospel_${album.id}_${user.id}_${Date.now()}`;

  // Create pending order
  await prisma.order.create({
    data: {
      telegramUserId: BigInt(user.id),
      telegramUsername: user.username || null,
      albumId: album.id,
      amount: album.priceEtb,
      currency: "ETB",
      txRef,
      status: "PENDING",
    },
  });

  // Call Chapa to generate payment link
  try {
    const checkoutUrl = await chapaService.initializePayment({
      amount: Number(album.priceEtb),
      currency: "ETB",
      txRef,
      callbackUrl: `${ENV.APP_BASE_URL}/api/v1/payments/chapa/webhook`,
      returnUrl: `https://t.me/${ctx.me.username}`,
      customizationTitle: `Album: ${album.title}`,
      customizationDescription: `Support ${album.artist.name}`,
    });

    const paymentKeyboard = new InlineKeyboard().url(
      `👉 Complete Payment (${album.priceEtb} ETB)`,
      checkoutUrl
    );

    await ctx.reply(
      `Ready to buy *${album.title}* by *${album.artist.name}*?\n\n` +
        `• Payment options: *Telebirr*, *CBE Birr*, *Awash*, or *Cards*\n` +
        `• Immediate access delivered right in this chat once complete.\n\n` +
        `Click below to pay:`,
      {
        parse_mode: "Markdown",
        reply_markup: paymentKeyboard,
      }
    );
  } catch (error: any) {
    console.error("Error creating Chapa session:", error);
    await ctx.reply("Unable to start checkout right now. Please try again later.");
  }
});

// --- /my_albums Library ---
bot.command("my_albums", async (ctx) => {
  const userId = BigInt(ctx.from!.id);

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
      "You have not purchased any albums yet. Use /start to explore available music!"
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
      `*${order.album.title}* by ${order.album.artist.name}\nPurchased on: ${order.paidAt?.toLocaleDateString()}`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  }
});

// --- Replay Album Callback ---
bot.callbackQuery(/^play_album_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const albumId = parseInt(ctx.match[1], 10);
  const userId = BigInt(ctx.from!.id);

  const verifiedOrder = await prisma.order.findFirst({
    where: { telegramUserId: userId, albumId, status: "COMPLETED" },
    include: {
      album: {
        include: {
          artist: true,
          tracks: { orderBy: { trackNumber: "asc" } },
        },
      },
    },
  });

  if (!verifiedOrder) {
    return ctx.reply("Order not found or not paid.");
  }

  await ctx.reply(`Streaming *${verifiedOrder.album.title}*...`, { parse_mode: "Markdown" });

  for (const track of verifiedOrder.album.tracks) {
    await ctx.api.sendAudio(ctx.from!.id, track.telegramFileId, {
      title: track.title,
      performer: verifiedOrder.album.artist.name,
      protect_content: true,
    });
  }
});
```

---

### E. Fastify Server & Chapa Webhook Handler (`src/server.ts`)

```typescript
import Fastify, { FastifyInstance } from "fastify";
import { ENV } from "./config/env";
import { chapaService } from "./services/chapa.service";
import { DeliveryService } from "./services/delivery.service";
import { bot, prisma } from "./bot/bot";

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  const deliveryService = new DeliveryService(bot, prisma);

  // Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Chapa Webhook Endpoint
  app.post("/api/v1/payments/chapa/webhook", async (request, reply) => {
    const signature = request.headers["x-chapa-signature"] as string | undefined;
    const rawBody = JSON.stringify(request.body);

    // 1. Signature Verification (In production, enforce HMAC signature)
    if (ENV.NODE_ENV === "production") {
      const isValid = chapaService.verifyWebhookSignature(signature, rawBody);
      if (!isValid) {
        app.log.warn({ signature }, "Unauthorized Chapa webhook signature mismatch");
        return reply.status(401).send({ error: "Invalid signature" });
      }
    }

    const payload = request.body as {
      event?: string;
      status?: string;
      tx_ref: string;
      reference?: string;
      amount?: string;
    };

    app.log.info({ tx_ref: payload.tx_ref, status: payload.status }, "Chapa webhook received");

    if (payload.status === "success") {
      const { tx_ref } = payload;

      // 2. Fetch Pending Order
      const order = await prisma.order.findUnique({
        where: { txRef: tx_ref },
      });

      if (!order) {
        app.log.error({ tx_ref }, "Order matching tx_ref not found");
        return reply.status(404).send({ error: "Order not found" });
      }

      // Idempotency: Ignore if already completed
      if (order.status === "COMPLETED") {
        app.log.info({ tx_ref }, "Order already fulfilled. Skipping.");
        return reply.status(200).send({ status: "already_processed" });
      }

      // 3. Mark Order as COMPLETED
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "COMPLETED",
          chapaReference: payload.reference || null,
          paidAt: new Date(),
        },
      });

      // 4. Trigger Instant Audio Delivery
      try {
        await deliveryService.deliverPurchasedAlbum(
          updatedOrder.telegramUserId,
          updatedOrder.albumId,
          updatedOrder.id
        );
      } catch (deliveryError) {
        app.log.error({ deliveryError, orderId: updatedOrder.id }, "Error delivering album tracks");
      }
    }

    return reply.status(200).send({ status: "ok" });
  });

  return app;
}
```

---

### F. Application Entry Point (`src/index.ts`)

```typescript
import { bot } from "./bot/bot";
import { createServer } from "./server";
import { ENV } from "./config/env";

async function main() {
  const server = createServer();

  // 1. Start Fastify Web Server
  await server.listen({ port: ENV.PORT, host: ENV.HOST });
  console.log(`🚀 Webhook server listening on http://${ENV.HOST}:${ENV.PORT}`);

  // 2. Launch Telegram Bot in Long-Polling Mode (or Webhook in Production)
  console.log("🤖 Starting Telegram bot...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is now online.`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
```

---

## 6. How to Upload Tracks & Retrieve Telegram `file_id`

To distribute songs via `protect_content=True` without paying audio storage or bandwidth fees, use the **Master Storage Vault Channel** approach:

```text
1. Create a Private Telegram Channel (e.g. "Gospel Vault").
2. Add your Bot to the channel as an Administrator.
3. Upload your singer's master audio files (.mp3 / .m4a) to the channel.
4. Listen to the channel updates or use a helper script to capture the file_id:
```

### Quick Helper Script to Inspect `file_id` (`src/scripts/get-file-id.ts`)
```typescript
import { Bot } from "grammy";
import { ENV } from "../config/env";

const bot = new Bot(ENV.TELEGRAM_BOT_TOKEN);

// Simply send or forward any audio file to your bot in private chat to see its file_id!
bot.on(":audio", async (ctx) => {
  const audio = ctx.message.audio;
  await ctx.reply(
    `🎵 *Track Details:*\n` +
    `• Title: \`${audio.title || "Untitled"}\`\n` +
    `• Performer: \`${audio.performer || "Unknown"}\`\n` +
    `• Duration: \`${audio.duration}s\`\n` +
    `• File ID:\n\`${audio.file_id}\``,
    { parse_mode: "Markdown" }
  );
});

bot.start();
```

---

### G. Database Seeding for Your 1st Client (`src/scripts/seed-first-album.ts`)

Run this script once you have the `file_id`s for your first singer's album:

```typescript
import { PrismaClient, PayoutAccountType } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  console.log("Seeding first Gospel Singer & Album...");

  // 1. Create the Artist
  const artist = await prisma.artist.create({
    data: {
      name: "Singer Dawit",
      bio: "Contemporary Ethiopian Gospel singer and worship leader.",
      phoneNumber: "+251911223344",
      payoutAccountType: PayoutAccountType.TELEBIRR,
      payoutAccountNumber: "0911223344",
      isActive: true,
    },
  });

  // 2. Create the Album
  const album = await prisma.album.create({
    data: {
      artistId: artist.id,
      title: "Kidus Semih (ቅዱስ ስምህ)",
      description: "10-track debut worship album recorded live in Addis Ababa.",
      priceEtb: 250.0, // 250 ETB
      isPublished: true,
    },
  });

  // 3. Add Album Tracks (Insert your actual telegram_file_ids here)
  await prisma.track.createMany({
    data: [
      {
        albumId: album.id,
        trackNumber: 1,
        title: "01. Kidus Semih",
        telegramFileId: "CQACAgQAAxkBAAICXW...", // Your Telegram audio file_id
        durationSeconds: 312,
      },
      {
        albumId: album.id,
        trackNumber: 2,
        title: "02. Halleluya",
        telegramFileId: "CQACAgQAAxkBAAICYW...",
        durationSeconds: 278,
      },
    ],
  });

  console.log(`✅ Successfully seeded "${album.title}" by ${artist.name}!`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## 7. Production Deployment (Docker + Nginx + SSL)

### Dockerfile
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

### `docker-compose.yml`
```yaml
version: "3.8"

services:
  postgres:
    image: postgres:15-alpine
    container_name: gospel_postgres
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: StrongProductionPassword123!
      POSTGRES_DB: gospel_bot
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - bot_network

  app:
    build: .
    container_name: gospel_bot_app
    restart: always
    ports:
      - "4000:4000"
    environment:
      NODE_ENV: production
      PORT: 4000
      HOST: 0.0.0.0
      APP_BASE_URL: https://bot.yourdomain.com
      DATABASE_URL: postgresql://postgres:StrongProductionPassword123!@postgres:5432/gospel_bot?schema=public
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      CHAPA_SECRET_KEY: ${CHAPA_SECRET_KEY}
      CHAPA_WEBHOOK_SECRET: ${CHAPA_WEBHOOK_SECRET}
    depends_on:
      - postgres
    networks:
      - bot_network

networks:
  bot_network:
    driver: bridge

volumes:
  pgdata:
```

### Nginx SSL Reverse Proxy
```nginx
server {
    server_name bot.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $remote_addr;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/bot.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.yourdomain.com/privkey.pem;
}
```
