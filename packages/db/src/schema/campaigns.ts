import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { campaignCategories } from "./categories";

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
    // IDR minor-unitless integers; currency is fixed at IDR for campaigns
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
  campaign: Pick<Campaign, "model" | "collectedAmount" | "disbursedAmount">,
): bigint {
  return campaign.model === "goal"
    ? campaign.collectedAmount
    : campaign.collectedAmount - campaign.disbursedAmount;
}
