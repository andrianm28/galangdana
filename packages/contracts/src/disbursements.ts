import { type Static, Type } from "@sinclair/typebox";
import { MoneyJSONSchema } from "./campaigns";

export const DisbursementErrorSchema = Type.Object({ error: Type.String() });

export const BankAccountSchema = Type.Object({
  id: Type.String(),
  bankCode: Type.String(),
  bankName: Type.String(),
  accountNumber: Type.String(),
  accountHolderName: Type.String(),
  verifiedAt: Type.Union([Type.String(), Type.Null()]),
});

export const CreateBankAccountBodySchema = Type.Object({
  bankCode: Type.String(),
  bankName: Type.String(),
  accountNumber: Type.String(),
  accountHolderName: Type.String(),
});

export const BankAccountListResponseSchema = Type.Object({
  bankAccounts: Type.Array(BankAccountSchema),
});

export const DisbursementStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("otp_pending"),
  Type.Literal("requested"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("processing"),
  Type.Literal("paid"),
  Type.Literal("failed"),
]);

export const DisbursementTypeSchema = Type.Union([Type.Literal("partial"), Type.Literal("final")]);

export const DisbursementDetailSchema = Type.Object({
  id: Type.String(),
  campaignId: Type.String(),
  bankAccountId: Type.Union([Type.String(), Type.Null()]),
  type: Type.Union([DisbursementTypeSchema, Type.Null()]),
  amount: Type.Union([MoneyJSONSchema, Type.Null()]),
  narrative: Type.Union([Type.String(), Type.Null()]),
  proofObjectKey: Type.Union([Type.String(), Type.Null()]),
  status: DisbursementStatusSchema,
  otpVerifiedAt: Type.Union([Type.String(), Type.Null()]),
  rejectedReason: Type.Union([Type.String(), Type.Null()]),
  payoutRef: Type.Union([Type.String(), Type.Null()]),
  paidAt: Type.Union([Type.String(), Type.Null()]),
  withdrawableAmount: MoneyJSONSchema,
});

export const CreateDisbursementResponseSchema = Type.Object({ id: Type.String() });

export const SaveDisbursementBankAccountBodySchema = Type.Object({ bankAccountId: Type.String() });

export const SaveDisbursementDetailBodySchema = Type.Object({
  type: DisbursementTypeSchema,
  amountStr: Type.String(),
  narrative: Type.String(),
});

export const PresignDisbursementProofBodySchema = Type.Object({ fileName: Type.String() });

export const PresignDisbursementProofResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});

export const ConfirmDisbursementProofBodySchema = Type.Object({ objectKey: Type.String() });

export const RequestDisbursementOtpResponseSchema = Type.Object({ sent: Type.Boolean() });

export const VerifyDisbursementOtpBodySchema = Type.Object({ code: Type.String() });

export const VerifyDisbursementOtpResponseSchema = Type.Object({ verified: Type.Boolean() });

export const DisbursementActionResponseSchema = Type.Object({ status: DisbursementStatusSchema });

export const AdminDisbursementListItemSchema = Type.Object({
  id: Type.String(),
  campaignId: Type.String(),
  campaignTitle: Type.String(),
  type: DisbursementTypeSchema,
  amount: MoneyJSONSchema,
  status: DisbursementStatusSchema,
  createdAt: Type.String(),
});

export const AdminDisbursementListResponseSchema = Type.Object({
  disbursements: Type.Array(AdminDisbursementListItemSchema),
});

export const AdminDisbursementDetailSchema = Type.Object({
  id: Type.String(),
  campaignId: Type.String(),
  campaignTitle: Type.String(),
  bankAccount: Type.Object({
    bankName: Type.String(),
    accountNumber: Type.String(),
    accountHolderName: Type.String(),
    verifiedAt: Type.Union([Type.String(), Type.Null()]),
  }),
  type: DisbursementTypeSchema,
  amount: MoneyJSONSchema,
  narrative: Type.String(),
  proofViewUrl: Type.Union([Type.String(), Type.Null()]),
  status: DisbursementStatusSchema,
  createdAt: Type.String(),
});

export const AdminRejectDisbursementBodySchema = Type.Object({ reason: Type.String() });

export const PublicDisbursementLogItemSchema = Type.Object({
  type: DisbursementTypeSchema,
  amount: MoneyJSONSchema,
  narrative: Type.String(),
  paidAt: Type.String(),
});

export const PublicDisbursementLogResponseSchema = Type.Object({
  disbursements: Type.Array(PublicDisbursementLogItemSchema),
});

export type AdminDisbursementDetailResponse = Static<typeof AdminDisbursementDetailSchema>;
export type AdminDisbursementListResponse = Static<typeof AdminDisbursementListResponseSchema>;
export type BankAccountListResponse = Static<typeof BankAccountListResponseSchema>;
export type DisbursementDetailResponse = Static<typeof DisbursementDetailSchema>;
export type PublicDisbursementLogResponse = Static<typeof PublicDisbursementLogResponseSchema>;
