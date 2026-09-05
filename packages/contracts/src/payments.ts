import { type Static, Type } from "@sinclair/typebox";
import { MoneyJSONSchema } from "./campaigns";

export const PaymentErrorSchema = Type.Object({ error: Type.String() });

export const PaymentMethodSchema = Type.Union([
  Type.Literal("bank_transfer_va"),
  Type.Literal("qris_redirect"),
]);

export const CreateDonationBodySchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  // Minor-unit rupiah as a decimal string, never a JSON number -- same
  // convention as SaveCampaignGoalAmountBodySchema.
  amountStr: Type.String({ pattern: "^\\d+$", maxLength: 15 }),
  paymentMethod: PaymentMethodSchema,
  isAnonymous: Type.Optional(Type.Boolean()),
  comment: Type.Optional(Type.String({ maxLength: 500 })),
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
  amount: MoneyJSONSchema,
  status: DonationStatusSchema,
  method: PaymentMethodSchema,
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  redirectUrl: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.String({ format: "date-time" }),
  paidAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});
export type GetDonationResponse = Static<typeof GetDonationResponseSchema>;
