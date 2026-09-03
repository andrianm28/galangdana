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

export interface PayoutInput {
  orderId: string;
  amount: bigint;
  bankAccount: string;
  bankCode: string;
}

export interface PayoutResult {
  payoutId: string;
}

export interface PaymentProvider {
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  parseWebhook(req: Request): Promise<WebhookEvent>;
  getStatus(orderId: string): Promise<PaymentStatus>;
  createPayout(input: PayoutInput): Promise<PayoutResult>;
}
