# Phase 0a: Foundations — Monorepo, Infra, Data & Money Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the GalangDana monorepo (Bun workspaces, SvelteKit web, ElysiaJS API, Drizzle/Postgres), with the two things every later phase depends on built correctly from day one: BigInt/multi-currency money primitives, and the dual campaign data model (`goal` vs `program`) that two earlier drafts of the design got wrong.

**Architecture:** Bun workspace monorepo with `apps/web` (SvelteKit 2, adapter-node, SSR), `apps/api` (ElysiaJS on Bun, TypeBox schemas → auto OpenAPI + typed Eden Treaty client), and `packages/{money,db,contracts}`. Postgres via Drizzle ORM, Redis/MinIO/Mailpit/Meilisearch via docker-compose for later phases (started now so CI and local dev never have to re-plumb infra).

**Tech Stack:** Bun, TypeScript, SvelteKit 2, ElysiaJS, Drizzle ORM, `postgres` (porsager) driver, TypeBox, Docker Compose, Biome (lint/format), GitHub Actions.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` — the approved GalangDana design doc (revision 4, explicitly approved by the user via ExitPlanMode). Read the whole spec before starting; this plan implements only its "Architecture", "Domain model" (Campaigns + the `model: goal | program` distinction), and "Cross-cutting concerns" (money/BigInt) sections. Everything else in the spec (auth, payments, wizard, CSR, etc.) is out of scope for this plan and lands in later plans.

## Global Constraints

- Runtime is **Bun** everywhere (no Node-only APIs in `packages/*` or `apps/api`); `apps/web` runs SvelteKit's Node adapter for production but is developed and tested under Bun.
- **Money is `bigint`. Never `number`, never Postgres `numeric` or `float` for money columns.** IDR is stored as a minor-unitless integer (no cents); USD is stored in integer cents. Every money-bearing table/type carries an explicit `currency` column/field — there is no implicit "the currency is always IDR" assumption anywhere, including in this foundational phase.
- `JSON.stringify` throws on `BigInt` — the API must never let a raw `BigInt` reach `JSON.stringify` unguarded. This is fixed once, centrally, in this plan (Task 3), before any other endpoint is built.
- No Kitabisa code, asset, or copy text is copied. Schema/route/field *names* mirroring the observed platform (e.g. `campaigns`, `donations`, `pencairan`) are fine — they are not protectable — but no placeholder copy should quote Kitabisa's actual marketing text.
- `packages/contracts` is the single source of truth for API shapes shared between `apps/api` and `apps/web`. If a shape isn't defined there, `apps/web` must not hand-roll a duplicate type for it.
- Every package gets its own `package.json`, `tsconfig.json` (extending the root `tsconfig.base.json`), and lives at exactly the path given in each task — do not collapse packages together for convenience.

---

## File Structure

```
galangdana/
├── package.json                      # workspace root (bun workspaces)
├── bunfig.toml
├── tsconfig.base.json
├── biome.json
├── .gitignore
├── .env.example
├── docker-compose.yml
├── .github/workflows/ci.yml
├── apps/
│   ├── web/                          # SvelteKit 2, adapter-node
│   │   ├── package.json
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app.d.ts
│   │       ├── app.html
│   │       ├── lib/api-client.ts     # Eden Treaty client, typed off apps/api
│   │       └── routes/
│   │           ├── +layout.svelte
│   │           ├── +page.svelte
│   │           └── +page.ts           # loads /healthz via api-client
│   └── api/                          # ElysiaJS on Bun
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts               # Elysia app, exports `App` type for Eden
│           └── routes/health.ts
├── packages/
│   ├── money/                        # BigInt + multi-currency primitives
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── money.ts
│   │       ├── serializer.ts
│   │       └── money.test.ts
│   ├── db/                           # Drizzle schema + client + seed
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── client.ts
│   │       ├── schema/
│   │       │   ├── index.ts
│   │       │   ├── categories.ts
│   │       │   └── campaigns.ts
│   │       ├── seed/
│   │       │   ├── categories.seed.ts
│   │       │   └── run-seed.ts
│   │       └── __tests__/schema.test.ts
│   └── contracts/                    # TypeBox schemas shared by api + web
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           └── health.ts
└── scripts/
    └── check-links.ts                # CI link-check over the running web app
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `bunfig.toml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: a Bun workspace root that every later task's `package.json` declares itself a member of (`"workspaces": ["apps/*", "packages/*"]`).

- [ ] **Step 1: Write the root `package.json`**

```json
{
  "name": "galangdana",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:web": "bun run --cwd apps/web dev",
    "dev:api": "bun run --cwd apps/api dev",
    "build": "bun run --cwd apps/web build",
    "test": "bun test packages apps/api",
    "test:web": "bun run --cwd apps/web test",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "bun run --filter='*' typecheck",
    "db:generate": "bun run --cwd packages/db drizzle-kit generate",
    "db:migrate": "bun run --cwd packages/db db:migrate",
    "db:seed": "bun run --cwd packages/db db:seed"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.7.2"
  }
}
```

`test` is scoped to `packages apps/api` (not a bare `bun test`) because `bun test`'s recursive file discovery would otherwise also pick up `apps/web`'s `*.test.ts` files, which are written against `vitest` (Task 9) rather than `bun:test` and would misbehave under Bun's test runner. `apps/web`'s suite runs separately via `test:web` (and is wired into CI as its own step in Task 10). Likewise `build` points directly at `apps/web`'s build — it is the only package with a real build step at this phase; `packages/*` and `apps/api` run directly under Bun with no compile step.

- [ ] **Step 2: Write `bunfig.toml`**

```toml
[install]
peer = true

[test]
root = "."
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 4: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["node_modules", "**/.svelte-kit", "**/dist", "**/build"]
  }
}
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
.env
.env.local
dist/
build/
.svelte-kit/
*.log
.DS_Store
coverage/
```

- [ ] **Step 6: Write `.env.example`**

```
# Postgres
DATABASE_URL=postgres://galangdana:galangdana@localhost:5432/galangdana

