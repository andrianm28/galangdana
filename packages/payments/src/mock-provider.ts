import { computeMidtransSignature, verifyMidtransSignature } from "./signature";
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  PayoutInput,
  PayoutResult,
  WebhookEvent,
} from "./types";

const VA_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Behaves like a real bank-transfer-VA provider (generates a VA number,
 * accepts webhook payloads shaped and signed exactly like Midtrans's real
 * ones -- see signature.ts) without any real network call or third-party
 * dependency. See this plan's "Explicitly Out of Scope" section for why a
 * real MidtransProvider isn't built yet.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly serverKey: string;
  // In-memory charge registry keyed by providerOrderId -- fine for this
  // mock (no real persistence needed; apps/api persists the real payments
  // row itself), but means a MockPaymentProvider instance's charges don't
  // survive a process restart. Every consumer in this plan constructs one
  // instance per request/test, which is why this is safe.
  private readonly charges = new Map<string, ChargeResult>();

  constructor(config: { serverKey: string }) {
    this.serverKey = config.serverKey;
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    // A deterministic-looking VA number derived from the order id, not
    // cryptographically meaningful -- this is a mock, the only property
    // that matters is "looks like a real VA number and is stable per
    // order". Real bank VA numbers are typically 10-16 digits.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.orderId));
    const vaNumber = Array.from(new Uint8Array(digest).slice(0, 7))
      .map((b) => b.toString().padStart(3, "0"))
      .join("")
      .slice(0, 14);
    const result: ChargeResult = {
      providerOrderId: input.orderId,
      method: "bank_transfer_va",
      vaNumber,
      expiresAt: new Date(Date.now() + VA_EXPIRY_MS),
    };
    this.charges.set(input.orderId, result);
    return result;
  }

  /**
   * Test/dev-only helper -- not part of the PaymentProvider interface.
   * Produces a webhook payload shaped and signed exactly like a real
   * Midtrans notification, for a charge this same instance created.
   */
  async simulateWebhookPayload(
    orderId: string,
    grossAmount: bigint,
    transactionStatus = "settlement",
  ): Promise<Record<string, unknown>> {
    const statusCode = "200";
    const grossAmountStr = `${grossAmount.toString()}.00`;
    const signature = await computeMidtransSignature(
      { orderId, statusCode, grossAmount: grossAmountStr },
      this.serverKey,
    );
    return {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmountStr,
      transaction_status: transactionStatus,
      transaction_id: `evt-${orderId}-${Date.now()}`,
      signature_key: signature,
    };
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const body = (await req.json()) as Record<string, unknown>;
    const orderId = String(body.order_id ?? "");
    const statusCode = String(body.status_code ?? "");
    const grossAmount = String(body.gross_amount ?? "");
    const providedSignature = String(body.signature_key ?? "");

    const valid = await verifyMidtransSignature(
      { orderId, statusCode, grossAmount },
      providedSignature,
      this.serverKey,
    );
    if (!valid) {
      throw new Error("invalid webhook signature");
    }

    const transactionStatus = String(body.transaction_status ?? "");
    const status: WebhookEvent["status"] =
      transactionStatus === "settlement" || transactionStatus === "capture"
        ? "paid"
        : transactionStatus === "expire"
          ? "expired"
          : "failed";

    return {
      providerEventId: String(body.transaction_id ?? ""),
      providerOrderId: orderId,
      status,
      rawPayload: body,
    };
  }

  async getStatus(orderId: string): Promise<PaymentStatus> {
    // No real reconciler consumes this in this plan (see "Explicitly Out
    // of Scope") -- implemented for interface completeness and so a real
    // adapter's getStatus has a mock counterpart to test the reconciler
    // against later.
    const charge = this.charges.get(orderId);
    return { providerOrderId: orderId, status: charge ? "pending" : "failed" };
  }

  async createPayout(input: PayoutInput): Promise<PayoutResult> {
    // Mirrors Xendit's current Payouts API v2 response shape (an "id" field
    // and a "status" field valued from {ACCEPTED, REQUESTED,
    // PENDING_COMPLIANCE_ASSESSMENT, COMPLIANCE_REJECTED, SUCCEEDED, FAILED,
    // CANCELLED, REVERSED} -- verified via docs.xendit.co during Task 4's
    // research, see task-4-report.md) rather than the older Disbursement
    // API's PENDING/COMPLETED/FAILED vocabulary this task's brief originally
    // sketched -- so a real XenditProvider later reuses this exact
    // interface unchanged, matching how MockPaymentProvider's
    // createCharge/parseWebhook already mirror Midtrans's real wire format.
    // This mock completes synchronously ("completed" immediately,
    // corresponding to Xendit's terminal SUCCEEDED state) since there's no
    // async payout queue in this slice (see this plan's Scope Note) -- a
    // real adapter's createPayout would return "pending" (Xendit's initial
    // ACCEPTED/REQUESTED states) and complete later via the
    // x-callback-token-verified callback, which this plan's Task 8 does not
    // yet consume.
    return {
      payoutId: `payout-${input.referenceId}`,
      status: "completed",
    };
  }
}
