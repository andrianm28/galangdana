# Phase 0b: Authentication — Phone OTP, Email/Password, Google OAuth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GalangDana a real, working authentication backend supporting the three methods the approved design calls for — phone OTP, email/password, and Google OAuth — with sessions, rate limiting, and a `GET /auth/me` / `POST /auth/logout` surface every later phase's protected routes will build on.

**Architecture:** Auth logic lives in `apps/api/src/auth/*` as focused, independently-testable modules (OTP, password, Google OAuth, sessions, rate limiting), composed by one Elysia route group in `apps/api/src/routes/auth.ts`. Sessions are Postgres-backed (durable, revocable) via `packages/db`; OTP request rate limiting uses Bun's native Redis client against the already-running `redis` docker-compose service. Password hashing uses Bun's native `Bun.password` (argon2id) — no external hashing library. SMS delivery sits behind an `SmsProvider` interface with a console-logging dev implementation, mirroring the master spec's `PaymentProvider` adapter pattern: real interface now, a real vendor (Twilio or a local gateway) plugs in once one is chosen.

**Tech Stack:** Bun (native `Bun.RedisClient`, native `Bun.password`, native `crypto.getRandomValues`), ElysiaJS (native cookie support — no plugin), Drizzle ORM, TypeBox (via `packages/contracts`). No new external dependencies are added by this plan.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` — the approved GalangDana design doc. This plan implements the "Identity & organisations" portion of its Domain model section (`users`, `sessions`, and the OTP mechanism it describes) plus the three auth methods named in that doc's Phase 0 scope line ("auth (phone OTP + email + Google — our choice)"). Everything else — organisation verification, KYC, the creation wizard, payments, etc. — is out of scope and lands in later plans.

**Builds on:** Phase 0a (merged to `master`) — the Bun workspace, `packages/db`'s Drizzle client and migration tooling, `packages/contracts`' TypeBox pattern, and `apps/api`'s Elysia app with its BigInt-safe `withApiResponseMapping` response wrapper (`apps/api/src/response-mapper.ts`) and `HealthResponseSchema`-bound `/healthz` route as the established pattern for binding contracts to routes.

## Global Constraints

- Runtime is **Bun** everywhere. This plan deliberately uses Bun's native `Bun.RedisClient`, `Bun.password`, and `crypto.getRandomValues` instead of adding `ioredis`/`bcrypt`/`uuid`-style npm dependencies — all three were verified working against this repo's actual installed Bun (1.4.0) and running Redis container before this plan was written.
- **Never store a plaintext OTP code or plaintext password.** OTP codes are hashed with `Bun.password.hash` (argon2id) before being persisted, exactly like passwords. A `codeHash`/`passwordHash` column is never populated with anything but a hash.
- **Session tokens are opaque, cryptographically random strings — never a JWT, never derived from user data.** Generated via `crypto.getRandomValues`, stored in Postgres, looked up by exact match. This makes revocation (logout, and later "log out other devices") a simple `DELETE`.
- `packages/contracts` is the single source of truth for API request/response shapes, and every route binds its schema via Elysia's `{ response: Schema }` option (the pattern Phase 0a's final review established at `apps/api/src/routes/health.ts`) — a schema that exists only in a test file is a defect, not a stylistic choice.
- Every module has one clear responsibility: OTP logic, password logic, Google OAuth logic, session logic, and rate-limiting logic are four separate files, composed by the route layer — not one large auth file.
- HTTP status codes matter and are asserted in tests (Phase 0a's final review fixed a bug where the API silently returned `200` for every error — auth is exactly the kind of surface where that class of bug is dangerous). Use `set.status` on every non-2xx response.
- No Kitabisa code, asset, or copy text is copied.

---

## File Structure

```
apps/api/src/
├── lib/
│   └── redis-client.ts          # Bun.RedisClient singleton
├── auth/
│   ├── rate-limit.ts            # OTP request rate limiting (Redis)
│   ├── otp.ts                   # OTP generate/hash/verify, find-or-create user by phone
│   ├── sms-provider.ts          # SmsProvider interface + ConsoleSmsProvider (dev)
│   ├── session.ts               # session token generation, create/validate/revoke
│   ├── password.ts              # password hashing + email register/login
│   └── google-oauth.ts          # authorization URL, code exchange, userinfo, find-or-create
├── routes/
│   └── auth.ts                  # HTTP routes composing the above; session-derive plugin
└── index.ts                     # (modified) mounts authRoute

packages/contracts/src/
└── auth.ts                      # TypeBox schemas: OTP, register/login, user, session

packages/db/src/schema/
├── users.ts
├── sessions.ts
├── otp-challenges.ts
└── oauth-accounts.ts
```

---

### Task 1: `packages/db` — `users` and `sessions` schema

**Files:**
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/sessions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/users.test.ts`
- Test: `packages/db/src/__tests__/sessions.test.ts`

**Interfaces:**
- Produces: `users` table (`User`, `NewUser` types), `sessions` table (`Session`, `NewSession` types), both exported from the schema barrel.
- Consumes: nothing new — `sessions.userId` references `users.id`.

- [ ] **Step 1: Write the `users` schema**

`packages/db/src/schema/users.ts`:
```ts
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// phone and email are both nullable+unique: a user can arrive via phone OTP
// with no email yet, or via Google OAuth with no phone yet. At least one of
// phone/email/an oauth_accounts row will exist for any real user, but the
// schema does not enforce "at least one" — that's an application-level
// invariant enforced at each signup path, not a single column constraint
// that would need to span three different auth methods.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  defaultAnonymous: boolean("default_anonymous").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 2: Write the `sessions` schema**

`packages/db/src/schema/sessions.ts`:
```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// id is the session token itself (an opaque random string generated by the
// caller — see apps/api/src/auth/session.ts), not a surrogate key. Looking
// up a session is always "does a row with this exact token exist and is it
// unexpired" — there is no separate lookup-by-id-then-check-token step.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
```

- [ ] **Step 3: Wire both into the schema barrel**

`packages/db/src/schema/index.ts` (add two lines to the existing file — do not remove `categories`/`campaigns` exports):
```ts
export * from "./categories";
export * from "./campaigns";
export * from "./users";
export * from "./sessions";
```

- [ ] **Step 4: Re-export the schema barrel from the package's public entry point**

`packages/db/src/client.ts` currently exports only `db` and `schema` (Phase 0a never needed anything more — `apps/api` didn't import from `@galangdana/db` at all yet). This plan's `apps/api` code (Tasks 4 onward) imports tables directly — `import { db, users, sessions } from "@galangdana/db"` — which requires the package's entry point to re-export the schema barrel, not just nest it under a `schema` namespace object.

Add one line to `packages/db/src/client.ts` (the file already has `import * as schema from "./schema/index";` — add the new export line anywhere after that import, e.g. directly below the existing `export { schema };` line). The full file, for reference (only the last line is new):
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://galangdana:galangdana@localhost:55434/galangdana";

const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
export { schema };
export * from "./schema/index";
```

- [ ] **Step 5: Write the failing tests**

