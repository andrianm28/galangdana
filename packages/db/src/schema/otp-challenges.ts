import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// codeHash is a Bun.password hash of the OTP digits, never the plaintext
// code. attempts counts failed verify attempts against THIS challenge, so
// the auth layer can lock out after N tries even within the code's validity
// window. consumedAt is set on successful verification, making the row
// unusable for a second (replay) verification even before it expires.
export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type NewOtpChallenge = typeof otpChallenges.$inferInsert;
