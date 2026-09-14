import Fastify, { FastifyInstance } from "fastify";
import { ENV } from "./config/env";
import { chapaService } from "./services/chapa.service";
import { DeliveryService } from "./services/delivery.service";
import { bot, prisma } from "./bot/bot";

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  // Preserve raw body buffer for cryptographically accurate webhook signature verification
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    try {
      const rawString = body.toString("utf-8");
      (req as any).rawBody = rawString;
      const parsed = rawString ? JSON.parse(rawString) : {};
      done(null, parsed);
    } catch (err: any) {
      done(err, undefined);
    }
  });

  const deliveryService = new DeliveryService(bot, prisma);

  // Health check endpoint
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Chapa Webhook Endpoint
  app.post("/api/v1/payments/chapa/webhook", async (request, reply) => {
    const signature = request.headers["x-chapa-signature"] as string | undefined;
    const rawBody = (request as any).rawBody || JSON.stringify(request.body);

    // 1. Signature Verification (Enforced when webhook secret is configured)
    if (ENV.CHAPA_WEBHOOK_SECRET) {
      const isValid = chapaService.verifyWebhookSignature(signature, rawBody);
      if (!isValid) {
        app.log.warn({ signature }, "Unauthorized Chapa webhook signature mismatch");
        return reply.status(401).send({ error: "Invalid signature" });
      }
    }

    const payload = request.body as {
      event?: string;
      status?: string;
      tx_ref?: string;
      reference?: string;
      amount?: string;
    };

    app.log.info({ tx_ref: payload.tx_ref, status: payload.status }, "Chapa webhook received");

    if (payload.status === "success" && payload.tx_ref) {
      const { tx_ref } = payload;

      // 2. Fetch Pending Order
      const order = await prisma.order.findUnique({
        where: { txRef: tx_ref },
      });

      if (!order) {
        app.log.error({ tx_ref }, "Order matching tx_ref not found");
        return reply.status(404).send({ error: "Order not found" });
      }

      // Idempotency: If already fulfilled, acknowledge immediately without duplicate delivery
      if (order.status === "COMPLETED") {
        app.log.info({ tx_ref }, "Order already fulfilled. Skipping duplicate delivery.");
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
        app.log.info(
          { orderId: updatedOrder.id, userId: updatedOrder.telegramUserId.toString() },
          "Album tracks successfully delivered"
        );
      } catch (deliveryError) {
        app.log.error({ deliveryError, orderId: updatedOrder.id }, "Error delivering album tracks");
      }
    }

    return reply.status(200).send({ status: "ok" });
  });

  return app;
}
