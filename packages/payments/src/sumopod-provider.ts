import { verifySumopodSignature } from "./sumopod-signature";
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  PayoutInput,
  PayoutResult,
  WebhookEvent,
} from "./types";

export class SumopodProvider implements PaymentProvider {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;

  constructor(config: { apiKey: string; webhookSecret: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = config.baseUrl ?? "https://api-pay-sandbox.sumopod.com";
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        order_id: input.orderId,
        // IDR has no minor unit; realistic donation amounts are far under
        // Number.MAX_SAFE_INTEGER, so this bigint->Number crossing is safe
        // -- Sumopod's API is a plain-JSON-number wire format, this is the
        // one place in this codebase's payment code that isn't bigint.
        amount: Number(input.grossAmount),
        currency: input.currency,
        expires_in_hours: 24,
        success_return_url: input.successReturnUrl,
        cancel_return_url: input.cancelReturnUrl,
        payment_method_type_code: "QRIS",
      }),
    });

    if (!res.ok) {
      throw new Error(`Sumopod createCharge failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      payment_id: string;
      order_id: string;
      payment_link_url: string;
      expires_at: string;
    };

    return {
      // Our own order id, not Sumopod's payment_id -- mirrors
      // MockPaymentProvider's own convention (providerOrderId: input.orderId
      // there too) so that this same value is what parseWebhook's
      // `body.data.order_id` echoes back later, and the two sides always
      // correlate. Sumopod's payment_id is only used as the dedup key for
      // providerEventId, never for this correlation.
      providerOrderId: input.orderId,
      method: "qris_redirect",
      redirectUrl: data.payment_link_url,
      expiresAt: new Date(data.expires_at),
    };
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const rawBody = await req.text();
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const svixSignature = req.headers.get("svix-signature") ?? "";

    const valid = await verifySumopodSignature(
      this.webhookSecret,
      svixId,
      svixTimestamp,
      svixSignature,
      rawBody,
    );
    if (!valid) {
      throw new Error("invalid webhook signature");
    }

    const body = JSON.parse(rawBody) as {
      event_type: string;
      data: { payment_id: string; order_id: string; status: string };
    };

    const status: WebhookEvent["status"] =
      body.event_type === "payment.completed"
        ? "paid"
        : body.event_type === "payment.expired"
          ? "expired"
          : "failed";

    return {
      provider: "sumopod",
      // Sumopod doesn't send a distinct delivery/event id in the payload
      // shown in their docs -- payment_id is the closest stable per-payment
      // identifier. This means a genuine retry of the SAME event (same
      // payment_id, same event_type) would collide on the payment_events
      // dedup guard's UNIQUE(provider, providerEventId) constraint and be
      // correctly treated as a no-op duplicate -- which is the guard's
      // actual job. If Sumopod's real delivery includes a distinct event
      // id under a field this documentation excerpt didn't show, prefer
      // that instead; this is the best available identifier from what was
      // documented.
      providerEventId: `${body.data.payment_id}:${body.event_type}`,
      providerOrderId: body.data.order_id,
      status,
      rawPayload: body,
    };
  }

  async getStatus(_orderId: string): Promise<PaymentStatus> {
    throw new Error(
      "SumopodProvider.getStatus is not implemented -- no get-payment-by-id endpoint was documented",
    );
  }

  async createPayout(_input: PayoutInput): Promise<PayoutResult> {
    throw new Error(
      "SumopodProvider.createPayout is not implemented -- Sumopod's documented API has no disbursement endpoint",
    );
  }
}