`packages/db/src/__tests__/users.test.ts`:
```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema/users";

// Fixed test values with no natural uniqueness guard beyond the schema's own
// unique constraints -- re-running this file against the SAME persistent
// local Postgres (not a fresh CI container) would otherwise fail on the
// second run with "duplicate key value violates unique constraint". Same
// pattern as campaigns.test.ts (Phase 0a): delete any leftover rows with
// these exact values first so the file is safe to run any number of times.
const TEST_PHONES = ["+6281100000001", "+6281100000002"];
const TEST_EMAILS = ["test-users-1@example.test", "test-users-2@example.test"];

describe("users", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.phone, TEST_PHONES));
    await db.delete(users).where(inArray(users.email, TEST_EMAILS));
  });

  test("a user can be created with only a phone number", async () => {
    const [row] = await db
      .insert(users)
      .values({ phone: "+6281100000001" })
      .returning();
    expect(row?.phone).toBe("+6281100000001");
    expect(row?.email).toBeNull();
    expect(row?.passwordHash).toBeNull();
    expect(row?.defaultAnonymous).toBe(false);
  });

  test("a user can be created with only an email and password hash", async () => {
    const [row] = await db
      .insert(users)
      .values({ email: "test-users-1@example.test", passwordHash: "argon2-hash-placeholder" })
      .returning();
    expect(row?.email).toBe("test-users-1@example.test");
    expect(row?.phone).toBeNull();
  });

  test("phone must be unique across users", async () => {
    await db.insert(users).values({ phone: "+6281100000002" });
    await expect(
      Promise.resolve(db.insert(users).values({ phone: "+6281100000002" })),
    ).rejects.toThrow(/unique/i);
  });

  test("email must be unique across users", async () => {
    await db.insert(users).values({ email: "test-users-2@example.test" });
    await expect(
      Promise.resolve(db.insert(users).values({ email: "test-users-2@example.test" })),
    ).rejects.toThrow(/unique/i);
  });
});
```

`packages/db/src/__tests__/sessions.test.ts`:
```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { sessions } from "../schema/sessions";
import { users } from "../schema/users";

// Same persistent-local-Postgres idempotency concern as users.test.ts.
// Deleting the users cascades to delete their sessions too (FK
// onDelete: "cascade"), so cleaning up by phone is sufficient.
const TEST_PHONES = ["+6281100000010", "+6281100000011"];

describe("sessions", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.phone, TEST_PHONES));
  });

  test("a session references a real user and expires in the future", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: "+6281100000010" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [session] = await db
      .insert(sessions)
      .values({ id: "test-session-token-1", userId, expiresAt })
      .returning();

    expect(session?.id).toBe("test-session-token-1");
    expect(session?.userId).toBe(userId);
    expect(session?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  test("deleting a user cascades to delete their sessions", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: "+6281100000011" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    await db.insert(sessions).values({
      id: "test-session-token-2",
      userId,
      expiresAt: new Date(Date.now() + 1000),
    });

    await db.delete(users).where(eq(users.id, userId));

    const remaining = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, "test-session-token-2"));
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd packages/db && bun test __tests__/users.test.ts __tests__/sessions.test.ts`
Expected: FAIL — `relation "users" does not exist`.

- [ ] **Step 7: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate && bun run db:migrate`
Expected: a new migration file appears under `packages/db/drizzle/`; "Migrations applied." is printed.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/db && bun test __tests__/users.test.ts __tests__/sessions.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 9: Full package test run, typecheck, lint**

Run: `cd packages/db && bun test && bun run typecheck && cd ../.. && bun run lint`
Expected: all pass, all clean.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): add users and sessions schema"
```

---

### Task 2: `packages/db` — `otp_challenges` and `oauth_accounts` schema

**Files:**
- Create: `packages/db/src/schema/otp-challenges.ts`
- Create: `packages/db/src/schema/oauth-accounts.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/otp-challenges.test.ts`
- Test: `packages/db/src/__tests__/oauth-accounts.test.ts`

**Interfaces:**
- Consumes: `users` from `./users` (Task 1).
- Produces: `otpChallenges` table, `oauthAccounts` table + `oauthProviderEnum`.

- [ ] **Step 1: Write the `otp_challenges` schema**

`packages/db/src/schema/otp-challenges.ts`:
```ts
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
```

- [ ] **Step 2: Write the `oauth_accounts` schema**

`packages/db/src/schema/oauth-accounts.ts`:
```ts
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Modeled as an enum (not a bare string) even with one member today: this is
// exactly the kind of "no implicit single-value assumption" the campaigns
// currency column exists to avoid repeating -- adding a second provider
// later is an enum-value addition, not a column-type migration.
export const oauthProviderEnum = pgEnum("oauth_provider", ["google"]);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: oauthProviderEnum("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_account_unique").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type NewOauthAccount = typeof oauthAccounts.$inferInsert;
```

- [ ] **Step 3: Wire both into the schema barrel**

`packages/db/src/schema/index.ts` (append two more lines):
```ts
export * from "./categories";
export * from "./campaigns";
export * from "./users";
export * from "./sessions";
export * from "./otp-challenges";
export * from "./oauth-accounts";
```

- [ ] **Step 4: Write the failing tests**

`packages/db/src/__tests__/otp-challenges.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { db } from "../client";
import { otpChallenges } from "../schema/otp-challenges";

describe("otp_challenges", () => {
  test("a challenge is created unconsumed with zero attempts", async () => {
    const [row] = await db
      .insert(otpChallenges)
      .values({
        phone: "+6281100000020",
        codeHash: "argon2-hash-placeholder",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning();
    expect(row?.attempts).toBe(0);
    expect(row?.consumedAt).toBeNull();
  });

  test("attempts and consumedAt can be updated in place", async () => {
    const [row] = await db
      .insert(otpChallenges)
      .values({
        phone: "+6281100000021",
        codeHash: "argon2-hash-placeholder",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const id = row!.id;

    const now = new Date();
    const { eq } = await import("drizzle-orm");
    const [updated] = await db
      .update(otpChallenges)
      .set({ attempts: 1, consumedAt: now })
      .where(eq(otpChallenges.id, id))
      .returning();
    expect(updated?.attempts).toBe(1);
    expect(updated?.consumedAt?.getTime()).toBe(now.getTime());
  });
});
```

`packages/db/src/__tests__/oauth-accounts.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { db } from "../client";
import { oauthAccounts } from "../schema/oauth-accounts";
import { users } from "../schema/users";

describe("oauth_accounts", () => {
  test("links a Google account to a user", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "test-oauth-1@example.test" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const [row] = await db
      .insert(oauthAccounts)
      .values({ userId, provider: "google", providerAccountId: "google-sub-test-1" })
      .returning();
    expect(row?.provider).toBe("google");
    expect(row?.providerAccountId).toBe("google-sub-test-1");
  });

  test("the same provider account cannot be linked twice", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "test-oauth-2@example.test" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    await db
      .insert(oauthAccounts)
      .values({ userId, provider: "google", providerAccountId: "google-sub-test-2" });

    await expect(
      Promise.resolve(
        db
          .insert(oauthAccounts)
          .values({ userId, provider: "google", providerAccountId: "google-sub-test-2" }),
      ),
    ).rejects.toThrow(/unique/i);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd packages/db && bun test __tests__/otp-challenges.test.ts __tests__/oauth-accounts.test.ts`
Expected: FAIL — relations don't exist yet.

- [ ] **Step 6: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate && bun run db:migrate`

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/db && bun test __tests__/otp-challenges.test.ts __tests__/oauth-accounts.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 8: Full package test run, typecheck, lint**

Run: `cd packages/db && bun test && bun run typecheck && cd ../.. && bun run lint`

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): add otp_challenges and oauth_accounts schema"
```

---

### Task 3: `apps/api` — Redis client + OTP rate limiter

**Files:**
- Create: `apps/api/src/lib/redis-client.ts`
- Create: `apps/api/src/auth/rate-limit.ts`
- Test: `apps/api/src/auth/rate-limit.test.ts`

