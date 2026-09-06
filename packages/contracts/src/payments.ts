import { type Static, Type } from "@sinclair/typebox";
import { MoneyJSONSchema } from "./campaigns";

export const PaymentErrorSchema = Type.Object({ error: Type.String() });

export const PaymentMethodSchema = Type.Union([
  Type.Literal("bank_transfer_va"),
  Type.Literal("qris_redirect"),
]);

/**
 * Donation bounds, shared by the client and the route so they cannot drift.
 *
 * There was no floor at all: `^\\d+$` accepted "1", so a Rp 1 donation was
 * creatable, which costs more in payment-provider fees than it delivers and is
 * the standard shape of card-testing traffic. Rp 10.000 matches the market
 * convention Indonesian donors already expect.
 *
 * The ceiling is a typo guard, not a policy: at Rp 500.000.000 a mistyped extra
 * zero is caught before it reaches a payment provider, and a genuine donation
 * of that size is a conversation, not a form submission.
 */
export const MIN_DONATION_RUPIAH = 10_000n;
export const MAX_DONATION_RUPIAH = 500_000_000n;

export function validateDonationAmount(
  amountStr: string,
): { ok: true } | { ok: false; error: string } {
  if (!/^\d+$/.test(amountStr)) return { ok: false, error: "amount_invalid" };
  const amount = BigInt(amountStr);
  if (amount < MIN_DONATION_RUPIAH) return { ok: false, error: "amount_below_minimum" };
  if (amount > MAX_DONATION_RUPIAH) return { ok: false, error: "amount_above_maximum" };
  return { ok: true };
}

export const CreateDonationBodySchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  // Minor-unit rupiah as a decimal string, never a JSON number -- same
  // convention as SaveCampaignGoalAmountBodySchema.
  amountStr: Type.String({ pattern: "^\\d+$", maxLength: 15 }),
  paymentMethod: PaymentMethodSchema,
  isAnonymous: Type.Optional(Type.Boolean()),
  comment: Type.Optional(Type.String({ maxLength: 500 })),
  // Optional on purpose. Asking for contact details before taking money costs
  // conversion, and a donor who declines still gets the on-screen receipt --
  // they simply cannot be sent one later. Without this the donation_receipt
  // outbox row had no destination at all for a guest.
  contactChannel: Type.Optional(Type.Union([Type.Literal("email"), Type.Literal("whatsapp")])),
  contactValue: Type.Optional(Type.String({ maxLength: 200 })),
  displayName: Type.Optional(Type.String({ maxLength: 60 })),
});

export const CreateDonationResponseSchema = Type.Object({
  donationId: Type.String({ format: "uuid" }),
  method: PaymentMethodSchema,
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  redirectUrl: Type.Union([Type.String(), Type.Null()]),
  amount: MoneyJSONSchema,
  expiresAt: Type.String({ format: "date-time" }),
});
export type CreateDonationResponse = Static<typeof CreateDonationResponseSchema>;

export const DonationStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("paid"),
  Type.Literal("expired"),
  Type.Literal("failed"),
  Type.Literal("refunded"),
]);

export const GetDonationResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  campaignId: Type.String({ format: "uuid" }),
  // The campaign is named here so a receipt is one request, not two. A
  // kuitansi that says only "campaign 8f3c-..." is not a receipt.
  campaignTitle: Type.String(),
  campaignSlug: Type.String(),
  amount: MoneyJSONSchema,
  status: DonationStatusSchema,
  method: PaymentMethodSchema,
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  redirectUrl: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.String({ format: "date-time" }),
  paidAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  // The donor's chosen public name. Never the contact details they gave --
  // those exist to send a receipt to, not to print on one a link-holder
  // can open.
  displayName: Type.Union([Type.String(), Type.Null()]),
});
export type GetDonationResponse = Static<typeof GetDonationResponseSchema>;
