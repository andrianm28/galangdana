import { type Static, Type } from "@sinclair/typebox";

// Mirrors @galangdana/money's MoneyJSON shape exactly -- contracts can't
// import a runtime value from another package's *type* declaration
// through TypeBox, so this is a parallel schema definition that must stay
// in sync with packages/money/src/money.ts's MoneyJSON interface by hand.
export const MoneyJSONSchema = Type.Object({
  amount: Type.String(),
  currency: Type.Union([Type.Literal("IDR"), Type.Literal("USD")]),
});
export type MoneyJSONResponse = Static<typeof MoneyJSONSchema>;

export const CampaignCategorySchema = Type.Object({
  id: Type.Number(),
  slug: Type.String(),
  title: Type.String(),
});

export const CampaignerSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.Union([Type.Literal("individual"), Type.Literal("yayasan"), Type.Literal("platform")]),
  displayName: Type.String(),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  verified: Type.Boolean(),
});

// The shared shape between a list-item card and a detail page -- every
// field a <CampaignCard> needs to render, plus the model/goal/expiry
// fields needed to pick goal-vs-program display logic without a second
// round trip.
export const CampaignSummarySchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  title: Type.String(),
  shortDescription: Type.String(),
  coverImageUrl: Type.String(),
  category: CampaignCategorySchema,
  campaigner: CampaignerSchema,
  model: Type.Union([Type.Literal("goal"), Type.Literal("program")]),
  goalAmount: Type.Union([MoneyJSONSchema, Type.Null()]),
  collectedAmount: MoneyJSONSchema,
  availableAmount: MoneyJSONSchema,
  donationCount: Type.Number(),
  expiresAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  publishedAt: Type.String({ format: "date-time" }),
});
export type CampaignSummaryResponse = Static<typeof CampaignSummarySchema>;

export const CampaignDetailSchema = Type.Composite([
  CampaignSummarySchema,
  Type.Object({
    story: Type.String(),
  }),
]);
export type CampaignDetailResponse = Static<typeof CampaignDetailSchema>;

export const CampaignListQuerySchema = Type.Object({
  category: Type.Optional(Type.String()),
  campaignerType: Type.Optional(
    Type.Union([Type.Literal("individual"), Type.Literal("yayasan"), Type.Literal("platform")]),
  ),
  sort: Type.Optional(Type.Union([Type.Literal("urgent"), Type.Literal("newest")])),
  page: Type.Optional(Type.Number({ minimum: 1 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});

export const CampaignListResponseSchema = Type.Object({
  campaigns: Type.Array(CampaignSummarySchema),
  page: Type.Number(),
  totalPages: Type.Number(),
  totalCount: Type.Number(),
});
export type CampaignListResponse = Static<typeof CampaignListResponseSchema>;

export const CampaignErrorSchema = Type.Object({
  error: Type.String(),
});

export const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1 }),
  category: Type.Optional(Type.String()),
});

export const SearchResponseSchema = Type.Object({
  results: Type.Array(CampaignSummarySchema),
  query: Type.String(),
});
export type SearchResponse = Static<typeof SearchResponseSchema>;

export const CreateCampaignFromDraftBodySchema = Type.Object({
  draftId: Type.String({ format: "uuid" }),
});

export const CreateCampaignFromDraftResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
});

export const CampaignErrorSchema2c = Type.Object({ error: Type.String() });

export const SaveKycIdentityBodySchema = Type.Object({
  fullName: Type.String({ minLength: 1 }),
  nationalId: Type.String({ minLength: 16, maxLength: 16 }),
  dateOfBirth: Type.String({ minLength: 1 }),
});

export const SaveKycContactBodySchema = Type.Object({
  address: Type.String({ minLength: 1 }),
  city: Type.String({ minLength: 1 }),
  postalCode: Type.String({ minLength: 1 }),
});

export const KycDocumentTypeSchema = Type.Union([Type.Literal("ktp"), Type.Literal("selfie")]);

export const PresignKycDocumentBodySchema = Type.Object({
  documentType: KycDocumentTypeSchema,
  fileName: Type.String({ minLength: 1 }),
});

export const PresignKycDocumentResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});
export type PresignKycDocumentResponse = Static<typeof PresignKycDocumentResponseSchema>;

export const ConfirmKycDocumentBodySchema = Type.Object({
  documentType: KycDocumentTypeSchema,
  objectKey: Type.String({ minLength: 1 }),
});

export const KycStatusSchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  campaignTitle: Type.String(),
  campaignSlug: Type.String(),
  campaignStatus: Type.String(),
  fullName: Type.Union([Type.String(), Type.Null()]),
  nationalId: Type.Union([Type.String(), Type.Null()]),
  dateOfBirth: Type.Union([Type.String(), Type.Null()]),
  address: Type.Union([Type.String(), Type.Null()]),
  city: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  ktpObjectKey: Type.Union([Type.String(), Type.Null()]),
  selfieObjectKey: Type.Union([Type.String(), Type.Null()]),
  consentedAt: Type.Union([Type.String(), Type.Null()]),
});
export type KycStatusResponse = Static<typeof KycStatusSchema>;

export const SubmitCampaignResponseSchema = Type.Object({
  status: Type.String(),
});
export type SubmitCampaignResponse = Static<typeof SubmitCampaignResponseSchema>;
