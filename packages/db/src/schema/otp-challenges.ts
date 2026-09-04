import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Existing rows (all pre-Phase-6 login OTPs) get "login" via the
// migration's server_default -- see Step 5. A disbursement OTP
// challenge must never verify a login attempt and vice versa; every
// query in otp.ts (Task 3) filters on purpose, not just phone.
export const otpPurposeEnum = pgEnum("otp_purpose", ["login", "disbursement"]);

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
    purpose: otpPurposeEnum("purpose").notNull().default("login"),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The existing (phone, createdAt) index no longer fully matches
    // verifyOtp's WHERE clause once purpose is added (Task 3) -- extend
    // it to (phone, purpose, createdAt) rather than adding a second index.
    index("otp_challenges_phone_purpose_created_at_idx").on(
      table.phone,
      table.purpose,
      table.createdAt,
    ),
  ],
);

export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type NewOtpChallenge = typeof otpChallenges.$inferInsert;