**Interfaces:**
- Produces: `redis` (a `Bun.RedisClient` singleton), `checkOtpRateLimit(phone: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>`.
- Consumes: the `redis` docker-compose service (already running from Phase 0a, host port 6379 — no port collision issue there, unlike Postgres's 55434 workaround).

- [ ] **Step 1: Write the Redis client**

`apps/api/src/lib/redis-client.ts`:
```ts
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Bun's native Redis client (available since Bun 1.2+, verified against
 * this repo's installed Bun 1.4.0 and the running docker-compose redis
 * service before this file was written) — no ioredis/node-redis dependency
 * needed.
 */
export const redis = new Bun.RedisClient(REDIS_URL);
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/auth/rate-limit.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { redis } from "../lib/redis-client";
import { checkOtpRateLimit } from "./rate-limit";

const TEST_PHONE = "+6281199999001";

describe("checkOtpRateLimit", () => {
  beforeEach(async () => {
    await redis.del(`otp:ratelimit:${TEST_PHONE}`);
  });

  test("allows requests up to the limit", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await checkOtpRateLimit(TEST_PHONE);
      expect(result.allowed).toBe(true);
    }
  });

  test("blocks the request after the limit is exceeded", async () => {
    for (let i = 0; i < 3; i++) {
      await checkOtpRateLimit(TEST_PHONE);
    }
    const fourth = await checkOtpRateLimit(TEST_PHONE);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("rate limits are scoped per phone number", async () => {
    const otherPhone = "+6281199999002";
    await redis.del(`otp:ratelimit:${otherPhone}`);
    for (let i = 0; i < 3; i++) {
      await checkOtpRateLimit(TEST_PHONE);
    }
    const otherResult = await checkOtpRateLimit(otherPhone);
    expect(otherResult.allowed).toBe(true);
    await redis.del(`otp:ratelimit:${otherPhone}`);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test auth/rate-limit.test.ts`
Expected: FAIL — `Cannot find module './rate-limit'`.

- [ ] **Step 4: Implement the rate limiter**

`apps/api/src/auth/rate-limit.ts`:
```ts
import { redis } from "../lib/redis-client";

const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const WINDOW_SECONDS = 60 * 60; // 1 hour

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit on OTP requests, keyed per phone number. INCR
 * on a fresh key returns 1, at which point we set the window's expiry —
 * this is the standard Redis fixed-window counter pattern and avoids a
 * separate EXISTS check (INCR creates the key at 0 then increments
 * atomically if it didn't exist).
 */
export async function checkOtpRateLimit(phone: string): Promise<RateLimitResult> {
  const key = `otp:ratelimit:${phone}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  if (count > MAX_OTP_REQUESTS_PER_WINDOW) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && bun test auth/rate-limit.test.ts`
Expected: all 3 tests PASS (requires the docker-compose `redis` service running — it already is, from Phase 0a).

- [ ] **Step 6: Typecheck and lint**

Run: `cd apps/api && bun run typecheck && cd ../.. && bun run lint`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib apps/api/src/auth
git commit -m "feat(api): add Redis client and OTP rate limiter"
```

---

### Task 4: `apps/api` — SMS provider adapter + OTP core logic

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/auth/sms-provider.ts`
- Create: `apps/api/src/auth/otp.ts`
- Test: `apps/api/src/auth/otp.test.ts`

**Interfaces:**
- Consumes: `checkOtpRateLimit` (Task 3), `users`/`otpChallenges` from `@galangdana/db`.
- Produces: `SmsProvider` interface, `ConsoleSmsProvider`, `requestOtp(phone, smsProvider?): Promise<RequestOtpResult>`, `verifyOtp(phone, code): Promise<VerifyOtpResult>`.

- [ ] **Step 1: Add `@galangdana/db` as a dependency of `apps/api`**

Phase 0a's `apps/api` never imported from `@galangdana/db` (only `@galangdana/contracts` and `@galangdana/money`). This task is the first to do so — add it to `apps/api/package.json`'s `dependencies` (keep every existing entry unchanged):

```json
  "dependencies": {
    "@galangdana/contracts": "workspace:*",
    "@galangdana/db": "workspace:*",
    "@galangdana/money": "workspace:*",
    "elysia": "1.1.26"
  },
```

Run `bun install` after this change so the workspace symlink is created before the next steps try to import from it.

- [ ] **Step 2: Write the SMS provider adapter**

`apps/api/src/auth/sms-provider.ts`:
```ts
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

/**
 * Development/test default: logs the code instead of sending a real SMS.
 * A real vendor (Twilio, or a local Indonesian SMS gateway) implements this
 * same interface once one is chosen — this mirrors the master design doc's
 * PaymentProvider adapter pattern (Midtrans/Xendit/Sumopod behind one
 * interface), applied to SMS delivery instead of payments.
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[dev SMS] OTP for ${phone}: ${code}`);
  }
}
```

- [ ] **Step 3: Write the failing tests**

`apps/api/src/auth/otp.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { db, otpChallenges, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { redis } from "../lib/redis-client";
import type { SmsProvider } from "./sms-provider";
import { requestOtp, verifyOtp } from "./otp";

const TEST_PHONE = "+6281199999101";

class CapturingSmsProvider implements SmsProvider {
  lastCode: string | null = null;
  async sendOtp(_phone: string, code: string): Promise<void> {
    this.lastCode = code;
  }
}

describe("requestOtp / verifyOtp", () => {
  beforeEach(async () => {
    await redis.del(`otp:ratelimit:${TEST_PHONE}`);
    await db.delete(otpChallenges).where(eq(otpChallenges.phone, TEST_PHONE));
    await db.delete(users).where(eq(users.phone, TEST_PHONE));
  });

  test("requesting an OTP sends a 6-digit code via the given provider", async () => {
    const sms = new CapturingSmsProvider();
    const result = await requestOtp(TEST_PHONE, sms);
    expect(result.sent).toBe(true);
    expect(sms.lastCode).toMatch(/^\d{6}$/);
  });

  test("verifying the correct code creates a new user and returns it", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    const result = await verifyOtp(TEST_PHONE, code);
    expect(result.success).toBe(true);
    expect(result.user?.phone).toBe(TEST_PHONE);
  });

  test("verifying the same code twice fails the second time (replay protection)", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    await verifyOtp(TEST_PHONE, code);
    const second = await verifyOtp(TEST_PHONE, code);
    expect(second.success).toBe(false);
  });

  test("verifying with the wrong code fails and increments attempts", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);

    const result = await verifyOtp(TEST_PHONE, "000000");
    expect(result.success).toBe(false);
  });

  test("verifying an existing user's phone logs them in rather than creating a duplicate", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const firstCode = sms.lastCode!;
    const first = await verifyOtp(TEST_PHONE, firstCode);
    // biome-ignore lint/style/noNonNullAssertion: asserted success above
    const firstUserId = first.user!.id;

    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const secondCode = sms.lastCode!;
    const second = await verifyOtp(TEST_PHONE, secondCode);

    expect(second.user?.id).toBe(firstUserId);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/api && bun test auth/otp.test.ts`
Expected: FAIL — `Cannot find module './otp'`.

- [ ] **Step 5: Implement OTP core logic**

`apps/api/src/auth/otp.ts`:
```ts
import { db, otpChallenges, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { checkOtpRateLimit } from "./rate-limit";
import { ConsoleSmsProvider, type SmsProvider } from "./sms-provider";

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function generateOtpCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // biome-ignore lint/style/noNonNullAssertion: array has length 1
  return String(array[0]! % 1_000_000).padStart(6, "0");
}

export interface RequestOtpResult {
  sent: boolean;
  retryAfterSeconds?: number;
}

export async function requestOtp(
  phone: string,
  smsProvider: SmsProvider = new ConsoleSmsProvider(),
): Promise<RequestOtpResult> {
  const rateLimit = await checkOtpRateLimit(phone);
  if (!rateLimit.allowed) {
    return { sent: false, retryAfterSeconds: rateLimit.retryAfterSeconds };
  }

  const code = generateOtpCode();
  const codeHash = await Bun.password.hash(code, { algorithm: "argon2id" });

  await db.insert(otpChallenges).values({
    phone,
    codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await smsProvider.sendOtp(phone, code);
  return { sent: true };
}

export interface VerifyOtpResult {
  success: boolean;
  user?: User;
  reason?: "not_found" | "expired" | "too_many_attempts" | "incorrect_code";
}

export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  // Must be the LATEST unconsumed challenge, not an arbitrary/oldest one:
  // a user who taps "resend code" now has two outstanding rows, and without
  // desc() here an ascending order-by would keep checking the superseded
  // first code -- which would also increment ITS attempts counter on every
  // wrong guess with the (correct) new code, eventually locking the user
  // out with a correct code in hand until the old challenge's TTL expires.
  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt)))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    return { success: false, reason: "not_found" };
  }

  // Checked as a separate step (not folded into the query's WHERE via
  // gt(expiresAt, now)) specifically so an expired-but-otherwise-matching
  // challenge returns the precise "expired" reason instead of the less
  // useful "not_found" -- a caller can tell "there was never a code" apart
  // from "there was one, but it's stale, request a new one."
  if (challenge.expiresAt.getTime() <= Date.now()) {
    return { success: false, reason: "expired" };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { success: false, reason: "too_many_attempts" };
  }

  const isValid = await Bun.password.verify(code, challenge.codeHash);
  if (!isValid) {
    // Atomic increment at the database level (sql`... + 1`), not
    // `challenge.attempts + 1` computed from a value read moments earlier
    // in application code -- two concurrent wrong-code requests reading the
    // same starting value and both writing "+1" would otherwise silently
    // lose an increment, letting an attacker exceed MAX_VERIFY_ATTEMPTS.
    await db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, challenge.id));
    return { success: false, reason: "incorrect_code" };
  }

  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(otpChallenges.id, challenge.id));

  // Atomic find-or-create via INSERT ... ON CONFLICT, not a separate SELECT
  // followed by a conditional INSERT: two concurrent successful
  // verifications for the same brand-new phone number could otherwise both
  // see "no existing user" and both attempt to insert, and the loser would
  // throw on the users.phone unique constraint instead of returning the
  // winner's row. onConflictDoUpdate (a no-op-ish update) makes this one
  // atomic statement that always returns exactly one row, verified
  // empirically: two concurrent calls with the same phone return the same
  // user id.
  const [created] = await db
    .insert(users)
    .values({ phone })
    .onConflictDoUpdate({ target: users.phone, set: { updatedAt: new Date() } })
    .returning();
  return { success: true, user: created };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && bun test auth/otp.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 7: Typecheck and lint**

Run: `cd apps/api && bun run typecheck && cd ../.. && bun run lint`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add SMS provider adapter and OTP request/verify logic"
```

---

### Task 5: `apps/api` — Session core logic

**Files:**
- Create: `apps/api/src/auth/session.ts`
- Test: `apps/api/src/auth/session.test.ts`

**Interfaces:**
- Consumes: `sessions`/`users` from `@galangdana/db`.
- Produces: `createSession(userId, meta?): Promise<{ token: string; expiresAt: Date }>`, `validateSession(token): Promise<{ user: User; session: Session } | null>`, `revokeSession(token): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/auth/session.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { db, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { createSession, revokeSession, validateSession } from "./session";

const TEST_PHONE = "+6281199999201";

describe("session lifecycle", () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.phone, TEST_PHONE));
  });

  test("createSession issues a random token tied to the user, valid for ~30 days", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const { token, expiresAt } = await createSession(userId);
    expect(token.length).toBeGreaterThanOrEqual(32);
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThan(31);
  });

  test("two sessions for the same user get different tokens", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const a = await createSession(userId);
    const b = await createSession(userId);
    expect(a.token).not.toBe(b.token);
  });

  test("validateSession returns the user for a valid token", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    const { token } = await createSession(userId);

    const result = await validateSession(token);
    expect(result?.user.id).toBe(userId);
  });

  test("validateSession returns null for an unknown token", async () => {
    const result = await validateSession("this-token-does-not-exist");
    expect(result).toBeNull();
  });

  test("validateSession returns null for an expired session", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    await db.insert(sessions).values({
      id: "expired-test-token",
      userId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await validateSession("expired-test-token");
    expect(result).toBeNull();
  });

  test("revokeSession deletes the session so it no longer validates", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    const { token } = await createSession(userId);

    await revokeSession(token);
    const result = await validateSession(token);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test auth/session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Implement session logic**

`apps/api/src/auth/session.ts`:
```ts
import { db, sessions, users } from "@galangdana/db";
import type { Session, User } from "@galangdana/db";
import { eq, gt, and } from "drizzle-orm";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: token,
    userId,
    expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });
  return { token, expiresAt };
}

export async function validateSession(
  token: string,
): Promise<{ user: User; session: Session } | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));

  if (!row) return null;
  return { user: row.user, session: row.session };
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test auth/session.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/api && bun run typecheck && cd ../.. && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add session creation, validation, and revocation"
```

---

### Task 6: `apps/api` — Password hashing + email register/login

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Test: `apps/api/src/auth/password.test.ts`

**Interfaces:**
- Consumes: `users` from `@galangdana/db`.
- Produces: `registerWithEmail(email, password, name?): Promise<RegisterResult>`, `loginWithEmail(email, password): Promise<LoginResult>`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/auth/password.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { db, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { loginWithEmail, registerWithEmail } from "./password";

const TEST_EMAIL = "test-password-1@example.test";

describe("registerWithEmail / loginWithEmail", () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, TEST_EMAIL));
  });

  test("registering creates a user with a hashed (not plaintext) password", async () => {
    const result = await registerWithEmail(TEST_EMAIL, "correct-horse-battery-staple", "Test User");
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(TEST_EMAIL);
    expect(result.user?.name).toBe("Test User");

    const [row] = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(row?.passwordHash).not.toBe("correct-horse-battery-staple");
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  test("registering with an email that's already taken fails", async () => {
    await registerWithEmail(TEST_EMAIL, "first-password-123", "First");
    const result = await registerWithEmail(TEST_EMAIL, "second-password-456", "Second");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("email_taken");
  });

  test("logging in with the correct password succeeds", async () => {
    await registerWithEmail(TEST_EMAIL, "correct-horse-battery-staple", "Test User");
    const result = await loginWithEmail(TEST_EMAIL, "correct-horse-battery-staple");
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(TEST_EMAIL);
  });

  test("logging in with the wrong password fails", async () => {
    await registerWithEmail(TEST_EMAIL, "correct-horse-battery-staple", "Test User");
    const result = await loginWithEmail(TEST_EMAIL, "wrong-password");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
  });

  test("logging in with an unknown email fails with the same reason as a wrong password", async () => {
    // Same failure reason for "no such user" and "wrong password" is
    // deliberate: it avoids leaking which emails are registered.
    const result = await loginWithEmail("no-such-user@example.test", "whatever");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
  });

  test("logging in against a phone-only user (no password set) fails cleanly", async () => {
    const phoneOnlyEmail = "test-password-phone-only@example.test";
    await db.delete(users).where(eq(users.email, phoneOnlyEmail));
    await db.insert(users).values({ phone: "+6281199999301", email: phoneOnlyEmail });

    const result = await loginWithEmail(phoneOnlyEmail, "any-password");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
    await db.delete(users).where(eq(users.email, phoneOnlyEmail));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test auth/password.test.ts`
Expected: FAIL — `Cannot find module './password'`.

- [ ] **Step 3: Implement password auth logic**

`apps/api/src/auth/password.ts`:
```ts
import { db, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { eq } from "drizzle-orm";

export interface RegisterResult {
  success: boolean;
  user?: User;
  reason?: "email_taken";
}

export async function registerWithEmail(
  email: string,
  password: string,
  name?: string,
): Promise<RegisterResult> {
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });

  // Atomic check-and-insert via ON CONFLICT DO NOTHING, not a separate
  // SELECT-then-INSERT: two concurrent registrations with the same email
  // could otherwise both pass the "not taken" check and both attempt to
  // insert, with the loser throwing an unhandled unique-constraint error
  // instead of cleanly returning "email_taken" -- the exact race class
  // Task 4's user find-or-create had, fixed the same way here before
  // dispatch. onConflictDoNothing means a colliding insert affects zero
  // rows, so RETURNING is empty and `created` is undefined -- a clean,
  // race-free signal that the email was already taken (verified: two
  // sequential inserts with the same email return a real row then
  // undefined).
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash, name })
    .onConflictDoNothing({ target: users.email })
    .returning();

  if (!created) {
    return { success: false, reason: "email_taken" };
  }
  return { success: true, user: created };
}

export interface LoginResult {
  success: boolean;
  user?: User;
  reason?: "invalid_credentials";
}

export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const [user] = await db.select().from(users).where(eq(users.email, email));

  // A missing user and a user with no password set (phone/Google-only)
  // both fail identically to "invalid_credentials" -- neither leaks
  // anything an attacker could use to enumerate accounts.
  if (!user || !user.passwordHash) {
    return { success: false, reason: "invalid_credentials" };
  }

  const isValid = await Bun.password.verify(password, user.passwordHash);
  if (!isValid) {
    return { success: false, reason: "invalid_credentials" };
  }

  return { success: true, user };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test auth/password.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/api && bun run typecheck && cd ../.. && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add email/password registration and login"
```

---

### Task 7: `apps/api` — Google OAuth core logic

**Files:**
- Create: `apps/api/src/auth/google-oauth.ts`
- Test: `apps/api/src/auth/google-oauth.test.ts`

**Interfaces:**
- Consumes: `users`/`oauthAccounts` from `@galangdana/db`.
- Produces: `buildGoogleAuthUrl(state, codeChallenge): string`, `exchangeGoogleCode(code, codeVerifier, fetchImpl?): Promise<GoogleTokens>`, `fetchGoogleUserInfo(accessToken, fetchImpl?): Promise<GoogleProfile>`, `findOrCreateGoogleUser(profile): Promise<User>`.

**No real Google OAuth credentials exist for this environment.** `exchangeGoogleCode` and `fetchGoogleUserInfo` accept an injectable `fetch` implementation (defaulting to the global `fetch`) specifically so tests can substitute Google's HTTP responses without a real client secret — this is the same dependency-injection shape as `PaymentProvider` in the master design doc, applied to an HTTP client instead of a payment gateway. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` env vars are read at call time (not module load time), so tests never need real values.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/auth/google-oauth.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { db, oauthAccounts, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  findOrCreateGoogleUser,
  type GoogleFetch,
} from "./google-oauth";

describe("buildGoogleAuthUrl", () => {
  test("includes the state and PKCE code challenge in the URL", () => {
    const url = buildGoogleAuthUrl("test-state-value", "test-code-challenge");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("state")).toBe("test-state-value");
    expect(parsed.searchParams.get("code_challenge")).toBe("test-code-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });
});

describe("exchangeGoogleCode", () => {
  test("posts the code and verifier to Google's token endpoint and returns the tokens", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    const mockFetch: GoogleFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ access_token: "mock-access-token", id_token: "mock-id-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const tokens = await exchangeGoogleCode("mock-auth-code", "mock-code-verifier", mockFetch);
    expect(capturedUrl).toBe("https://oauth2.googleapis.com/token");
    expect(capturedBody).toContain("code=mock-auth-code");
    expect(capturedBody).toContain("code_verifier=mock-code-verifier");
    expect(tokens.access_token).toBe("mock-access-token");
  });
});

describe("fetchGoogleUserInfo", () => {
  test("sends the access token as a bearer header and returns the profile", async () => {
    let capturedAuth: string | null = null;
    const mockFetch: GoogleFetch = async (_url, init) => {
      capturedAuth = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({ sub: "google-sub-mock-1", email: "mock@example.test", name: "Mock User" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const profile = await fetchGoogleUserInfo("mock-access-token", mockFetch);
    expect(capturedAuth).toBe("Bearer mock-access-token");
    expect(profile.sub).toBe("google-sub-mock-1");
    expect(profile.email).toBe("mock@example.test");
  });
});

describe("findOrCreateGoogleUser", () => {
  const mockProfile = { sub: "google-sub-test-fc-1", email: "test-fc-1@example.test", name: "FC Test" };

  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, mockProfile.email));
  });

  test("creates a new user and links the Google account on first sign-in", async () => {
    const user = await findOrCreateGoogleUser(mockProfile);
    expect(user.email).toBe(mockProfile.email);

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, mockProfile.sub));
    expect(link?.userId).toBe(user.id);
  });

  test("returns the same user on a second sign-in with the same Google account", async () => {
    const first = await findOrCreateGoogleUser(mockProfile);
    const second = await findOrCreateGoogleUser(mockProfile);
    expect(second.id).toBe(first.id);
  });

  test("links to an existing user with a matching email rather than creating a duplicate", async () => {
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, name: "Pre-existing" })
      .returning();

    const linked = await findOrCreateGoogleUser(mockProfile);
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(linked.id).toBe(existing!.id);
  });

  test("links to a user created via a different auth method (e.g. registerWithEmail) with the same email, without throwing", async () => {
    // Simulates what registerWithEmail (Task 6) would have produced for this
    // email a moment earlier: a users row with a passwordHash, no Google
    // link yet. Before the fix, findOrCreateGoogleUser's create-branch
    // insert had no onConflictDoNothing at all, so if this row existed the
    // insert would throw an unhandled unique-constraint exception instead
    // of falling back to the existing row.
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, passwordHash: "x" })
      .returning();

    const linked = await findOrCreateGoogleUser(mockProfile);
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(linked.id).toBe(existing!.id);

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, mockProfile.sub));
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(link?.userId).toBe(existing!.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test auth/google-oauth.test.ts`
Expected: FAIL — `Cannot find module './google-oauth'`.

- [ ] **Step 3: Implement Google OAuth logic**

`apps/api/src/auth/google-oauth.ts`:
```ts
import { db, oauthAccounts, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, eq } from "drizzle-orm";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function googleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}
function googleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}
function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/google/callback";
}

export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", googleClientId());
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// A narrow callable type, not `typeof fetch`: Bun's global `fetch` is a
// function+namespace merge (it also carries a static `.preconnect` method),
// so under this repo's tsconfig (no DOM lib) a plain mock function assigned
// to a `typeof fetch`-typed parameter fails to typecheck ("Property
// 'preconnect' is missing") even though it's perfectly callable at runtime.
// Reproduced and confirmed against this repo's actual tsconfig before this
// plan was corrected.
export type GoogleFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GoogleTokens {
  access_token: string;
  id_token?: string;
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  fetchImpl: GoogleFetch = fetch,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
  });

  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }
  return (await response.json()) as GoogleTokens;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  fetchImpl: GoogleFetch = fetch,
): Promise<GoogleProfile> {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google userinfo fetch failed: ${response.status}`);
  }
  return (await response.json()) as GoogleProfile;
}

export async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<User> {
  const [linked] = await db
    .select({ user: users })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(
      and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerAccountId, profile.sub)),
    );
  if (linked) {
    return linked.user;
  }

  // Atomic insert-or-select on users.email, not a SELECT then a
  // conditional INSERT: two concurrent signups for the SAME email via
  // DIFFERENT auth methods (e.g. this Google flow and registerWithEmail's
  // email/password path both completing around the same instant) could
  // otherwise both pass a "no existing user" check, and this function's
  // insert had NO conflict guard at all -- it would throw an unhandled
  // unique-constraint exception instead of gracefully picking up whichever
  // row actually won. onConflictDoNothing makes a colliding insert affect
  // zero rows (verified empirically: a pre-existing row causes this insert
  // to return undefined, and a plain SELECT then finds that same row).
  const [created] = await db
    .insert(users)
    .values({ email: profile.email, name: profile.name, avatarUrl: profile.picture })
    .onConflictDoNothing({ target: users.email })
    .returning();

  const [existing] = created ? [] : await db.select().from(users).where(eq(users.email, profile.email));
  const user = created ?? existing;
  if (!user) {
    throw new Error(`findOrCreateGoogleUser: no user found for ${profile.email} after insert-or-select`);
  }

  // Same reasoning applied to the link itself: two truly concurrent Google
  // sign-ins for the same profile (e.g. two browser tabs) could both reach
  // this point and both try to link the same (provider, providerAccountId)
  // pair -- onConflictDoNothing on the composite unique index makes the
  // second one a no-op instead of a thrown exception. Verified empirically
  // against the real composite unique index.
  await db
    .insert(oauthAccounts)
    .values({ userId: user.id, provider: "google", providerAccountId: profile.sub })
    .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerAccountId] });

  return user;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test auth/google-oauth.test.ts`
Expected: all 7 tests PASS. No real Google credentials or network access are required — the token/userinfo tests use the injected mock `fetch`.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/api && bun run typecheck && cd ../.. && bun run lint`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add Google OAuth (PKCE authorization code flow)"
```

---

### Task 8: `apps/api` — Auth routes, session middleware, and contracts

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/auth/pkce.ts`
- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–7 (`requestOtp`, `verifyOtp`, `registerWithEmail`, `loginWithEmail`, `createSession`, `validateSession`, `revokeSession`, `buildGoogleAuthUrl`, `exchangeGoogleCode`, `fetchGoogleUserInfo`, `findOrCreateGoogleUser`).
- Produces: `authRoute` (an Elysia instance), mounted into the app in `apps/api/src/index.ts`. Routes: `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/google`, `GET /auth/google/callback`.

- [ ] **Step 1: Write the contracts schemas**

TypeBox's `Value.Check` treats an unrecognized `format` keyword as an automatic validation failure for the WHOLE payload, not a no-op — this was already discovered and fixed once in Phase 0a (`packages/contracts/src/health.ts`'s `"date-time"` format). This file uses two more format strings (`"email"`, `"uuid"`) that need their own registered checkers for exactly the same reason, verified directly against the installed `@sinclair/typebox@0.33.24` before this task was written: `Value.Check` on a fully valid payload against a schema using `format: "email"` or `format: "uuid"` returns `false` with `"Unknown format '...'"` unless a checker is registered. Elysia validates every route's bound `body`/`response` schema via this same mechanism, so without these registrations, Task 8's `/auth/register` and `/auth/login` routes would reject every request — including valid ones — and `/auth/me`'s response would fail its own schema.

`packages/contracts/src/auth.ts`:
```ts
import { FormatRegistry, Type, type Static } from "@sinclair/typebox";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registered once, at module load, so every schema in this file (and any
// other route later bound with these same format strings) validates
// correctly rather than silently rejecting every payload. Pragmatic
// validators, not full RFC 5322/4122 compliance -- sufficient for this
// platform's actual inputs (a browser's own <input type="email">
// validation and Postgres's uuid column type are the other two layers
// this data passes through).
FormatRegistry.Set("email", (value) => EMAIL_RE.test(value));
FormatRegistry.Set("uuid", (value) => UUID_RE.test(value));

export const UserSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  phone: Type.Union([Type.String(), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
});
export type UserResponse = Static<typeof UserSchema>;

export const AuthSuccessSchema = Type.Object({
  user: UserSchema,
});
export type AuthSuccessResponse = Static<typeof AuthSuccessSchema>;

export const OtpRequestBodySchema = Type.Object({
  phone: Type.String({ minLength: 8 }),
});

export const OtpVerifyBodySchema = Type.Object({
  phone: Type.String({ minLength: 8 }),
  code: Type.String({ minLength: 6, maxLength: 6 }),
});

export const RegisterBodySchema = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 8 }),
  name: Type.Optional(Type.String()),
});

export const LoginBodySchema = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 1 }),
});

export const AuthErrorSchema = Type.Object({
  error: Type.String(),
});

// Shared by any route whose success response is just a bare acknowledgement
// (no payload beyond "it worked") -- currently /auth/logout and
// /auth/otp/request.
export const SimpleSuccessSchema = Type.Object({
  success: Type.Literal(true),
});
```

- [ ] **Step 2: Wire the barrel export**

`packages/contracts/src/index.ts` (add to the existing file):
```ts
export { HealthResponseSchema } from "./health";
export type { HealthResponse } from "./health";
export {
  AuthErrorSchema,
  AuthSuccessSchema,
  LoginBodySchema,
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  RegisterBodySchema,
  SimpleSuccessSchema,
  UserSchema,
} from "./auth";
export type { AuthSuccessResponse, UserResponse } from "./auth";
```

- [ ] **Step 3: Write the PKCE helper**

`apps/api/src/auth/pkce.ts`:
```ts
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function generatePkceVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
```

- [ ] **Step 4: Write the failing route tests**

`apps/api/src/routes/auth.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { db, oauthAccounts, otpChallenges, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { app } from "../index";

const OTP_PHONE = "+6281199999401";
const EMAIL = "test-route-1@example.test";

async function cleanupUser(where: { phone?: string; email?: string }) {
  if (where.phone) {
    const [u] = await db.select().from(users).where(eq(users.phone, where.phone));
    if (u) await db.delete(users).where(eq(users.id, u.id));
    await db.delete(otpChallenges).where(eq(otpChallenges.phone, where.phone));
  }
  if (where.email) {
    const [u] = await db.select().from(users).where(eq(users.email, where.email));
    if (u) await db.delete(users).where(eq(users.id, u.id));
  }
}

function extractCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

describe("phone OTP flow", () => {
  beforeEach(async () => {
    await cleanupUser({ phone: OTP_PHONE });
  });

  test("request -> verify -> /auth/me works end to end", async () => {
    const requestResp = await app.handle(
      new Request("http://localhost/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: OTP_PHONE }),
      }),
    );
    expect(requestResp.status).toBe(200);

    const [challenge] = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phone, OTP_PHONE))
      .orderBy(otpChallenges.createdAt);
    expect(challenge).toBeDefined();

    // The route test can't read the code the "SMS" sent (it's hashed at
    // rest and never returned over HTTP, by design) -- request a fresh
    // challenge directly through the OTP module to get a real code, the
    // same way the route handler itself does internally.
    const { requestOtp } = await import("../auth/otp");
    const { ConsoleSmsProvider } = await import("../auth/sms-provider");
    class CapturingSms extends ConsoleSmsProvider {
      lastCode = "";
      override async sendOtp(phone: string, code: string) {
        this.lastCode = code;
        await super.sendOtp(phone, code);
      }
    }
    const sms = new CapturingSms();
    await requestOtp(OTP_PHONE, sms);

    const verifyResp = await app.handle(
      new Request("http://localhost/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: OTP_PHONE, code: sms.lastCode }),
      }),
    );
    expect(verifyResp.status).toBe(200);
    const setCookie = verifyResp.headers.get("set-cookie");
    const token = extractCookieValue(setCookie, "session");
    expect(token).not.toBeNull();

    const meResp = await app.handle(
      new Request("http://localhost/auth/me", {
        headers: { cookie: `session=${token}` },
      }),
    );
    expect(meResp.status).toBe(200);
    const meBody = (await meResp.json()) as { user: { phone: string } };
    expect(meBody.user.phone).toBe(OTP_PHONE);
  });

  test("verifying a wrong code returns 401", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: OTP_PHONE, code: "000000" }),
      }),
    );
    expect(resp.status).toBe(401);
  });
});

describe("email register/login flow", () => {
  beforeEach(async () => {
    await cleanupUser({ email: EMAIL });
  });

  test("register -> logout -> login -> /auth/me works end to end", async () => {
    const registerResp = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "correct-horse-battery-staple", name: "Route Test" }),
      }),
    );
    expect(registerResp.status).toBe(200);
    const registerToken = extractCookieValue(registerResp.headers.get("set-cookie"), "session");
    expect(registerToken).not.toBeNull();

    const logoutResp = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
        headers: { cookie: `session=${registerToken}` },
      }),
    );
    expect(logoutResp.status).toBe(200);

    const meAfterLogout = await app.handle(
      new Request("http://localhost/auth/me", { headers: { cookie: `session=${registerToken}` } }),
    );
    expect(meAfterLogout.status).toBe(401);

    const loginResp = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "correct-horse-battery-staple" }),
      }),
    );
    expect(loginResp.status).toBe(200);
    const loginToken = extractCookieValue(loginResp.headers.get("set-cookie"), "session");

    const meResp = await app.handle(
      new Request("http://localhost/auth/me", { headers: { cookie: `session=${loginToken}` } }),
    );
    expect(meResp.status).toBe(200);
    const meBody = (await meResp.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe(EMAIL);
  });

  test("registering with a duplicate email returns 409", async () => {
    await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "first-password-123" }),
      }),
    );
    const secondResp = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "second-password-456" }),
      }),
    );
    expect(secondResp.status).toBe(409);
  });

  test("logging in with the wrong password returns 401", async () => {
    await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "correct-horse-battery-staple" }),
      }),
    );
    const resp = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "wrong-password" }),
      }),
    );
    expect(resp.status).toBe(401);
  });
});

describe("GET /auth/me without a session", () => {
  test("returns 401", async () => {
    const resp = await app.handle(new Request("http://localhost/auth/me"));
    expect(resp.status).toBe(401);
  });
});

describe("GET /auth/google", () => {
  test("redirects to Google's consent screen with a state and PKCE challenge, and sets verifier + state cookies", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/google", { redirect: "manual" }),
    );
    expect(resp.status).toBe(302);
    const location = resp.headers.get("location");
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    const setCookie = resp.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("google_oauth_verifier");
    expect(setCookie).toContain("google_oauth_state");
  });
});

describe("GET /auth/google/callback", () => {
  test("rejects a callback whose state doesn't match the one issued to this browser", async () => {
    // A verifier + state cookie pair as GET /auth/google would have set,
    // but the query string's state deliberately doesn't match -- this is
    // exactly the shape of a forged/replayed callback URL.
    const resp = await app.handle(
      new Request("http://localhost/auth/google/callback?code=some-code&state=wrong-state", {
        headers: { cookie: "google_oauth_verifier=some-verifier; google_oauth_state=real-state" },
      }),
    );
    expect(resp.status).toBe(400);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd apps/api && bun test routes/auth.test.ts`
Expected: FAIL — `Cannot find module '../routes/auth'` (or the route doesn't exist yet, since `index.ts` hasn't mounted it).

- [ ] **Step 6: Implement the auth routes**

`apps/api/src/routes/auth.ts`:
```ts
import {
  AuthErrorSchema,
  AuthSuccessSchema,
  LoginBodySchema,
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  RegisterBodySchema,
  SimpleSuccessSchema,
  UserSchema,
} from "@galangdana/contracts";
import type { User } from "@galangdana/db";
import { type Cookie, Elysia, t } from "elysia";
import { generatePkceVerifier, generateState, pkceChallengeFromVerifier } from "../auth/pkce";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  findOrCreateGoogleUser,
} from "../auth/google-oauth";
import { requestOtp, verifyOtp } from "../auth/otp";
import { loginWithEmail, registerWithEmail } from "../auth/password";
import { createSession, revokeSession, validateSession } from "../auth/session";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function toUserResponse(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * Elysia's cookie jar (createCookieJar) always returns a real Cookie proxy
 * for any name accessed on it -- verified empirically against this repo's
 * installed Elysia 1.1.26 -- but the jar's type is a plain
 * Record<string, Cookie<unknown>> index signature, so this repo's
 * noUncheckedIndexedAccess tsconfig setting sees `cookie[name]` as possibly
 * undefined. `cookie[name]?.value = x` isn't valid assignment syntax
 * either way, so every write site needs this narrowed -- centralized here
 * once instead of a bare `!` scattered through every handler.
 */
function requiredCookie(
  jar: Record<string, Cookie<unknown> | undefined>,
  name: string,
): Cookie<unknown> {
  // biome-ignore lint/style/noNonNullAssertion: see function doc comment above
  return jar[name]!;
}

/**
 * Derives the current user from the session cookie on every request this
 * plugin is applied to. Downstream handlers read `user`/`session` from
 * context; both are `null` when there is no valid session, so a protected
 * route checks `if (!user) { set.status = 401; return ... }` rather than
 * this plugin throwing.
 */
const sessionDerive = new Elysia().derive({ as: "scoped" }, async ({ cookie }) => {
  const token = cookie[SESSION_COOKIE]?.value;
  if (!token) return { user: null, sessionToken: null };
  const result = await validateSession(token);
  if (!result) return { user: null, sessionToken: null };
  return { user: result.user, sessionToken: token };
});

export const authRoute = new Elysia({ prefix: "/auth" })
  .use(sessionDerive)
  .post(
    "/otp/request",
    async ({ body, set }) => {
      const result = await requestOtp(body.phone);
      if (!result.sent) {
        set.status = 429;
        return { error: "too_many_requests" };
      }
      return { success: true };
    },
    { body: OtpRequestBodySchema, response: { 200: SimpleSuccessSchema, 429: AuthErrorSchema } },
  )
  .post(
    "/otp/verify",
    async ({ body, cookie, set }) => {
      const result = await verifyOtp(body.phone, body.code);
      if (!result.success || !result.user) {
        set.status = 401;
        return { error: result.reason ?? "verification_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      return { user: toUserResponse(result.user) };
    },
    { body: OtpVerifyBodySchema, response: { 200: AuthSuccessSchema, 401: AuthErrorSchema } },
  )
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      const result = await registerWithEmail(body.email, body.password, body.name);
      if (!result.success || !result.user) {
        set.status = 409;
        return { error: result.reason ?? "registration_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      return { user: toUserResponse(result.user) };
    },
    { body: RegisterBodySchema, response: { 200: AuthSuccessSchema, 409: AuthErrorSchema } },
  )
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      const result = await loginWithEmail(body.email, body.password);
      if (!result.success || !result.user) {
        set.status = 401;
        return { error: result.reason ?? "login_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      return { user: toUserResponse(result.user) };
    },
    { body: LoginBodySchema, response: { 200: AuthSuccessSchema, 401: AuthErrorSchema } },
  )
  .post(
    "/logout",
    async ({ sessionToken, cookie, set }) => {
      if (sessionToken) {
        await revokeSession(sessionToken);
      }
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = "";
      sessionCookie.maxAge = 0;
      sessionCookie.path = "/";
      set.status = 200;
      return { success: true };
    },
    { response: { 200: SimpleSuccessSchema } },
  )
  .get(
    "/me",
    ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      return { user: toUserResponse(user) };
    },
    { response: { 200: AuthSuccessSchema, 401: AuthErrorSchema } },
  )
  .get("/google", async ({ cookie, set }) => {
    const state = generateState();
    const verifier = generatePkceVerifier();
    const challenge = await pkceChallengeFromVerifier(verifier);
    const verifierCookie = requiredCookie(cookie, "google_oauth_verifier");
    verifierCookie.value = verifier;
    verifierCookie.httpOnly = true;
    verifierCookie.path = "/";
    verifierCookie.maxAge = 600;
    // A second, separate cookie from the PKCE verifier: PKCE alone already
    // defeats the classic OAuth login-CSRF attack here (Google's token
    // endpoint rejects a code exchanged with a verifier that doesn't match
    // the code_challenge the code was originally issued for, so a forged
    // callback using an attacker's own authorization code fails at the
    // token-exchange step regardless of state). state is still checked as
    // standard defense-in-depth rather than generated and silently ignored
    // -- verified empirically (matching state -> 200, mismatched -> 400).
    const stateCookie = requiredCookie(cookie, "google_oauth_state");
    stateCookie.value = state;
    stateCookie.httpOnly = true;
    stateCookie.path = "/";
    stateCookie.maxAge = 600;
    set.status = 302;
    set.headers.location = buildGoogleAuthUrl(state, challenge);
    return "";
  })
  .get(
    "/google/callback",
    async ({ query, cookie, set }) => {
      const verifier = cookie.google_oauth_verifier?.value;
      const expectedState = cookie.google_oauth_state?.value;
      const code = query.code;
      if (!verifier || !code || !expectedState || query.state !== expectedState) {
        set.status = 400;
        return { error: "missing_code_or_verifier" };
      }
      const tokens = await exchangeGoogleCode(code, verifier);
      const profile = await fetchGoogleUserInfo(tokens.access_token);
      const user = await findOrCreateGoogleUser(profile);
      const { token, expiresAt } = await createSession(user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      const clearedVerifierCookie = requiredCookie(cookie, "google_oauth_verifier");
      clearedVerifierCookie.value = "";
      clearedVerifierCookie.maxAge = 0;
      const clearedStateCookie = requiredCookie(cookie, "google_oauth_state");
      clearedStateCookie.value = "";
      clearedStateCookie.maxAge = 0;
      set.status = 302;
      set.headers.location = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
      return "";
    },
    { query: t.Object({ code: t.Optional(t.String()), state: t.Optional(t.String()) }) },
  );
```

- [ ] **Step 7: Mount the auth route in the app**

Modify `apps/api/src/index.ts` — add the import and `.use(authRoute)` call (keep everything else, including the existing `.mapResponse`/`withApiResponseMapping` wiring and `.use(healthRoute)`, exactly as Phase 0a left it):

```ts
import { authRoute } from "./routes/auth";
```

Add `.use(authRoute)` to the existing `Elysia()` chain, alongside the existing `.use(healthRoute)` call.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/api && bun test routes/auth.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 9: Full package + workspace verification**

Run: `cd apps/api && bun test && bun run typecheck && cd ../.. && bun run lint`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts apps/api
git commit -m "feat(api): add auth routes (OTP, email, Google) and session middleware"
```

---

### Task 9: CI + env — Redis service, Google OAuth env vars

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing new.
- Produces: a CI pipeline that provisions Redis alongside Postgres, so Tasks 3–9's Redis-dependent tests pass in CI exactly as they do locally.

- [ ] **Step 1: Add a Redis service container to the CI workflow**

In `.github/workflows/ci.yml`, add a `redis` entry alongside the existing `postgres` entry under `jobs.test.services`, and a `REDIS_URL` entry alongside the existing `DATABASE_URL` under `jobs.test.env`:

```yaml
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

```yaml
      REDIS_URL: redis://localhost:6379
```

Google OAuth's own tests (Task 7) never make a real network call — they inject a mock `fetch` — so no `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are needed in CI for tests to pass. Do not add them to the workflow; only to `.env.example` (Step 2), for local `dev` use.

- [ ] **Step 2: Add Google OAuth env vars to `.env.example`**

Append to `.env.example` (do not modify any existing line):
```
# Google OAuth (dev/local — get real values from Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# Web app URL (used as the post-login redirect target)
PUBLIC_WEB_URL=http://localhost:5173
```

- [ ] **Step 3: Verify locally that the redis-dependent tests still pass**

Run: `bun run test` (the docker-compose `redis` service is already running locally — this doesn't test the CI service container itself, but confirms nothing in Steps 1–2 broke the existing test run)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .env.example
git commit -m "ci: add Redis service container; document Google OAuth env vars"
```

- [ ] **Step 5: Push and verify the real CI run is green**

This is the final task — after this commit, push the branch and confirm the actual GitHub Actions run passes with Redis available (Phase 0a's final review established that a local pass does not guarantee a clean-checkout CI pass — verify the real run, not just the local one).

---

## Self-Review Notes

- **Spec coverage:** implements the master spec's `users`/`sessions`/OTP domain-model entities in full, plus all three auth methods the Phase 0 scope line names (phone OTP, email, Google). `oauth_accounts` is a reasonable, minimal addition the spec's own domain model didn't spell out at the field level but is necessary to support "Google" as one of three named methods without conflating a Google identity with an email/password identity. Org verification, KYC, and everything else remain correctly out of scope.
- **No placeholders:** every step contains complete, runnable code. Google OAuth's client-secret-dependent calls are real code with injectable HTTP, not stubbed logic — the *tests* substitute a mock `fetch`, which is standard practice for testing OAuth integrations, not a placeholder for missing implementation.
- **Type consistency checked:** `SmsProvider`/`ConsoleSmsProvider` (Task 4) match the type used in `otp.test.ts`'s `CapturingSmsProvider` implementation. `createSession`/`validateSession`/`revokeSession` (Task 5) signatures match exactly what Task 8's routes call. `buildGoogleAuthUrl`/`exchangeGoogleCode`/`fetchGoogleUserInfo`/`findOrCreateGoogleUser` (Task 7) signatures match Task 8's route usage exactly, including the optional `fetchImpl` parameter Task 8 relies on defaulting correctly. `UserSchema`/`AuthSuccessSchema` (Task 8) field names match `toUserResponse()`'s return shape exactly (`id`, `phone`, `email`, `name`, `avatarUrl`).
