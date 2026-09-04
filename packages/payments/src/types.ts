export type PaymentMethod = "bank_transfer_va";

export interface ChargeInput {
  orderId: string;
  grossAmount: bigint;
  currency: "IDR" | "USD";
}

export interface ChargeResult {
  providerOrderId: string;
  method: PaymentMethod;
  vaNumber: string;
  expiresAt: Date;
}

export interface WebhookEvent {
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
