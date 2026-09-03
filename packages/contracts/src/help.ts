import { type Static, Type } from "@sinclair/typebox";

export const HelpErrorSchema = Type.Object({ error: Type.String() });

export const HelpArticleSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  question: Type.String(),
  answer: Type.String(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});
export type HelpArticleResponse = Static<typeof HelpArticleSchema>;

export const HelpArticleListResponseSchema = Type.Object({
  articles: Type.Array(HelpArticleSchema),
});
export type HelpArticleListResponse = Static<typeof HelpArticleListResponseSchema>;

// Slugs are lowercase-kebab-case and immutable after creation (see this
// plan's "Explicitly Out of Scope" notes -- no draft/rename workflow).
export const CreateHelpArticleBodySchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-z0-9-]+$" }),
  question: Type.String({ minLength: 1, maxLength: 300 }),
  answer: Type.String({ minLength: 1, maxLength: 10000 }),
});

export const UpdateHelpArticleBodySchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 300 }),
  answer: Type.String({ minLength: 1, maxLength: 10000 }),
});

export const SubmitSupportTicketBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ format: "email" }),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
});

export const SubmitSupportTicketResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});
export type SubmitSupportTicketResponse = Static<typeof SubmitSupportTicketResponseSchema>;

export const SupportTicketStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("resolved"),
]);

export const SupportTicketSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  email: Type.String(),
  message: Type.String(),
  status: SupportTicketStatusSchema,
  createdAt: Type.String({ format: "date-time" }),
  resolvedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export const AdminSupportTicketListResponseSchema = Type.Object({
  tickets: Type.Array(SupportTicketSchema),
});
export type AdminSupportTicketListResponse = Static<typeof AdminSupportTicketListResponseSchema>;
