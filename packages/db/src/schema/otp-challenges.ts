import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// codeHash is a Bun.password hash of the OTP digits, never the plaintext
// code. attempts counts verify attempts consumed against THIS challenge
// (capped at MAX_VERIFY_ATTEMPTS in otp.ts), so the auth layer can lock
// out after N tries even within the code's validity window. consumedAt
// is set on successful verification, making the row unusable for a
// second (replay) verification even before it expires.
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // verifyOtp() runs `WHERE phone = ? AND consumed_at IS NULL ORDER BY
    // created_at DESC LIMIT 1` on every single OTP verify -- the hottest
    // query in this subsystem -- and had no supporting index at all. The
    // final whole-branch review re-raised this (it was deferred earlier
    // as "not yet needed") once whole-branch context showed it's live on
    // this exact hot path today, not a forward-looking concern.
    index("otp_challenges_phone_created_at_idx").on(table.phone, table.createdAt),
  ],
);

export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type NewOtpChallenge = typeof otpChallenges.$inferInsert;
