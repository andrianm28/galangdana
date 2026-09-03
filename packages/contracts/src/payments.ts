import { type Static, Type } from "@sinclair/typebox";
import { MoneyJSONSchema } from "./campaigns";

export const PaymentErrorSchema = Type.Object({ error: Type.String() });

export const CreateDonationBodySchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  // Minor-unit rupiah as a decimal string, never a JSON number -- same
  // convention as SaveCampaignGoalAmountBodySchema.
  amountStr: Type.String({ pattern: "^\\d+$", maxLength: 15 }),
  isAnonymous: Type.Optional(Type.Boolean()),
  comment: Type.Optional(Type.String({ maxLength: 500 })),
});

export const CreateDonationResponseSchema = Type.Object({
  donationId: Type.String({ format: "uuid" }),
  vaNumber: Type.String(),
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
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.String({ format: "date-time" }),
  paidAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});
export type GetDonationResponse = Static<typeof GetDonationResponseSchema>;
