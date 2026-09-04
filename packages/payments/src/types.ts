export type PaymentMethod = "bank_transfer_va" | "qris_redirect";

export interface ChargeInput {
  orderId: string;
  grossAmount: bigint;
  currency: "IDR" | "USD";
  // Only meaningful for redirect-based methods (Sumopod) -- where to send
  // the donor after they finish (or cancel) on the provider's hosted page.
  // Ignored by providers that don't need it (the mock VA flow).
  successReturnUrl?: string;
  cancelReturnUrl?: string;
}

export type ChargeResult =
  | {
      providerOrderId: string;
      method: "bank_transfer_va";
      vaNumber: string;
      expiresAt: Date;
    }
  | {
      providerOrderId: string;
      method: "qris_redirect";
      redirectUrl: string;
      expiresAt: Date;
    };

export interface WebhookEvent {
  // "mock" | "sumopod" -- which provider actually delivered this event.
  // The webhook-processing code uses this for the payment_events dedup
  // guard's UNIQUE(provider, providerEventId) constraint; it was
  // previously hardcoded to the literal "mock" everywhere, which was
  // silently wrong (harmless with one provider, not with two).
  provider: string;
  providerEventId: string;
  providerOrderId: string;
  status: "paid" | "failed" | "expired";
  rawPayload: unknown;
}

export interface PaymentStatus {
  providerOrderId: string;
  status: "pending" | "paid" | "failed" | "expired";
}

/**
 * Field names mirror Xendit's current Payouts API v2 (reference_id +
 * channel_code + channel_properties), not the older Disbursement API's
 * external_id/bank_code -- verified via docs.xendit.co, see mock-provider.ts's
 * createPayout for detail. accountNumber/accountHolderName correspond to
 * Xendit's nested channel_properties object; channelCode is e.g. "ID_BCA".
 */
export interface PayoutInput {
  referenceId: string;
  amount: bigint;
  channelCode: string;
  accountNumber: string;
  accountHolderName: string;
  description: string;
}

export interface PayoutResult {
  payoutId: string;
  status: "pending" | "completed" | "failed";
}

export interface PaymentProvider {
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  parseWebhook(req: Request): Promise<WebhookEvent>;
  getStatus(orderId: string): Promise<PaymentStatus>;
  createPayout(input: PayoutInput): Promise<PayoutResult>;
}