# Redis
REDIS_URL=redis://localhost:6379

# MinIO (S3-compatible)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=galangdana
S3_SECRET_KEY=galangdana-dev-secret
S3_BUCKET_MEDIA=galangdana-media

# Meilisearch
MEILI_URL=http://localhost:7700
MEILI_MASTER_KEY=galangdana-dev-master-key

# Mailpit (SMTP dev)
SMTP_HOST=localhost
SMTP_PORT=1025

# API
API_PORT=3001
PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 7: Install and verify**

Run: `bun install`
Expected: completes with no errors (no workspace packages exist yet, so this just installs root devDependencies).

- [ ] **Step 8: Commit**

```bash
git add package.json bunfig.toml tsconfig.base.json biome.json .gitignore .env.example
git commit -m "chore: scaffold bun workspace monorepo root"
```

---

### Task 2: Docker Compose infra

**Files:**
- Create: `docker-compose.yml`
- Test: `scripts/verify-infra.sh`

**Interfaces:**
- Produces: five running services on fixed local ports that every later task (db, search, media, mail) connects to: `postgres:5432`, `redis:6379`, `minio:9000`/`9001`, `mailpit:1025`/`8025`, `meilisearch:7700`.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
name: galangdana

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: galangdana
      POSTGRES_PASSWORD: galangdana
      POSTGRES_DB: galangdana
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U galangdana"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: galangdana
      MINIO_ROOT_PASSWORD: galangdana-dev-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 10

  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8025/api/v1/info"]
      interval: 5s
      timeout: 5s
      retries: 10

  meilisearch:
    image: getmeili/meilisearch:v1.11
    environment:
      MEILI_MASTER_KEY: galangdana-dev-master-key
      MEILI_NO_ANALYTICS: "true"
    ports: ["7700:7700"]
    volumes: ["meilidata:/meili_data"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:7700/health"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  miniodata:
  meilidata:
```

- [ ] **Step 2: Write the infra verification script**

```bash
#!/usr/bin/env bash
# scripts/verify-infra.sh
set -euo pipefail

echo "Waiting for services to become healthy..."
for i in $(seq 1 30); do
  unhealthy=$(docker compose ps --format json | bun -e '
    let s = "";
    for await (const chunk of Bun.stdin.stream()) s += Buffer.from(chunk).toString();
    const lines = s.trim().split("\n").filter(Boolean);
    const bad = lines.map(l => JSON.parse(l)).filter(c => c.Health && c.Health !== "healthy");
    console.log(bad.length);
  ')
  if [ "$unhealthy" = "0" ]; then
    echo "All services healthy."
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting for services to become healthy." >&2
docker compose ps
exit 1
```

- [ ] **Step 3: Bring infra up and verify**

Run: `docker compose up -d && chmod +x scripts/verify-infra.sh && ./scripts/verify-infra.sh`
Expected: prints "All services healthy." within 60 seconds.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml scripts/verify-infra.sh
git commit -m "chore: add docker-compose infra (postgres, redis, minio, mailpit, meilisearch)"
```

---

### Task 3: `packages/money` — BigInt + multi-currency primitives

This is the package the Global Constraints section exists to protect. Every money-bearing field in every later task imports from here — none re-implements currency handling.

**Files:**
- Create: `packages/money/package.json`
- Create: `packages/money/tsconfig.json`
- Create: `packages/money/src/money.ts`
- Create: `packages/money/src/serializer.ts`
- Create: `packages/money/src/index.ts`
- Test: `packages/money/src/money.test.ts`

**Interfaces:**
- Produces:
  - `type Currency = "IDR" | "USD"`
  - `type Money = { amount: bigint; currency: Currency }`
  - `money(amount: bigint | number, currency: Currency): Money`
  - `addMoney(a: Money, b: Money): Money` (throws on currency mismatch)
  - `formatMoney(m: Money, locale?: string): string` (id-ID Rupiah grouping for IDR, e.g. `Rp1.180.879.232`; standard `$` grouping for USD converting cents → dollars for display)
  - `moneyToJSON(m: Money): { amount: string; currency: Currency }` and `moneyFromJSON(v: { amount: string; currency: Currency }): Money`
  - `bigIntSafeJSONStringify(value: unknown): string` — drop-in replacement for `JSON.stringify` that serializes any `bigint` as a string instead of throwing

- [ ] **Step 1: Write the package manifest**

`packages/money/package.json`:
```json
{
  "name": "@galangdana/money",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/money/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test for `money()` and `addMoney()`**

`packages/money/src/money.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { addMoney, formatMoney, money, moneyFromJSON, moneyToJSON } from "./money";

describe("money", () => {
  test("constructs from bigint and normalizes number input", () => {
    expect(money(10_000n, "IDR")).toEqual({ amount: 10_000n, currency: "IDR" });
    expect(money(10_000, "IDR")).toEqual({ amount: 10_000n, currency: "IDR" });
  });

  test("addMoney sums same-currency amounts", () => {
    const a = money(30_000, "IDR");
    const b = money(70_000, "IDR");
    expect(addMoney(a, b)).toEqual({ amount: 100_000n, currency: "IDR" });
  });

  test("addMoney throws on currency mismatch", () => {
    const a = money(30_000, "IDR");
    const b = money(2_000, "USD");
    expect(() => addMoney(a, b)).toThrow(/currency mismatch/i);
  });

  test("formatMoney renders IDR with id-ID grouping and Rp prefix", () => {
    expect(formatMoney(money(1_180_879_232, "IDR"))).toBe("Rp1.180.879.232");
  });

  test("formatMoney renders USD cents as dollars with 2 decimals", () => {
    expect(formatMoney(money(2_000_000, "USD"))).toBe("$20,000.00");
  });

  test("round-trips through JSON without precision loss", () => {
    const original = money(9_007_199_254_740_993n, "IDR"); // exceeds Number.MAX_SAFE_INTEGER
    const json = moneyToJSON(original);
    expect(json).toEqual({ amount: "9007199254740993", currency: "IDR" });
    expect(moneyFromJSON(json)).toEqual(original);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/money && bun test`
Expected: FAIL — `Cannot find module './money'` (file doesn't exist yet).

- [ ] **Step 4: Implement `money.ts`**

`packages/money/src/money.ts`:
```ts
export type Currency = "IDR" | "USD";

export interface Money {
  readonly amount: bigint;
  readonly currency: Currency;
}

/**
 * Constructs a Money value. IDR is a minor-unitless integer (no cents, as
 * used throughout Kitabisa-style Indonesian donation platforms). USD is
 * stored in integer cents. Callers choose the right unit at the call site;
 * this function does not convert between them.
 */
export function money(amount: bigint | number, currency: Currency): Money {
  const normalized = typeof amount === "bigint" ? amount : BigInt(Math.trunc(amount));
  return { amount: normalized, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: cannot add ${a.currency} and ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: cannot subtract ${b.currency} from ${a.currency}`);
  }
  return { amount: a.amount - b.amount, currency: a.currency };
}

const RUPIAH_FORMATTER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Renders a Money value for display. IDR has no minor unit, so the amount
 * is grouped as-is with a "Rp" prefix. USD is stored in cents, so it is
 * divided by 100 before formatting.
 */
export function formatMoney(m: Money): string {
  if (m.currency === "IDR") {
    return `Rp${RUPIAH_FORMATTER.format(m.amount)}`;
  }
  // USD cents -> dollars. Safe to convert to Number here only for display;
  // amounts beyond Number.MAX_SAFE_INTEGER cents (~$92 quadrillion) are not
  // a real-world concern for this platform.
  return USD_FORMATTER.format(Number(m.amount) / 100);
}

export interface MoneyJSON {
  amount: string;
  currency: Currency;
}

export function moneyToJSON(m: Money): MoneyJSON {
  return { amount: m.amount.toString(), currency: m.currency };
}

export function moneyFromJSON(json: MoneyJSON): Money {
  return { amount: BigInt(json.amount), currency: json.currency };
}
```

- [ ] **Step 5: Run test to verify `money`/`addMoney`/`formatMoney`/JSON round-trip pass**

Run: `cd packages/money && bun test`
Expected: all 6 tests in `money.test.ts` PASS.

- [ ] **Step 6: Write the failing test for the BigInt-safe serializer**

Add to `packages/money/src/money.test.ts`:
```ts
import { bigIntSafeJSONStringify } from "./serializer";

describe("bigIntSafeJSONStringify", () => {
  test("serializes bigint fields as strings instead of throwing", () => {
    const payload = { donationId: 42, amount: 1_180_879_232n, currency: "IDR" as const };
    expect(() => JSON.stringify(payload)).toThrow(/cannot serialize a bigint/i);
    expect(bigIntSafeJSONStringify(payload)).toBe(
      '{"donationId":42,"amount":"1180879232","currency":"IDR"}',
    );
  });

  test("round-trips nested bigints inside arrays and objects", () => {
    const payload = { items: [{ amount: 5n }, { amount: 10n }] };
    expect(bigIntSafeJSONStringify(payload)).toBe(
      '{"items":[{"amount":"5"},{"amount":"10"}]}',
    );
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd packages/money && bun test`
Expected: FAIL — `Cannot find module './serializer'`.

- [ ] **Step 8: Implement `serializer.ts`**

`packages/money/src/serializer.ts`:
```ts
/**
 * `JSON.stringify` throws a TypeError on any `bigint`. Every money value in
 * this codebase is a bigint, so the API layer must never call the native
 * `JSON.stringify` on a response body directly — use this instead. Bigints
 * are serialized as decimal strings (not numbers, to avoid precision loss
 * for values beyond Number.MAX_SAFE_INTEGER).
 */
export function bigIntSafeJSONStringify(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, val) => (typeof val === "bigint" ? val.toString() : val),
    space,
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd packages/money && bun test`
Expected: all 8 tests PASS.

- [ ] **Step 10: Write the barrel export**

`packages/money/src/index.ts`:
```ts
export type { Currency, Money, MoneyJSON } from "./money";
export { addMoney, formatMoney, money, moneyFromJSON, moneyToJSON, subtractMoney } from "./money";
export { bigIntSafeJSONStringify } from "./serializer";
```

- [ ] **Step 11: Typecheck and full test run**

Run: `cd packages/money && bun run typecheck && bun test`
Expected: typecheck exits 0; all tests PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/money
git commit -m "feat(money): add BigInt multi-currency primitives and safe JSON serializer"
```

---

### Task 4: `packages/db` — Drizzle client + migration tooling

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema/index.ts` (empty barrel for now, filled in Task 5/6)
- Test: `packages/db/src/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (from `.env.example`, Task 1); the running `postgres` service (Task 2).
- Produces: `db` (a Drizzle instance) exported from `packages/db/src/client.ts`, imported by every schema/seed task and later by `apps/api`.

- [ ] **Step 1: Write the package manifest**

`packages/db/package.json`:
```json
{
  "name": "@galangdana/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/client.ts",
  "types": "src/client.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun run src/migrate.ts",
    "db:seed": "bun run src/seed/run-seed.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.4",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.1"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://galangdana:galangdana@localhost:5432/galangdana",
  },
});
```

- [ ] **Step 3: Write the client**

`packages/db/src/client.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://galangdana:galangdana@localhost:5432/galangdana";

const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
export { schema };
```

- [ ] **Step 4: Write an empty schema barrel (populated in Tasks 5–6)**

`packages/db/src/schema/index.ts`:
```ts
// Populated incrementally: categories (Task 5), campaigns (Task 6).
export {};
```

- [ ] **Step 5: Write the migration runner**

`packages/db/src/migrate.ts`:
```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
process.exit(0);
```

- [ ] **Step 6: Write the failing connectivity test**

`packages/db/src/__tests__/client.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

describe("db client", () => {
  test("connects to postgres and can run a trivial query", async () => {
    const result = await db.execute(sql`select 1 as one`);
    expect(result[0]).toEqual({ one: 1 });
  });
});
```

- [ ] **Step 7: Install deps, run test to verify it fails or passes**

Run: `bun install && cd packages/db && bun test`
Expected: if `docker compose up -d postgres` from Task 2 is still running, this should already PASS (there's no schema yet to migrate, but the connection itself works against a running Postgres). If Postgres is not running, it FAILS with a connection error — start it with `docker compose up -d postgres` and re-run.

- [ ] **Step 8: Confirm passing**

Run: `cd packages/db && bun test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): add drizzle client, migration runner, and connectivity test"
```

---

### Task 5: `campaign_categories` schema + seed (the 17 verified categories)

**Files:**
- Create: `packages/db/src/schema/categories.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/seed/categories.seed.ts`
- Create: `packages/db/src/seed/run-seed.ts`
- Test: `packages/db/src/__tests__/categories.test.ts`

**Interfaces:**
- Produces: `campaignCategories` Drizzle table, `CATEGORY_SEED_DATA: CategorySeed[]` (the 17 verified categories), `runSeed(): Promise<void>`.
- Consumes: `db` from `../client` (Task 4).

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/categories.ts`:
```ts
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const campaignCategories = pgTable("campaign_categories", {
  id: integer("id").primaryKey(), // matches Kitabisa's observed numeric category ids for parity
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignCategory = typeof campaignCategories.$inferSelect;
export type NewCampaignCategory = typeof campaignCategories.$inferInsert;
```

- [ ] **Step 2: Wire it into the schema barrel**

`packages/db/src/schema/index.ts`:
```ts
export * from "./categories";
```

- [ ] **Step 3: Write the seed data (verified live from the source platform's category taxonomy)**

`packages/db/src/seed/categories.seed.ts`:
```ts
import type { NewCampaignCategory } from "../schema/categories";

export const CATEGORY_SEED_DATA: NewCampaignCategory[] = [
  { id: 22, slug: "bencana-alam", title: "Bencana Alam", isFavorite: true },
  { id: 8, slug: "balita-anak-sakit", title: "Balita & Anak Sakit", isFavorite: true },
  { id: 9, slug: "bantuan-medis", title: "Bantuan Medis & Kesehatan", isFavorite: true },
  { id: 42, slug: "kemanusiaan", title: "Kemanusiaan", isFavorite: false },
  { id: 23, slug: "rumah-ibadah", title: "Rumah Ibadah", isFavorite: false },
  { id: 7, slug: "kegiatan-sosial", title: "Kegiatan Sosial", isFavorite: false },
  { id: 27, slug: "zakat", title: "Zakat", isFavorite: true },
  { id: 5, slug: "beasiswa-pendidikan", title: "Bantuan Pendidikan", isFavorite: false },
  { id: 11, slug: "infrastruktur", title: "Infrastruktur Umum", isFavorite: false },
  { id: 28, slug: "panti-asuhan", title: "Panti Asuhan", isFavorite: false },
  { id: 24, slug: "difabel", title: "Difabel", isFavorite: false },
  { id: 19, slug: "hewan", title: "Menolong Hewan", isFavorite: false },
  { id: 13, slug: "karya-kreatif", title: "Karya Kreatif & Modal Usaha", isFavorite: false },
  { id: 6, slug: "lingkungan", title: "Lingkungan", isFavorite: false },
  { id: 45, slug: "wakaf", title: "Wakaf", isFavorite: false },
  { id: 48, slug: "masjid-berdaya", title: "Masjid Berdaya", isFavorite: false },
  { id: 49, slug: "wakafproduktif", title: "Wakaf Produktif", isFavorite: false },
];
```

- [ ] **Step 4: Write the seed runner**

`packages/db/src/seed/run-seed.ts`:
```ts
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { CATEGORY_SEED_DATA } from "./categories.seed";

async function runSeed() {
  await db
    .insert(campaignCategories)
    .values(CATEGORY_SEED_DATA)
    .onConflictDoNothing({ target: campaignCategories.id });
  console.log(`Seeded ${CATEGORY_SEED_DATA.length} categories.`);
}

if (import.meta.main) {
  await runSeed();
  process.exit(0);
}

export { runSeed };
```

- [ ] **Step 5: Write the failing test**

`packages/db/src/__tests__/categories.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { runSeed } from "../seed/run-seed";

describe("campaign_categories", () => {
  test("seeding inserts exactly 17 categories", async () => {
    await runSeed();
    const rows = await db.select().from(campaignCategories);
    expect(rows.length).toBe(17);
  });

  test("zakat category has the verified slug and id", async () => {
    const [zakat] = await db
      .select()
      .from(campaignCategories)
      .where(eq(campaignCategories.slug, "zakat"));
    expect(zakat?.id).toBe(27);
    expect(zakat?.title).toBe("Zakat");
  });

  test("seeding is idempotent (re-running does not duplicate rows)", async () => {
    await runSeed();
    const rows = await db.select().from(campaignCategories);
    expect(rows.length).toBe(17);
  });
});
```

- [ ] **Step 6: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate && bun run db:migrate`
Expected: a new file appears under `packages/db/drizzle/`, and "Migrations applied." is printed.

- [ ] **Step 7: Run test to verify it fails (before seed) then passes**

Run: `cd packages/db && bun test __tests__/categories.test.ts`
Expected: PASS — all 3 tests (the migration in Step 6 already created the table, so this validates seeding, not schema presence).

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaign_categories schema, seed data, and idempotent seed runner"
```

---

### Task 6: `campaigns` schema — the `goal` vs `program` dual model

This is the single most important table in this plan. Two earlier drafts of the design modeled "Tersedia" campaigns as merely "no deadline" — wrong. They are a structurally different model: no goal, no deadline, no progress bar, tracking a live distributable balance instead of a cumulative total. Encode that distinction as a database-level constraint, not just an application convention, so it cannot silently drift.

**Files:**
- Create: `packages/db/src/schema/campaigns.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/campaigns.test.ts`

**Interfaces:**
- Consumes: `campaignCategories` from `./categories` (Task 5).
- Produces: `campaigns` Drizzle table, `campaignModelEnum` (`"goal" | "program"`), `campaignStatusEnum`.

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/campaigns.ts`:
```ts
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
    collectedAmount: bigint("collected_amount", { mode: "bigint" }).notNull().default(0n),
    disbursedAmount: bigint("disbursed_amount", { mode: "bigint" }).notNull().default(0n),
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
export function displayAmount(campaign: Pick<Campaign, "model" | "collectedAmount" | "disbursedAmount">): bigint {
  return campaign.model === "goal"
    ? campaign.collectedAmount
    : campaign.collectedAmount - campaign.disbursedAmount;
}
```

- [ ] **Step 2: Wire it into the schema barrel**

`packages/db/src/schema/index.ts`:
```ts
export * from "./categories";
export * from "./campaigns";
```

- [ ] **Step 3: Write the failing test**

`packages/db/src/__tests__/campaigns.test.ts`:
```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { db } from "../client";
import { campaigns, displayAmount } from "../schema/campaigns";
import { runSeed } from "../seed/run-seed";

describe("campaigns dual model", () => {
  // campaigns.category_id has a NOT NULL foreign key into campaign_categories.
  // This test file must not assume categories.test.ts (Task 5) already ran
  // and left rows behind — bun:test's file execution order is not guaranteed
  // to match task order (alphabetically "campaigns.test.ts" sorts BEFORE
  // "categories.test.ts"), and a fresh database has no categories at all.
  // runSeed() is idempotent (onConflictDoNothing), so calling it here is safe
  // regardless of what has or hasn't already run.
  beforeAll(async () => {
    await runSeed();
  });

  test("a goal-model campaign requires goal_amount and allows expires_at", async () => {
    const [row] = await db
      .insert(campaigns)
      .values({
        slug: "bantu-warga-kalimantan-test",
        title: "Bantu Warga Kalimantan yang Terdampak Karhutla",
        shortDescription: "Uji coba model goal",
        categoryId: 22, // bencana-alam
        model: "goal",
        goalAmount: 3_000_000_000n,
        expiresAt: new Date("2026-12-31T00:00:00Z"),
        collectedAmount: 1_180_879_232n,
      })
      .returning();
    expect(row?.model).toBe("goal");
    expect(row?.goalAmount).toBe(3_000_000_000n);
    expect(displayAmount(row!)).toBe(1_180_879_232n);
  });

  test("a program-model campaign forbids goal_amount and expires_at", async () => {
    const [row] = await db
      .insert(campaigns)
      .values({
        slug: "sumur-bor-masjid-test",
        title: "Sumur Bor untuk Masjid yang Kekurangan Air",
        shortDescription: "Uji coba model program",
        categoryId: 23, // rumah-ibadah
        model: "program",
        collectedAmount: 128_607_690n,
        disbursedAmount: 7_561_862n,
      })
      .returning();
    expect(row?.model).toBe("program");
    expect(row?.goalAmount).toBeNull();
    expect(row?.expiresAt).toBeNull();
    // "Donasi tersedia" is a live balance, not the cumulative total.
    expect(displayAmount(row!)).toBe(121_045_828n);
  });

  test("the database rejects a goal-model row with no goal_amount", async () => {
    await expect(
      db.insert(campaigns).values({
        slug: "invalid-goal-test",
        title: "Invalid",
        shortDescription: "Should fail",
        categoryId: 22,
        model: "goal",
        // goalAmount omitted — must violate the check constraint
      }),
    ).rejects.toThrow();
  });

  test("the database rejects a program-model row that carries a goal_amount", async () => {
    await expect(
      db.insert(campaigns).values({
        slug: "invalid-program-test",
        title: "Invalid",
        shortDescription: "Should fail",
        categoryId: 22,
        model: "program",
        goalAmount: 1_000_000n, // must violate the check constraint
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/db && bun test __tests__/campaigns.test.ts`
Expected: FAIL — `relation "campaigns" does not exist` (no migration yet).

- [ ] **Step 5: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate && bun run db:migrate`
Expected: a new migration file appears under `packages/db/drizzle/`; "Migrations applied." is printed.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/db && bun test __tests__/campaigns.test.ts`
Expected: all 4 tests PASS, including both constraint-violation tests correctly rejecting.

- [ ] **Step 7: Full package test run and typecheck**

Run: `cd packages/db && bun test && bun run typecheck`
Expected: all tests across the package PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaigns table with goal/program dual model enforced by CHECK constraint"
```

---

### Task 7: `packages/contracts` — shared health-check schema

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/health.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/health.test.ts`

**Interfaces:**
- Produces: `HealthResponseSchema` (a TypeBox schema), `type HealthResponse = Static<typeof HealthResponseSchema>`.
- Consumed by: `apps/api` (Task 8) to validate its response shape, and `apps/web` (Task 9) for its typed load function.

- [ ] **Step 1: Write the package manifest**

`packages/contracts/package.json`:
```json
{
  "name": "@galangdana/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@sinclair/typebox": "^0.33.17"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/contracts/src/health.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { HealthResponseSchema } from "./health";

describe("HealthResponseSchema", () => {
  test("accepts a well-formed health payload", () => {
    const payload = { status: "ok", service: "api", timestamp: "2026-08-29T00:00:00.000Z" };
    expect(Value.Check(HealthResponseSchema, payload)).toBe(true);
  });

  test("rejects a payload missing required fields", () => {
    expect(Value.Check(HealthResponseSchema, { status: "ok" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/contracts && bun test`
Expected: FAIL — `Cannot find module './health'`.

- [ ] **Step 4: Implement the schema**

`packages/contracts/src/health.ts`:
```ts
import { Type, type Static } from "@sinclair/typebox";

export const HealthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
  service: Type.String(),
  timestamp: Type.String({ format: "date-time" }),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/contracts && bun test`
Expected: both tests PASS.

- [ ] **Step 6: Write the barrel export**

`packages/contracts/src/index.ts`:
```ts
export { HealthResponseSchema } from "./health";
export type { HealthResponse } from "./health";
```

- [ ] **Step 7: Typecheck**

Run: `cd packages/contracts && bun run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add shared HealthResponse TypeBox schema"
```

---

### Task 8: `apps/api` — ElysiaJS bootstrap with `/healthz`

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/index.ts`
- Test: `apps/api/src/routes/health.test.ts`

**Interfaces:**
- Consumes: `HealthResponseSchema` from `@galangdana/contracts` (Task 7); `bigIntSafeJSONStringify` from `@galangdana/money` (Task 3, wired as the global JSON serializer so no later route can accidentally leak an unserialized BigInt).
- Produces: `export type App` from `apps/api/src/index.ts` — the Elysia app type that `apps/web`'s Eden Treaty client (Task 9) is generated from. `GET /healthz` route mirroring the observed platform's own `/healthz` route.

- [ ] **Step 1: Write the package manifest**

`apps/api/package.json`:
```json
{
  "name": "@galangdana/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@galangdana/contracts": "workspace:*",
    "@galangdana/money": "workspace:*",
    "elysia": "^1.1.26"
  },
  "devDependencies": {
    "@sinclair/typebox": "^0.33.17"
  }
}
```

The `main`/`types` fields matter beyond convention: `apps/web` (Task 9) does `import type { App } from "@galangdana/api"` — without an entry point declared here, TypeScript has no way to resolve that import through the workspace symlink. `@sinclair/typebox` is a devDependency (not a runtime `dependencies` entry) because it is only imported directly by this task's test file (`Value.Check` against `HealthResponseSchema`), never by `src/index.ts` or `src/routes/health.ts`.

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/routes/health.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { HealthResponseSchema } from "@galangdana/contracts";
import { app } from "../index";

describe("GET /healthz", () => {
  test("returns a well-formed, schema-valid health payload", async () => {
    const response = await app.handle(new Request("http://localhost/healthz"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Value.Check(HealthResponseSchema, body)).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("api");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && bun test`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 4: Implement the health route**

`apps/api/src/routes/health.ts`:
```ts
import { Elysia } from "elysia";

export const healthRoute = new Elysia().get("/healthz", () => ({
  status: "ok" as const,
  service: "api",
  timestamp: new Date().toISOString(),
}));
```

- [ ] **Step 5: Implement the app entrypoint**

`apps/api/src/index.ts`:
```ts
import { Elysia } from "elysia";
import { bigIntSafeJSONStringify } from "@galangdana/money";
import { healthRoute } from "./routes/health";

export const app = new Elysia()
  // Every response body is run through the BigInt-safe serializer, so no
  // route added later can accidentally hand a raw bigint to JSON.stringify
  // and crash the response.
  .mapResponse(({ response }) => {
    if (response === undefined) return;
    return new Response(bigIntSafeJSONStringify(response), {
      headers: { "content-type": "application/json" },
    });
  })
  .use(healthRoute);

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && bun test`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

Run: `cd apps/api && bun run dev` (in one terminal), then in another: `curl http://localhost:3001/healthz`
Expected: `{"status":"ok","service":"api","timestamp":"...ISO timestamp..."}`

- [ ] **Step 8: Typecheck**

Run: `cd apps/api && bun run typecheck`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): bootstrap ElysiaJS app with BigInt-safe response serialization and /healthz"
```

---

### Task 9: `apps/web` — SvelteKit bootstrap with typed Eden Treaty client

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/svelte.config.js`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app.d.ts`
- Create: `apps/web/src/app.html`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/routes/+layout.svelte`
- Create: `apps/web/src/routes/+page.ts`
- Create: `apps/web/src/routes/+page.svelte`
- Test: `apps/web/src/routes/page.test.ts`

**Interfaces:**
- Consumes: `type App` from `@galangdana/api` (Task 8) — the Eden Treaty client is typed off this, so a route rename in the API is a type error here, not a silent runtime mismatch.
- Produces: a running SSR page at `/` that server-fetches `/healthz` from the API and renders its status — proof the whole stack (web → api → typed contract) is wired end-to-end.

- [ ] **Step 1: Write the package manifest**

`apps/web/package.json`:
```json
{
  "name": "@galangdana/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json"
  },
  "dependencies": {
    "@elysiajs/eden": "^1.1.3",
    "@galangdana/api": "workspace:*",
    "@galangdana/contracts": "workspace:*"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.2.9",
    "@sveltejs/kit": "^2.9.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.2",
    "svelte": "^5.2.9",
    "svelte-check": "^4.1.0",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write SvelteKit config**

`apps/web/svelte.config.js`:
```js
import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};
```

`apps/web/vite.config.ts`:
```ts
import { sveltekit } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

`apps/web/tsconfig.json`:
```json
{
  "extends": ["../../tsconfig.base.json", "./.svelte-kit/tsconfig.json"],
  "compilerOptions": {
    "moduleResolution": "bundler",
    "types": ["@sveltejs/kit"]
  }
}
```

- [ ] **Step 3: Write `app.d.ts` and `app.html`**

`apps/web/src/app.d.ts`:
```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
```

`apps/web/src/app.html`:
```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 4: Write the typed Eden Treaty client**

`apps/web/src/lib/api-client.ts`:
```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "@galangdana/api";

const API_URL = process.env.PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Typed against the live Elysia `App` type from apps/api — renaming or
 * removing a route there is a compile error here, not a silent 404 at
 * runtime.
 */
export const api = treaty<App>(API_URL);
```

- [ ] **Step 5: Write the failing test for the home page load function**

`apps/web/src/routes/page.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";

describe("home page load", () => {
  test("fetches health status from the API and passes it to the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", service: "api", timestamp: "2026-08-29T00:00:00.000Z" }), {
        headers: { "content-type": "application/json" },
      }),
    ));

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect(result).toEqual({
      apiStatus: "ok",
      apiService: "api",
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/web && bun install && bunx vitest run`
Expected: FAIL — `Cannot find module './+page'`.

- [ ] **Step 7: Implement the load function**

`apps/web/src/routes/+page.ts`:
```ts
import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  const { data } = await api.healthz.get();
  return {
    apiStatus: data?.status ?? "unknown",
    apiService: data?.service ?? "unknown",
  };
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run`
Expected: PASS.

- [ ] **Step 9: Implement the layout and page markup**

`apps/web/src/routes/+layout.svelte`:
```svelte
<script lang="ts">
  let { children } = $props();
</script>

{@render children()}
```

`apps/web/src/routes/+page.svelte`:
```svelte
<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<main>
  <h1>GalangDana</h1>
  <p>API status: <strong>{data.apiStatus}</strong> ({data.apiService})</p>
</main>
```

- [ ] **Step 10: Manual end-to-end smoke test**

Run: with `apps/api` running (`bun run dev` from Task 8, Step 7) in one terminal, run `cd apps/web && bun run dev` in another, then open `http://localhost:5173`.
Expected: page renders "API status: **ok** (api)".

- [ ] **Step 11: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: exits 0 (svelte-check reports no errors).

- [ ] **Step 12: Commit**

```bash
git add apps/web
git commit -m "feat(web): bootstrap SvelteKit with typed Eden Treaty client against the API"
```

---

### Task 10: CI pipeline with real link-check

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-links.ts`

**Interfaces:**
- Consumes: every package/app's `test`, `typecheck` scripts (Tasks 3–9); the running `apps/web` dev server (for the link-check step).
- Produces: a green CI run on every push/PR — install, lint, typecheck, unit tests (with a Postgres service container), build, and a same-origin link crawl of the running web app (the check that would have caught Kitabisa's own broken `/partnership-form` link, noted as a lesson in the spec's Cross-cutting concerns).

- [ ] **Step 1: Write the link-check script**

`scripts/check-links.ts`:
```ts
#!/usr/bin/env bun
/**
 * Crawls same-origin <a href> links starting from BASE_URL and fails if any
 * resolve to a non-2xx/3xx status. This exists because the platform this
 * project is modeled on ships a homepage link that 404s — see the spec's
 * Cross-cutting concerns section. Catch that class of bug in CI, not by hand.
 */
const BASE_URL = process.env.CHECK_LINKS_BASE_URL ?? "http://localhost:5173";

async function crawl(): Promise<{ visited: number; broken: string[] }> {
  const seen = new Set<string>();
  const queue = ["/"];
  const broken: string[] = [];

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);

    const url = new URL(path, BASE_URL).toString();
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      broken.push(`${path} -> ${response.status}`);
      continue;
    }

    const html = await response.text();
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) {
        continue;
      }
      if (!seen.has(href)) queue.push(href);
    }
  }

  return { visited: seen.size, broken };
}

const { visited, broken } = await crawl();
console.log(`Crawled ${visited} same-origin routes.`);
if (broken.length > 0) {
  console.error("Broken links found:");
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
console.log("No broken links.");
```

- [ ] **Step 2: Verify the link-check script locally**

Run: with `apps/web` running (`bun run dev`), run `bun run scripts/check-links.ts`
Expected: "Crawled 1 same-origin routes." / "No broken links." (only `/` exists at this stage).

- [ ] **Step 3: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: galangdana
          POSTGRES_PASSWORD: galangdana
          POSTGRES_DB: galangdana
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U galangdana"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://galangdana:galangdana@localhost:5432/galangdana
      PUBLIC_API_URL: http://localhost:3001
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Lint
        run: bun run lint

      - name: Run database migrations
        run: bun run db:migrate

      - name: Typecheck
        run: bun run typecheck

      - name: Unit tests (packages + api)
        run: bun run test

      - name: Unit tests (web)
        run: bun run test:web

      - name: Build web
        run: bun run --cwd apps/web build

      - name: Start API in background
        run: bun run --cwd apps/api start &

      - name: Start web preview in background
        run: bun run --cwd apps/web preview --port 5173 &

      - name: Wait for web server
        run: |
          for i in $(seq 1 30); do
            if curl -sf http://localhost:5173 > /dev/null; then exit 0; fi
            sleep 1
          done
          echo "web server did not start in time" >&2
          exit 1

      - name: Link check
        run: bun run scripts/check-links.ts
        env:
          CHECK_LINKS_BASE_URL: http://localhost:5173
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml scripts/check-links.ts
git commit -m "ci: add GitHub Actions pipeline with lint, typecheck, tests, build, and link-check"
```

- [ ] **Step 5: Push and verify the pipeline is green**

Run: push the branch and open the Actions tab (or run the same steps locally in order: `bun install && bun run lint && bun run db:migrate && bun run typecheck && bun run test && bun run test:web && bun run --cwd apps/web build`)
Expected: every step exits 0.

---

## Self-Review Notes

- **Spec coverage:** this plan implements the spec's Architecture (monorepo shape, Elysia+SvelteKit+Eden pairing), the money/BigInt cross-cutting concern in full (including the "install a serializer before any money endpoint exists" ordering requirement), and the `campaigns` dual-model portion of the Domain model section, enforced with a real CHECK constraint rather than just a TypeScript convention. Auth, the design system, payments, the creation wizard, CSR, and every other module in the spec are explicitly out of scope here — each becomes its own plan once this one is merged, per the Scope Check in the writing-plans skill.
- **No placeholders:** every step above contains complete, runnable code — no `TODO`, no "similar to Task N", no unshown implementations.
- **Type consistency checked:** `Money`/`Currency`/`bigIntSafeJSONStringify` (Task 3) are the exact names imported in Task 8's `index.ts`; `HealthResponseSchema`/`HealthResponse` (Task 7) are the exact names asserted against in Task 8's test and consumed by Task 9's client; `type App` exported from Task 8's `apps/api/src/index.ts` is the exact name imported by Task 9's `api-client.ts`; `campaignModelEnum`/`campaigns`/`displayAmount` (Task 6) match across schema and test.
