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
  private getClient() {
    return axios.create({
      baseURL: ENV.CHAPA_API_URL,
      headers: {
        Authorization: `Bearer ${ENV.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

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

    const client = this.getClient();
    const response = await client.post("/transaction/initialize", payload);

    if (response.data && response.data.status === "success" && response.data.data?.checkout_url) {
      return response.data.data.checkout_url;
    }

    throw new Error(
      `Failed to initialize Chapa transaction: ${response.data?.message || "Invalid response from Chapa"}`
    );
  }

  /**
   * Verifies the authenticity of an incoming Chapa webhook request using HMAC SHA-256.
   */
  verifyWebhookSignature(signatureHeader: string | undefined, rawBody: string): boolean {
    if (!signatureHeader || !ENV.CHAPA_WEBHOOK_SECRET) {
      return false;
    }

    const calculatedHash = crypto
      .createHmac("sha256", ENV.CHAPA_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    const calculatedBuf = Buffer.from(calculatedHash, "utf-8");
    const signatureBuf = Buffer.from(signatureHeader, "utf-8");

    if (calculatedBuf.length !== signatureBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(calculatedBuf, signatureBuf);
  }
}

export const chapaService = new ChapaService();
