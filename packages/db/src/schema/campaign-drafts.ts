import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { campaignCategories } from "./categories";
import { users } from "./users";

export const campaignDraftTrackEnum = pgEnum("campaign_draft_track", ["medical", "non_medical"]);

// `answers` deliberately stays a loosely-typed jsonb bag for the simple,
// single-field wizard steps (title, a short purpose blurb, a call-to-action
// line, the goal amount) rather than one dedicated column per step -- this
// matches the master plan's own domain model ("campaign_drafts -- track,
// current_step, answers jsonb"). A goal amount inside this jsonb is always
// a DECIMAL STRING (e.g. "15000000"), matching @fundforindonesia/money's
// MoneyJSON wire convention -- never a raw JS number, and never parsed to
// bigint until a real `campaigns` row is created in a later sub-phase.
// Steps with real relational shape (guided story Q&A, patient/beneficiary
// details, documents) get their own tables instead -- see
// campaign-story-answers.ts and this plan's other schema tasks.
export const campaignDrafts = pgTable("campaign_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  track: campaignDraftTrackEnum("track").notNull(),
  categoryId: integer("category_id").references(() => campaignCategories.id),
  currentStep: text("current_step").notNull().default("info"),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignDraft = typeof campaignDrafts.$inferSelect;
export type NewCampaignDraft = typeof campaignDrafts.$inferInsert;

// One row per guided-mode question (6 for medical, 7 for non-medical --
// see this plan's UI tasks for the exact per-track question sets). A
// draft using the "manual" story escape hatch instead has zero rows here
// and stores its freeform text directly in campaignDrafts.answers.story.
export const campaignStoryAnswers = pgTable(
  "campaign_story_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => campaignDrafts.id, { onDelete: "cascade" }),
    questionNumber: integer("question_number").notNull(),
    answerText: text("answer_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.draftId, table.questionNumber)],
);

export type CampaignStoryAnswer = typeof campaignStoryAnswers.$inferSelect;
export type NewCampaignStoryAnswer = typeof campaignStoryAnswers.$inferInsert;
