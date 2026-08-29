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
