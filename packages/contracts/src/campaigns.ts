import { type Static, Type } from "@sinclair/typebox";

// Mirrors @fundforindonesia/money's MoneyJSON shape exactly -- contracts can't
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

// ---- Phase 3: admin moderation ----

export const AdminCampaignListItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  title: Type.String(),
  campaignerName: Type.String(),
  categoryTitle: Type.String(),
  status: Type.String(),
  submittedAt: Type.Union([Type.String(), Type.Null()]),
});
export type AdminCampaignListItem = Static<typeof AdminCampaignListItemSchema>;

export const AdminCampaignListResponseSchema = Type.Object({
  campaigns: Type.Array(AdminCampaignListItemSchema),
});

export const AdminCampaignRevisionSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  field: Type.String(),
  note: Type.String(),
  status: Type.String(),
  createdAt: Type.String(),
  resolvedAt: Type.Union([Type.String(), Type.Null()]),
});
export type AdminCampaignRevision = Static<typeof AdminCampaignRevisionSchema>;

export const AdminCampaignDocumentSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.String(),
  viewUrl: Type.String(),
  uploadedAt: Type.String(),
});

export const AdminCampaignDetailResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  title: Type.String(),
  shortDescription: Type.String(),
  story: Type.String(),
  status: Type.String(),
  model: Type.Union([Type.Literal("goal"), Type.Literal("program")]),
  goalAmount: Type.Union([MoneyJSONSchema, Type.Null()]),
  category: CampaignCategorySchema,
  campaignerName: Type.String(),
  verification: Type.Object({
    fullName: Type.String(),
    nationalId: Type.String(),
    dateOfBirth: Type.String(),
    address: Type.String(),
    city: Type.String(),
    postalCode: Type.String(),
    ktpViewUrl: Type.Union([Type.String(), Type.Null()]),
    selfieViewUrl: Type.Union([Type.String(), Type.Null()]),
    status: Type.String(),
  }),
  documents: Type.Array(AdminCampaignDocumentSchema),
  revisions: Type.Array(AdminCampaignRevisionSchema),
});
export type AdminCampaignDetailResponse = Static<typeof AdminCampaignDetailResponseSchema>;

export const AdminRequestRevisionFieldSchema = Type.Union([
  Type.Literal("cerita"),
  Type.Literal("target_donasi"),
  Type.Literal("kartu_mahasiswa"),
  Type.Literal("kartu_pelajar"),
  Type.Literal("tagihan_rumah_sakit"),
  Type.Literal("tagihan_institusi_pendidikan"),
  Type.Literal("media_sosial"),
  Type.Literal("sumber_gambar"),
]);

export const AdminRequestRevisionBodySchema = Type.Object({
  items: Type.Array(
    Type.Object({ field: AdminRequestRevisionFieldSchema, note: Type.String({ minLength: 1 }) }),
    { minItems: 1 },
  ),
});

export const AdminActionResponseSchema = Type.Object({ status: Type.String() });

// ---- Phase 3: campaigner-facing revisions + content edits ----

export const CampaignRevisionListResponseSchema = Type.Object({
  story: Type.String(),
  goalAmount: Type.Union([MoneyJSONSchema, Type.Null()]),
  revisions: Type.Array(AdminCampaignRevisionSchema),
});
export type CampaignRevisionListResponse = Static<typeof CampaignRevisionListResponseSchema>;

export const SaveCampaignStoryBodySchema = Type.Object({ story: Type.String({ minLength: 1 }) });
export const SaveCampaignGoalAmountBodySchema = Type.Object({
  goalAmountStr: Type.String({ pattern: "^\\d+$" }),
});

export const CampaignRevisionDocumentTypeSchema = Type.Union([
  Type.Literal("kartu_mahasiswa"),
  Type.Literal("kartu_pelajar"),
  Type.Literal("tagihan_rumah_sakit"),
  Type.Literal("tagihan_institusi_pendidikan"),
  Type.Literal("media_sosial"),
  Type.Literal("sumber_gambar"),
]);

export const PresignCampaignDocumentBodySchema = Type.Object({
  documentType: CampaignRevisionDocumentTypeSchema,
  fileName: Type.String({ minLength: 1 }),
});
export const PresignCampaignDocumentResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});
export type PresignCampaignDocumentResponse = Static<typeof PresignCampaignDocumentResponseSchema>;

export const ConfirmCampaignDocumentBodySchema = Type.Object({
  documentType: CampaignRevisionDocumentTypeSchema,
  objectKey: Type.String(),
});

export const MyCampaignsResponseSchema = Type.Object({
  campaigns: Type.Array(
    Type.Object({
      id: Type.String({ format: "uuid" }),
      slug: Type.String(),
      title: Type.String(),
      status: Type.String(),
    }),
  ),
});
