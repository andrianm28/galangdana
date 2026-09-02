import { type Money, money } from "@galangdana/money";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";
import { campaigners } from "./campaigners";
import { campaignCategories } from "./categories";

// Matches @galangdana/money's Currency type exactly ("IDR" | "USD").
// Campaigns in this platform are IDR in practice -- the column defaults to
// IDR below -- but USD support exists here for schema honesty and
// future-proofing, matching how the wider design's CSR/grants module needs
// multi-currency.
export const campaignCurrencyEnum = pgEnum("campaign_currency", ["IDR", "USD"]);

export const campaignModelEnum = pgEnum("campaign_model", ["goal", "program"]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "pending_review",
  "needs_revision",
  "active",
  "paused",
  "completed",
  "rejected",
]);

export const campaignTypeEnum = pgEnum("campaign_type", ["donation", "zakat", "wakaf"]);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    shortDescription: text("short_description").notNull(),
    story: text("story").notNull().default(""),
    coverMediaUrl: text("cover_media_url"),

    categoryId: integer("category_id")
      .notNull()
      .references(() => campaignCategories.id),

    campaignerId: uuid("campaigner_id")
      .notNull()
      .references(() => campaigners.id),

    // Nullable pointer back to the draft this campaign was submitted from.
    // campaign_drafts (and its child tables: story answers, patient/
    // beneficiary, documents) remain the permanent source of truth for
    // authored content -- this column is a pointer, not a duplication.
    // set null on delete: losing the scratch draft after submission is
    // fine and expected (drafts have a 7-day TTL); the campaign itself
    // must survive.
    draftId: uuid("draft_id").references(() => campaignDrafts.id, { onDelete: "set null" }),

    // Every money-bearing table in this platform carries an explicit
    // currency column, including in this foundational phase (see the plan's
    // Global Constraint). Campaigns are IDR in practice, hence the default.
    currency: campaignCurrencyEnum("currency").notNull().default("IDR"),

    type: campaignTypeEnum("type").notNull().default("donation"),
    status: campaignStatusEnum("status").notNull().default("draft"),

    // The dual model this table exists to get right:
    //   - "goal":    goalAmount is required, expiresAt is optional, UI shows
    //                a progress bar against collectedAmount.
    //   - "program": goalAmount and expiresAt are both NULL, UI shows no
    //                progress bar, and displays availableAmount ("Donasi
    //                tersedia") — a live distributable balance, not a total.
    model: campaignModelEnum("model").notNull(),
    goalAmount: bigint("goal_amount", { mode: "bigint" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Denormalized counters, recomputable from the donations/disbursements
    // tables and reconciled nightly (see Phase 2/3 plans). All amounts are
    // minor-unitless integers in the campaign's `currency` column above
    // (grants in the CSR module carry their own currency — see Phase 8 plan).
    // NOTE: default is expressed as sql`0` rather than the literal `0n`.
    // drizzle-kit 0.28.1's snapshot differ does `JSON.stringify` on the
    // generated table snapshot, and JSON.stringify cannot serialize a raw
    // BigInt (`TypeError: Do not know how to serialize a BigInt`), which
    // crashes `drizzle-kit generate` for any bigint("...", { mode: "bigint" })
    // column given a bigint literal default. Using a `sql` default goes
    // through drizzle-kit's SQL-to-string path instead, sidestepping the bug
    // with identical runtime behavior (column stays bigint-typed; DB default
    // is still 0).
    collectedAmount: bigint("collected_amount", { mode: "bigint" }).notNull().default(sql`0`),
    disbursedAmount: bigint("disbursed_amount", { mode: "bigint" }).notNull().default(sql`0`),
    donationCount: integer("donation_count").notNull().default(0),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Enforce the dual model at the data layer: a "goal" campaign must carry
    // a goal_amount; a "program" campaign must NOT carry a goal_amount or an
    // expires_at. This is what stops the model/deadline conflation the two
    // earlier design drafts got wrong from ever being representable in the
    // database, regardless of what application code does later.
    check(
      "goal_model_requires_goal_amount",
      sql`(${table.model} = 'goal' AND ${table.goalAmount} IS NOT NULL) OR
          (${table.model} = 'program' AND ${table.goalAmount} IS NULL AND ${table.expiresAt} IS NULL)`,
    ),
    // Prevents converting the same draft into two real campaigns under a
    // concurrent double-submit -- the application-level check in the
    // POST /campaigns handler closes the common case, this closes the race.
    // Partial (draft_id IS NOT NULL) so it never blocks multiple campaigns
    // that all have draftId: null.
    uniqueIndex("campaigns_draft_id_unique")
      .on(table.draftId)
      .where(sql`draft_id IS NOT NULL`),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

/**
 * The figure a campaign detail page should display, per the observed
 * platform semantics: "goal" campaigns show cumulative collectedAmount
 * against goalAmount; "program" campaigns show a live distributable
 * balance (collected minus already-disbursed), never a cumulative total.
 */
export function displayAmount(
  campaign: Pick<Campaign, "model" | "collectedAmount" | "disbursedAmount" | "currency">,
): Money {
  const amount =
    campaign.model === "goal"
      ? campaign.collectedAmount
      : campaign.collectedAmount - campaign.disbursedAmount;
  return money(amount, campaign.currency);
}
