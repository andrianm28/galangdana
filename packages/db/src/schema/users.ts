import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// phone and email are both nullable+unique: a user can arrive via phone OTP
// with no email yet, or via Google OAuth with no phone yet. At least one of
// phone/email/an oauth_accounts row will exist for any real user, but the
// schema does not enforce "at least one" — that's an application-level
// invariant enforced at each signup path, not a single column constraint
// that would need to span three different auth methods.

// No self-serve admin signup or invite flow exists in this phase --
// promoting a user to "admin" is a direct database UPDATE. See this
// plan's Global Constraints for why that's an intentional decision, not
// a gap.
export const userRoleEnum = pgEnum("user_role", ["campaigner", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  defaultAnonymous: boolean("default_anonymous").notNull().default(false),
  role: userRoleEnum("role").notNull().default("campaigner"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
