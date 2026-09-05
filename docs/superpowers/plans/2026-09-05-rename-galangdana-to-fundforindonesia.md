# Rename `galangdana` → `fundforindonesia` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan touches live production infrastructure taking real donations.** Tasks 1–2 are ordinary code PRs. Tasks 3–9 mutate host state (Docker volumes, a live Postgres database, systemd units, cron, nginx) and MUST be executed in the written order. Do not reorder, do not batch, do not skip a verification step.

**Goal:** Remove every internal occurrence of the retired brand name "galangdana" from this monorepo and the production host it runs on, replacing it with "fundforindonesia", without the live site at https://fundforindonesia.org going down for longer than one coordinated service restart, and without losing a single row of the donation ledger or a single object in MinIO storage.

**Architecture:** The rename splits into three risk tiers, executed in that order.

1. **Pure code renames** (Tasks 1–2) — the npm workspace scope and the user-visible wordmark. No runtime coupling to host state whatsoever; a normal PR → CI → merge → auto-deploy handles them with zero manual coordination, because the existing CD pipeline already does `git reset --hard` + `bun install` + `db:migrate` + build + `systemctl restart` on every merge to `master`.
2. **Decoupling + inert config renames** (Tasks 3–4) — Task 3 pins Meilisearch credentials explicitly in the host `.env` files so that production stops depending on a brand-bearing hardcoded fallback in source. Only once that coupling is gone can Task 4 safely rewrite those fallbacks plus `docker-compose.yml`, `ci.yml`, `.env.example`, and `scripts/backup-db.sh` in a single PR that is **inert on deploy** (nothing in the deploy job runs `docker compose`).
3. **Coordinated host mutations** (Tasks 5–9) — the Docker Compose project + volume migration and the Postgres database/role rename share ONE maintenance window (Task 5), because both require the stack to be stopped. The systemd unit rename (Task 6) is a second, much shorter window. The runner label (Task 7), cron/backup (Task 8), and legacy nginx vhosts (Task 9) follow, each independently reversible.

The ordering guarantee is that after every single task, the system is in a working state — possibly half-renamed, but serving traffic correctly. There is no task whose partial completion leaves the site down.

**Tech Stack:** Bun workspaces monorepo (SvelteKit 2 + ElysiaJS), Drizzle + Postgres 16, MinIO, Meilisearch 1.11, Redis, imgproxy — all in Docker Compose on a single host; two user-level systemd units; nginx reverse proxy; a self-hosted GitHub Actions runner doing CD.

**Spec:** No master-plan phase covers this. It is operational scope created by the rebrand to FundForIndonesia (already live at https://fundforindonesia.org / https://api.fundforindonesia.org under Yayasan Indonesia Emas). Every fact below was verified directly against the live host on 2026-09-05 — file contents, `docker ps`, `docker volume ls`, `psql \l` / `\du`, `mc ls`, `/etc/cron.d`, `~/.config/systemd/user/`, and the runner's `.runner` file. Where this plan asserts something exists or does not exist, that assertion came from a command, not an assumption.

---

## Final Names (authoritative — use these exact values everywhere)

| Thing | Old | New |
|---|---|---|
| npm workspace scope | `@galangdana/*` | `@fundforindonesia/*` |
| Root `package.json` name | `galangdana` | `fundforindonesia` |
| UI wordmark text | `GalangDana` | `FundForIndonesia` |
| Postgres database | `galangdana` | `fundforindonesia` |
| Postgres role | `galangdana` | `fundforindonesia` |
| Postgres password | `galangdana` | freshly generated, host-only (never committed) |
| MinIO root user | `galangdana` | `fundforindonesia` |
| MinIO root password | `galangdana-dev-secret` | freshly generated, host-only |
| Meilisearch master key | `galangdana-dev-master-key` | freshly generated, host-only |
| Compose project name | `galangdana` | `fundforindonesia` |
| Docker volumes | `galangdana_{pgdata,miniodata,meilidata}` | `fundforindonesia_{pgdata,miniodata,meilidata}` |
| systemd units | `galangdana-api.service`, `galangdana-web.service` | `fundforindonesia-api.service`, `fundforindonesia-web.service` |
| Runner label | `galangdana-deploy` | `fundforindonesia-deploy` |
| Deploy concurrency group | `galangdana-production-deploy` | `fundforindonesia-production-deploy` |
| Backup cron file | `/etc/cron.d/galangdana-pg-backup` | `/etc/cron.d/fundforindonesia-pg-backup` |
| Backup directory | `/home/ubuntu/galangdana-backups` | `/home/ubuntu/fundforindonesia-backups` |
| Backup file prefix | `galangdana-<ts>.sql.gz` | `fundforindonesia-<ts>.sql.gz` |

### Deliberately NOT renamed (verified, with reasons)

- **S3/MinIO buckets.** `mc ls` against the live MinIO returns exactly two buckets: `campaign-media` (8 objects, 532 KiB — real campaign cover images) and `campaign-documents` (3845 objects as of 2026-09-05 10:15 UTC — see below on why this count and its interpretation both differ from an earlier draft of this plan). **Neither bucket's name contains the brand.** There is no `galangdana-media` bucket and never was — `S3_BUCKET_MEDIA=galangdana-media` in the `.env` files is dead config read by nothing (verified: 0 code reads, see Task 4 Step 1). **There is therefore no bucket rename, no `mc cp -r` object migration, and no rollback window to manage.** The only brand-bearing MinIO values are the *root credentials*, handled in Task 5.
  **Correction, verified during this plan's own review pass:** `campaign-documents` does **not** currently hold 3654 real KYC documents as an earlier draft of this plan assumed. Every object in it is 14–57 bytes (total ~60 KiB) — a 16-byte file cannot be a real ID scan or selfie photo. This bucket currently holds placeholder/stub test data, not production KYC uploads. The object count is also actively drifting (it grew by 191 in the few hours between this plan's first draft and its verification pass), meaning something is still writing stubs into this bucket in production. **Consequence for Task 5:** never compare against a fixed count written in this document — snapshot the count fresh at maintenance-window start (Task 5 Step 1) and compare against that snapshot (Task 5 Step 6). The genuinely valuable, non-reproducible data at stake in Task 5 is `campaign-media`'s 8 real cover images and the Postgres rows — treat `campaign-documents` as "verify the object count round-trips," not "verify real donor documents survive," until it actually holds real uploads.
- **Docker Compose service keys** (`postgres:`, `redis:`, `minio:`, `mailpit:`, `imgproxy:`, `meilisearch:`). These are generic service identifiers that never contained the brand. Renaming them would churn every `docker compose exec`/`logs` invocation in the repo's docs and scripts for zero benefit. Only the top-level `name:` key bears the brand.
- **CI job key `test`.** `master`'s branch protection required status checks are `test` and `GitGuardian Security Checks` (verified live via `gh api repos/andrianm28/galangdana/branches/master/protection` on 2026-09-05 — **not** `deploy`, contrary to an earlier draft of this plan). Renaming the `test` job key would make that required check permanently pending and block every future PR, including this plan's own rollback PRs. `deploy` is not itself a required check (its displayed check name is `Deploy to fundforindonesia.org`, set via the job's own `name:` field, which is why branch protection never matched on the job key to begin with) — but this plan leaves its job key unchanged anyway, as unnecessary churn rather than a safety requirement. See Global Constraints for two more branch-protection facts this plan did not originally account for.
- **Historical plan documents** under `docs/superpowers/plans/*.md` (11 historical files as of 2026-09-05 — 12 total in the directory once this rename plan itself is counted — ~500 occurrences across the 11 historical ones). See Task 10 for the reasoning.
- **`biome.json`, `bunfig.toml`, `tsconfig.base.json`, all `tsconfig.json` files.** Verified: none reference any package name. There are **no TypeScript `paths` mappings anywhere in this repo** — cross-package resolution is done entirely by Bun workspaces via each `package.json`'s `name`. The single mention in `apps/web/tsconfig.json` is inside a `//` comment (Task 1 Step 3 fixes that one line for tidiness only).
- **The Indonesian phrase "Galang Dana"** in `apps/web/src/routes/(campaigner)/create/info/+page.svelte:2` — `"Galang Dana untuk Kebaikan"` means "raise funds for good". This is ordinary Indonesian copy, not the brand. **Do not touch it.** Any blind case-insensitive search-and-replace will corrupt it; this is exactly why no task below uses an unbounded `sed` over `.svelte` prose.

### Explicitly OUT OF SCOPE

- **The filesystem path `/home/ubuntu/galangdana`.** It is `WorkingDirectory=` for both live systemd units, the hardcoded `working-directory:` of all five CD deploy steps, the target of the backup cron, and the working directory of the session executing this plan. Renaming it out from under a running system is a separate, higher-risk operation with no rename benefit that this plan's other tasks do not already deliver. **This plan renames everything *inside* the repo and on the host, and leaves the outer directory path alone.** Every path literal in every task below therefore still reads `/home/ubuntu/galangdana` — that is intentional, not an oversight.
- **The GitHub repository name `andrianm28/galangdana`.** See Open Questions.
- **The self-hosted runner's registered *name*** (`galangdana-host-runner`) and its directory (`/home/ubuntu/actions-runner-galangdana`). See Task 7 for why the *label* is renamed but the *name* is not.

---

## Global Constraints

- **Every task must leave the site serving traffic.** After each task, `curl -sf -o /dev/null -w "%{http_code}" https://fundforindonesia.org/` and `.../api.fundforindonesia.org/healthz` must both return `200`. This is the acceptance gate for every task, stated explicitly in each one. If it does not return `200`, execute that task's rollback before doing anything else.
- **Merging to `master` deploys to production immediately.** The `deploy` job in `.github/workflows/ci.yml` runs on `push` to `master`, on a self-hosted runner on the production host, and does `git reset --hard origin/master` in the live checkout, `bun install`, `bun --env-file=.env.production run db:migrate`, `bun run build`, then `systemctl --user restart` on both services. **There is no such thing as "merging but not deploying" here.** Every PR in this plan is a production deploy; treat it as one.
- **Do not rename the `test` job key in `ci.yml`.** Branch protection's required status checks — verified live on 2026-09-05 via `gh api repos/andrianm28/galangdana/branches/master/protection` — are `test` and `GitGuardian Security Checks`. `deploy` is **not** a required check (its check name is set by the job's own `name: Deploy to fundforindonesia.org`, not its key), contrary to what an earlier draft of this plan assumed. Renaming `test` makes that required check never report, permanently blocking every PR including the rollback PR. Only the `deploy` job's `runs-on:` label, `concurrency.group`, and the two `systemctl` service names change (its job key stays `deploy` regardless, as unnecessary churn to avoid, not because branch protection requires it).
- **`GitGuardian Security Checks` is also a required check, and this plan's own tasks can trip it.** It is a secret-scanning check. Task 4 moves real committed credential literals around (`POSTGRES_PASSWORD: galangdana`, `MINIO_ROOT_PASSWORD: galangdana-dev-secret`, `MEILI_MASTER_KEY: galangdana-dev-master-key`), and Task 4 Step 2's `.env.example` comment quotes those old passwords verbatim as an example of what was wrong with them. If GitGuardian flags that PR, redact the literal from the comment rather than treating it as a false positive to argue past.
- **Branch protection is `strict: true` and `enforce_admins: true`.** `strict` means every PR must be brought up to date with `master` immediately before merging — since Tasks 1 through 10 are strictly sequential and each depends on the previous task's merge, rebase/update-branch right before opening each task's PR, not just once at the start. `enforce_admins` means nobody — including a repo admin — can bypass a stuck required check. Every "revert the merge commit" rollback named in this plan is itself a PR, and depends on `test` and `GitGuardian Security Checks` both passing on that revert; there is no admin override if either is stuck.
- **`.env` and `.env.production` are gitignored** (verified in `.gitignore`). They exist only on the host at `/home/ubuntu/galangdana/.env` and `/home/ubuntu/galangdana/.env.production`. **No PR can change them.** Every edit to those two files is a manual host action inside a task below. Conversely `.env.example` IS tracked and IS changed by a PR.
- **Never commit a real credential.** Tasks 4 and 5 replace committed literal passwords (`POSTGRES_PASSWORD: galangdana`, `MINIO_ROOT_PASSWORD: galangdana-dev-secret`, `MEILI_MASTER_KEY: galangdana-dev-master-key`) with `${VAR:?...}` compose interpolation sourced from the gitignored `.env`. **This repo is public** (stated as fact in `ci.yml`'s own deploy-job comment). The new generated secrets go into `.env`/`.env.production` on the host and nowhere else. When a task writes `<NEW_DB_PASSWORD>` etc., that is a reference to a value generated in Task 5 Step 1 and stored on the host — it is not a placeholder to be left unresolved.
- **A `postgres` container's `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` env vars only take effect on first volume initialization.** Changing them against an existing `pgdata` volume renames nothing and is silently ignored. The live database and role are renamed **only** by the explicit `ALTER DATABASE ... RENAME TO` / `ALTER ROLE ... RENAME TO` in Task 5. The compose env values are updated purely so a *fresh* volume initializes consistently, and so the container healthcheck's `pg_isready -U fundforindonesia` matches reality.
- **`ALTER ROLE ... RENAME TO` can clear the role's password.** If the stored password uses `md5` hashing, the hash incorporates the username, so Postgres invalidates it on rename and emits a notice. Postgres 16 defaults to `scram-sha-256`, where it survives — but Task 5 does not rely on knowing which: it issues `ALTER ROLE ... WITH PASSWORD` **immediately after** the rename, which makes the question moot. Do not reorder those two statements.
- **The Docker Compose `name:` key determines volume names.** The live volumes are `galangdana_pgdata` / `galangdana_miniodata` / `galangdana_meilidata` (verified via `docker volume ls`; 70.7 MB / 57.2 MB / 3.3 MB — re-measured 2026-09-05, within ~5% of an earlier draft's numbers). Changing `name:` to `fundforindonesia` and running `docker compose up` **without first migrating the volumes creates three brand-new empty volumes** — the live database and every object in `campaign-media`/`campaign-documents` would appear to have vanished. This is the single largest data-loss risk in this plan. Task 5 copies the volumes before ever bringing the renamed project up, and never deletes the originals (Task 11 does, after a soak period).
- **An unrelated Docker Compose project already runs on this host with confusingly similar names.** `docker ps`/`docker volume ls` will also show containers `fund-for-indonesia-app-1`/`fund-for-indonesia-db-1` and volumes `fund-for-indonesia_postgres_data`/`fund-for-indonesia_uploads` — a different project, hyphenated differently from this plan's targets (`fundforindonesia_*`, no hyphens). They do not collide, but during Task 5's maintenance window, double-check hyphenation before running any `docker volume rm` or `--project-name` command so the two are never confused.
- **MinIO and Meilisearch read their root credentials from env on every start** — unlike Postgres, there is no first-init-only behavior. Changing `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` and `MEILI_MASTER_KEY` in compose and restarting genuinely rotates them. Rotating the Meilisearch master key invalidates any *derived* API keys but not the master key itself, and does not touch indexed documents; Task 5 verifies search still returns results rather than assuming this.
- **Add the new runner label before merging the workflow change that requires it.** A `runs-on:` label no runner carries does not fail — the job queues forever, and because `concurrency` is set with `cancel-in-progress: false`, it will also block subsequent deploys. Task 7 adds the label additively (the runner carries both) before Task 7's PR switches `runs-on:`.
- **Create the new systemd units before merging the workflow change that restarts them.** Same failure mode in reverse: `systemctl --user restart fundforindonesia-api.service` against a nonexistent unit fails the deploy job after the build has already replaced the running code.
- **Run `scripts/backup-db.sh` manually immediately before Task 5**, in addition to the nightly cron at `/etc/cron.d/galangdana-pg-backup` (verified installed: `0 3 * * * ubuntu /home/ubuntu/galangdana/scripts/backup-db.sh`). The most recent nightly dump is `/home/ubuntu/galangdana-backups/galangdana-20260905T085227Z.sql.gz` (903 KB). A dump taken minutes before the destructive step is the difference between losing zero donations and losing a day of them.
- **The live database contains brand text in real rows**, not just in seed source. Verified: 1 row in `campaigners` (`display_name = 'GalangDana Program Mitra'`) and 1 row in `campaigns` (`title = 'Dana Zakat untuk Program Amil Mitra GalangDana'`). Editing `packages/db/src/seed/*.seed.ts` changes what a *fresh* environment gets and does **not** update production. Task 5 Step 6 issues the explicit `UPDATE` statements.
- **Verify, do not assume, at each gate.** Every task ends with commands whose output must be checked. "The command exited 0" is not the same as "the site works".

---

## File Structure

```
package.json                          modify — root name galangdana -> fundforindonesia
bun.lock                              regenerated by `bun install` (not hand-edited)

apps/api/package.json                 modify — name + 6 workspace deps
apps/web/package.json                 modify — name + 4 workspace deps
packages/{db,ui,contracts,money,
  payments,media,search}/package.json  modify — name + workspace deps

apps/**/*.ts, apps/**/*.svelte        modify — 105 files, 159 `@galangdana/` specifiers
                                       (145 across 95 tracked-source files if you
                                       exclude the 10 gitignored .svelte-kit/types/
                                       build-artifact files, which git won't stage)
packages/**/*.ts, **/*.svelte
apps/web/src/app.css                  modify — @import "@galangdana/ui/src/theme.css"
apps/web/tsconfig.json                modify — one comment mentioning @galangdana/api

packages/ui/src/layouts/ConsumerShell.svelte      modify — wordmark text
packages/ui/src/layouts/ConsumerShell.test.ts     modify
packages/ui/src/layouts/AdminShell.svelte         modify — wordmark text
packages/ui/src/layouts/AdminShell.test.ts        modify
apps/web/src/routes/login/+page.svelte            modify — "Masuk ke GalangDana"
apps/web/src/routes/login/page.render.test.ts     modify

docker-compose.yml                    modify — name:, POSTGRES_*, MINIO_ROOT_*, MEILI_MASTER_KEY
.github/workflows/ci.yml              modify — test-job env/services, deploy label,
                                                concurrency group, systemctl unit names
.env.example                          modify — drop dead vars, rename live ones, document secrets
scripts/backup-db.sh                  modify — container/user/db defaults, dir, file prefix

apps/api/src/lib/media-s3.ts          modify — MinIO credential fallbacks
apps/api/src/routes/campaigns.ts      modify — MinIO credential fallbacks
apps/api/src/routes/campaign-drafts.ts modify — MinIO credential fallbacks
packages/db/src/seed/upload-cover-images.ts modify — MinIO fallbacks + console message
packages/db/src/client.ts             modify — DATABASE_URL fallback
packages/db/drizzle.config.ts         modify — DATABASE_URL fallback
packages/search/src/client.ts         modify — MEILISEARCH_API_KEY fallback
packages/db/src/seed/campaigners.seed.ts modify — "GalangDana Program Mitra"
packages/db/src/seed/campaigns.seed.ts   modify — campaign title + campaignerName

HOST-ONLY (not in git, edited manually):
/home/ubuntu/galangdana/.env                          Tasks 3, 5
/home/ubuntu/galangdana/.env.production               Tasks 3, 5
~/.config/systemd/user/fundforindonesia-api.service   Task 6 (new)
~/.config/systemd/user/fundforindonesia-web.service   Task 6 (new)
/etc/cron.d/fundforindonesia-pg-backup                Task 8 (new, needs sudo)
/etc/nginx/sites-enabled/*galangdana*                 Task 9 (needs sudo)
```

---

## Task 1: Rename the workspace scope `@galangdana/*` → `@fundforindonesia/*`

**Files:**
- Modify: `package.json`, all 9 workspace `package.json` files, 104 source files, `apps/web/src/app.css`, `apps/web/tsconfig.json`
- Regenerate: `bun.lock`

**Interfaces:**
- Consumes: nothing — this task has zero coupling to host state, env vars, or running services.
- Produces: the `@fundforindonesia/*` scope, resolvable by Bun workspaces. Every later task assumes this scope exists.

This is one atomic commit. Package names and import specifiers cannot be split across commits — the intermediate state does not resolve and does not build.

- [ ] **Step 1: Rewrite every package name and workspace dependency**

The 9 scoped packages are `@galangdana/{api,web,db,ui,contracts,money,payments,media,search}`. Both the `"name"` field and every `"workspace:*"` dependency key live in `package.json` files, so one substitution covers both:

```bash
cd /home/ubuntu/galangdana
sed -i 's|"@galangdana/|"@fundforindonesia/|g' \
  apps/api/package.json apps/web/package.json \
  packages/db/package.json packages/ui/package.json packages/contracts/package.json \
  packages/money/package.json packages/payments/package.json \
  packages/media/package.json packages/search/package.json
```

Then the root package's own name, by hand (it is unscoped, so the pattern above misses it) — in `package.json`:

```json
{
  "name": "fundforindonesia",
  "private": true,
```

Confirm all ten:

```bash
grep -h '"name"' package.json apps/*/package.json packages/*/package.json
```

Expected output is exactly `fundforindonesia` plus the nine `@fundforindonesia/...` names, with no `galangdana` remaining.

- [ ] **Step 2: Rewrite all 159 import specifiers across 105 files (145 across 95 tracked-source files, excluding gitignored build artifacts)**

The specifier `@galangdana/` is unambiguous — it cannot collide with the Indonesian phrase "Galang Dana" (different case, and always preceded by `@`), so a bounded substitution is safe here. Restrict it to source extensions under `apps/` and `packages/`, excluding `node_modules`:

```bash
cd /home/ubuntu/galangdana
grep -rl '@galangdana/' \
  --include='*.ts' --include='*.svelte' --include='*.json' \
  --include='*.js' --include='*.css' \
  apps packages | grep -v node_modules | xargs sed -i 's|@galangdana/|@fundforindonesia/|g'
```

This also covers `apps/web/src/app.css` line 2 (`@import "@galangdana/ui/src/theme.css";`), which is a real build-breaking reference, not a comment.

Verify the count went to zero and that the per-package distribution matches what was there before (contracts 50, db 44, ui 24, money 21, payments 7, api 5, search 4, media 3, web 1 — 159 total; `ui`'s count of 24 rather than 23 includes `apps/web/src/app.css:2`'s `@import`, which is a `.css` file and so is correctly swept in by the `--include='*.css'` flag below even though the File Structure table lists `app.css` as its own separate line):

```bash
grep -r '@galangdana/' --include='*.ts' --include='*.svelte' --include='*.json' \
  --include='*.js' --include='*.css' apps packages | grep -v node_modules | wc -l   # expect 0
grep -rho '@fundforindonesia/[a-z]*' --include='*.ts' --include='*.svelte' \
  --include='*.json' --include='*.js' --include='*.css' apps packages \
  | grep -v node_modules | sort | uniq -c | sort -rn                                 # expect 159 total
```

Expect 159 across 105 files. If you first cleaned `.svelte-kit/` build output (it's gitignored and regenerated by `bun run build`, never hand-edited), expect 145 across 95 files instead — the difference is entirely `apps/web/.svelte-kit/types/` artifacts that `git add -A` would never stage anyway.

- [ ] **Step 3: Fix the one comment reference**

`apps/web/tsconfig.json` mentions the old scope inside a `//` comment explaining why `bun-types` sits alongside `@sveltejs/kit`. Step 2's `--include='*.json'` already rewrote it. Confirm the comment now reads `@fundforindonesia/api` and that the file is otherwise unchanged:

```bash
git diff apps/web/tsconfig.json
```

There are no TypeScript `paths` mappings in this repo to update — confirm:

```bash
grep -rn '"paths"' tsconfig.base.json apps/*/tsconfig.json packages/*/tsconfig.json   # expect no output
```

`biome.json` and `bunfig.toml` reference no package names — confirm they are untouched:

```bash
git diff --stat biome.json bunfig.toml   # expect no output
```

- [ ] **Step 4: Regenerate the lockfile**

`bun.lock` contains 32 occurrences of the old scope. Do not hand-edit it:

```bash
cd /home/ubuntu/galangdana && bun install
grep -c galangdana bun.lock   # expect 0
```

- [ ] **Step 5: Full verification**

```bash
cd /home/ubuntu/galangdana
bun run lint
bun run typecheck
bun run test
bun run test:web
bun run test:ui
bun run --cwd apps/web build
```

Every one must pass. A missed import site shows up here as a module-resolution failure, which is exactly the intended safety net. Record the `bun run test` pass/fail counts and compare against the pre-change baseline — the numbers must be identical; a rename must not change a single test outcome.

- [ ] **Step 6: Commit, PR, merge**

```bash
git checkout -b rename/workspace-scope
git add -A
git commit -m "refactor: rename npm workspace scope @galangdana/* to @fundforindonesia/*"
git push -u origin rename/workspace-scope
gh pr create --title "Rename npm workspace scope to @fundforindonesia/*" \
  --body "Mechanical rename of the retired brand name in package names and import specifiers. No behavior change. Lockfile regenerated via bun install."
```

Wait for CI green, then merge. The `deploy` job runs automatically.

- [ ] **Step 7: Acceptance gate**

After the deploy job reports success:

```bash
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
```

Both must be `200`. Also load https://fundforindonesia.org/ in a browser and confirm campaign cards render with their cover images (this exercises the `@fundforindonesia/media` imgproxy signing path end to end).

**Rollback:** `git revert` the merge commit and merge the revert. The CD pipeline redeploys the previous state. Nothing outside git changed in this task, so the revert is complete.

---

## Task 2: Rename the user-visible wordmark `GalangDana` → `FundForIndonesia`

**Files:**
- Modify: `packages/ui/src/layouts/ConsumerShell.svelte`, `packages/ui/src/layouts/ConsumerShell.test.ts`, `packages/ui/src/layouts/AdminShell.svelte`, `packages/ui/src/layouts/AdminShell.test.ts`, `apps/web/src/routes/login/+page.svelte`, `apps/web/src/routes/login/page.render.test.ts`

**Interfaces:**
- Consumes: the `@fundforindonesia/ui` package from Task 1.
- Produces: correct brand text in the site header, admin sidebar, and login page.

**This is a real user-facing bug, not cosmetics.** The production site currently renders the retired brand name "GalangDana" in its header on every page. Verified live in source at `ConsumerShell.svelte:14` and `AdminShell.svelte:14`.

- [ ] **Step 1: Consumer header wordmark**

`packages/ui/src/layouts/ConsumerShell.svelte` line 14:

```svelte
      <span class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</span>
```

- [ ] **Step 2: Admin sidebar wordmark**

`packages/ui/src/layouts/AdminShell.svelte` line 14:

```svelte
    <span class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</span>
```

- [ ] **Step 3: Login page heading**

`apps/web/src/routes/login/+page.svelte` line 54:

```svelte
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Masuk ke FundForIndonesia</h1>
```

- [ ] **Step 4: Update the three assertions that pin the old text**

- `packages/ui/src/layouts/ConsumerShell.test.ts` — the test name on line 8 and the `getByText("GalangDana")` on line 12.
- `packages/ui/src/layouts/AdminShell.test.ts` — the test name on line 8 and the `getByText("GalangDana")` on line 10.
- `apps/web/src/routes/login/page.render.test.ts` line 15 — `getByText("Masuk ke GalangDana")`.

All become `FundForIndonesia` / `Masuk ke FundForIndonesia`. These assertions failing is the proof the rename landed; update them, do not delete them.

- [ ] **Step 5: Confirm nothing else was caught**

```bash
cd /home/ubuntu/galangdana
grep -rn 'GalangDana' --include='*.svelte' --include='*.ts' apps packages | grep -v node_modules
```

The only remaining hits must be the two seed files (`campaigners.seed.ts`, `campaigns.seed.ts`) — those are handled in Task 4 Step 6, paired with the live-row update in Task 5. **`apps/web/src/routes/(campaigner)/create/info/+page.svelte` must NOT appear in this output** — its `"Galang Dana untuk Kebaikan"` is Indonesian prose with a space, and the grep pattern above (no space) correctly excludes it. If it does appear, something in an earlier step over-matched; revert and redo.

- [ ] **Step 6: Verify, commit, PR, merge**

```bash
bun run lint && bun run typecheck && bun run test:web && bun run test:ui
git checkout -b rename/wordmark
git add -A
git commit -m "fix(ui): render the current brand name FundForIndonesia in header, sidebar, and login"
git push -u origin rename/wordmark
gh pr create --title "Show FundForIndonesia, not the retired GalangDana wordmark" \
  --body "The live site still renders the pre-rebrand wordmark on every page. Updates the three render sites and the three assertions pinning the old text."
```

Merge after CI green.

- [ ] **Step 7: Acceptance gate**

Load https://fundforindonesia.org/ and confirm the header reads **FundForIndonesia**. Load https://fundforindonesia.org/login and confirm the heading. Both health checks return `200`.

**Rollback:** revert the merge commit.

---

## Task 3: Pin Meilisearch credentials explicitly in the host env files (no deploy, no downtime)

**Files:**
- Modify (host only, gitignored): `/home/ubuntu/galangdana/.env`, `/home/ubuntu/galangdana/.env.production`

**Interfaces:**
- Consumes: nothing.
- Produces: production no longer depends on the brand-bearing hardcoded fallback in `packages/search/src/client.ts`. **Task 4 must not run before this task completes.**

**Why this task exists.** `packages/search/src/client.ts:10` reads `process.env.MEILISEARCH_API_KEY ?? "galangdana-dev-master-key"`. Neither `.env` nor `.env.production` defines `MEILISEARCH_API_KEY` — they define `MEILI_MASTER_KEY`, which **nothing reads** (verified: 0 code reads for `MEILI_URL`, `MEILI_MASTER_KEY`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_MEDIA`). Production search therefore works today *only* because that hardcoded fallback happens to match the master key baked into the running container. Rewriting that fallback in Task 4 would silently break production search on deploy. Making the env explicit first removes the coupling, so Task 4's edit becomes genuinely inert.

- [ ] **Step 1: Add the two variables with their CURRENT values**

Append to **both** `/home/ubuntu/galangdana/.env` and `/home/ubuntu/galangdana/.env.production`, under the existing `# Meilisearch` block:

```bash
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_API_KEY=galangdana-dev-master-key
```

These are deliberately the **old** values. This task changes no credential; it only makes the existing one explicit. Rotation happens in Task 5.

- [ ] **Step 2: Restart the API so it picks up the new EnvironmentFile contents**

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart galangdana-api.service
systemctl --user status galangdana-api.service --no-pager
```

(Unit name is still the old one at this point — Task 6 renames it.)

- [ ] **Step 3: Acceptance gate — prove search still works**

```bash
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf 'https://api.fundforindonesia.org/search?q=banjir' | head -c 400; echo
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
```

The search response must contain real campaign results, not an empty list and not an auth error. Also load https://fundforindonesia.org/search?q=banjir in a browser and confirm results render. If search returns empty or errors, remove the two lines you just added, restart, and re-verify before investigating — the old behavior is one line away.

**Rollback:** delete the two added lines from both files, `systemctl --user restart galangdana-api.service`.

---

## Task 4: Rename brand-bearing config and source fallbacks (inert on deploy)

**Files:**
- Modify: `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `scripts/backup-db.sh`, `apps/api/src/lib/media-s3.ts`, `apps/api/src/routes/campaigns.ts`, `apps/api/src/routes/campaign-drafts.ts`, `packages/db/src/client.ts`, `packages/db/drizzle.config.ts`, `packages/db/src/seed/upload-cover-images.ts`, `packages/search/src/client.ts`, `packages/db/src/seed/campaigners.seed.ts`, `packages/db/src/seed/campaigns.seed.ts`

**Interfaces:**
- Consumes: Task 3's explicit Meilisearch env pinning (without it, Step 5 breaks production search).
- Produces: a repo whose committed config describes the *post-rename* infrastructure. **Nothing in this PR takes effect on deploy** — the deploy job never runs `docker compose`, and every changed source fallback is shadowed by an explicit value in `.env.production`. The compose file will describe a project that does not exist yet; Task 5 creates it.

**Critical:** after this PR merges and before Task 5 completes, **nobody may run `docker compose up`, `down`, or `restart` without an explicit `--project-name galangdana` flag.** Between these two tasks the compose file says `fundforindonesia` while the running project is still `galangdana`. A bare `docker compose up -d` in that window creates three empty volumes and starts a second, empty stack whose ports collide with the live one. Task 5 Step 4 uses the explicit flag for exactly this reason.

- [ ] **Step 1: Delete the dead env vars from `.env.example`**

Verified read by zero code: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_MEDIA`, `MEILI_URL`, `MEILI_MASTER_KEY`. `S3_BUCKET_MEDIA=galangdana-media` in particular names a bucket that does not exist in MinIO. Renaming dead config would preserve the confusion; delete it instead.

Re-confirm before deleting:

```bash
cd /home/ubuntu/galangdana
for v in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET_MEDIA MEILI_URL MEILI_MASTER_KEY; do
  printf '%s -> ' "$v"
  grep -rn "process\.env\.$v\b" --include='*.ts' --include='*.svelte' apps packages scripts \
    2>/dev/null | grep -v node_modules | wc -l
done
```

All six must print `0`. Then remove the `# MinIO (S3-compatible)` block's four `S3_*` lines and the `# Meilisearch` block's two `MEILI_*` lines from `.env.example`, replacing the Meilisearch block with the two names the code actually reads:

```bash
# Meilisearch
MEILISEARCH_URL=http://localhost:7700
# Must match MEILI_MASTER_KEY in your .env (docker-compose.yml reads it from there).
MEILISEARCH_API_KEY=
```

- [ ] **Step 2: Update the remaining `.env.example` values and document the new secrets**

`DATABASE_URL` becomes the renamed database, and the three container credentials that `docker-compose.yml` will now interpolate get documented. Replace the `# Postgres` block and add a new block:

```bash
# Postgres
DATABASE_URL=postgres://fundforindonesia:fundforindonesia@localhost:55434/fundforindonesia

# Container credentials, interpolated into docker-compose.yml. Required --
# docker-compose.yml uses ${VAR:?} so `docker compose up` fails loudly rather
# than silently starting with a committed default. This repo is public; the
# previous literals (POSTGRES_PASSWORD: galangdana, MINIO_ROOT_PASSWORD:
# galangdana-dev-secret, MEILI_MASTER_KEY: galangdana-dev-master-key) were
# readable by anyone, which is the same "fail closed rather than ship a
# committed default" reasoning already applied to MOCK_MIDTRANS_SERVER_KEY and
# SUMOPOD_WEBHOOK_SECRET below. For local dev generate your own, e.g.:
#   POSTGRES_PASSWORD="$(openssl rand -hex 24)"
POSTGRES_PASSWORD=
MINIO_ROOT_PASSWORD=
MEILI_MASTER_KEY=
```

Also update `MEDIA_S3_ACCESS_KEY_ID=fundforindonesia` and drop the literal from `MEDIA_S3_SECRET_ACCESS_KEY=` (leave it empty, sourced from `MINIO_ROOT_PASSWORD`). Leave `MEDIA_S3_BUCKET=campaign-media` and `MEDIA_S3_PRIVATE_BUCKET=campaign-documents` **unchanged** — those bucket names never contained the brand.

- [ ] **Step 3: Rewrite `docker-compose.yml`**

Change the top-level project name (line 1):

```yaml
name: fundforindonesia
```

The `postgres` service — note `POSTGRES_USER`/`POSTGRES_DB` here are for *fresh volume initialization only*; the live rename is Task 5's `ALTER` statements:

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: fundforindonesia
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: fundforindonesia
    ports: ["127.0.0.1:55434:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fundforindonesia"]
```

The `minio` service:

```yaml
    environment:
      MINIO_ROOT_USER: fundforindonesia
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env}
```

The `meilisearch` service:

```yaml
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:?set MEILI_MASTER_KEY in .env}
      MEILI_NO_ANALYTICS: "true"
```

Leave every service key, every port binding, every other healthcheck, the `imgproxy` block and all of its explanatory comments, and the `volumes:` declarations exactly as they are. Add one comment above `name:` recording why the volumes must be migrated rather than recreated:

```yaml
# Changing this `name:` changes the Docker volume prefix (pgdata ->
# fundforindonesia_pgdata). The galangdana_* volumes were copied, not
# recreated, when this was renamed -- see docs/superpowers/plans/
# 2026-09-05-rename-galangdana-to-fundforindonesia.md Task 5. Never change
# `name:` and run `docker compose up` without migrating volumes first: compose
# silently creates new empty ones and the database appears to vanish.
name: fundforindonesia
```

- [ ] **Step 4: Update `.github/workflows/ci.yml`**

The `test` job's `services.postgres.env` (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` → `fundforindonesia`), its `--health-cmd "pg_isready -U fundforindonesia"`, `services.meilisearch.env.MEILI_MASTER_KEY`, and in the job-level `env:` block: `DATABASE_URL: postgres://fundforindonesia:fundforindonesia@localhost:5432/fundforindonesia`, `MEILISEARCH_API_KEY`, `MEDIA_S3_ACCESS_KEY_ID: fundforindonesia`, `MEDIA_S3_SECRET_ACCESS_KEY: fundforindonesia-dev-secret`. Also the `Start MinIO` step's `-e MINIO_ROOT_USER=` / `-e MINIO_ROOT_PASSWORD=` and the `Create media bucket` step's `mc alias set local http://localhost:9000 fundforindonesia fundforindonesia-dev-secret`.

For the Meilisearch key in CI pick a non-brand literal, e.g. `ci-meili-master-key`, and use it in **both** places it appears (the service env on line 35, and the job env `MEILISEARCH_API_KEY` on line 77 — grep to confirm nowhere else). These CI values are throwaway credentials for an ephemeral, isolated runner; they are not the production ones and must not be.

Also fix one comment this step would otherwise miss: `ci.yml:80` reads `# every row server-side via @galangdana/media's buildImgproxyUrl --`. This is the **only** `@galangdana/` occurrence anywhere in the repo outside `apps/` and `packages/` — Task 1 Step 2's sed is scoped to those two directories and will not touch it, so without this line it would survive every task and surface as an unexplained hit in Task 11 Step 5's final sweep. Change it to `@fundforindonesia/media`.

Leave `MEDIA_S3_BUCKET: campaign-media` and the `campaign-documents` bucket creation alone. **Do not change the `test:` job key** (it is a required branch-protection status check; see Global Constraints). The `deploy:` job key is not required by branch protection but is left unchanged anyway as unnecessary churn. Do not change `runs-on: [self-hosted, galangdana-deploy]`, `concurrency.group`, or the two `systemctl` unit names in this PR — those are Tasks 6 and 7, and changing them here breaks the very deploy that ships this PR.

Verify the job keys survived:

```bash
grep -n '^  test:\|^  deploy:' .github/workflows/ci.yml   # expect both, unchanged
```

- [ ] **Step 5: Rewrite the source credential fallbacks**

Seven files, each a `??` default. After Task 3, none of these is load-bearing in production (`.env.production` sets `DATABASE_URL`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, and now `MEILISEARCH_API_KEY` explicitly), and CI sets all of them too — so these are local-dev conveniences only.

- `apps/api/src/lib/media-s3.ts:15-16`, `apps/api/src/routes/campaigns.ts:51-52`, `apps/api/src/routes/campaign-drafts.ts:34-35`, `packages/db/src/seed/upload-cover-images.ts:19-20` — all four have the identical pair:

```typescript
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "fundforindonesia",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "fundforindonesia-dev-secret",
```

- `packages/db/src/client.ts:6` and `packages/db/drizzle.config.ts:8`:

```typescript
  process.env.DATABASE_URL ?? "postgres://fundforindonesia:fundforindonesia@localhost:55434/fundforindonesia";
```

- `packages/search/src/client.ts:10`:

```typescript
    apiKey: process.env.MEILISEARCH_API_KEY ?? "fundforindonesia-dev-master-key",
```

- `packages/db/src/seed/upload-cover-images.ts:43` — the operator-facing error message names the MinIO console login:

```typescript
    `Bucket "${bucket}" does not exist at ${endpoint}. Create it once via the MinIO console (http://localhost:9001, login fundforindonesia/fundforindonesia-dev-secret) or \`docker compose exec minio mc mb local/campaign-media\`, then re-run this script.`,
```

- [ ] **Step 6: Rewrite the seed brand text**

`packages/db/src/seed/campaigners.seed.ts:8`:

```typescript
  { type: "platform", displayName: "FundForIndonesia Program Mitra" },
```

`packages/db/src/seed/campaigns.seed.ts:77` and `:84`:

```typescript
    title: "Dana Zakat untuk Program Amil Mitra FundForIndonesia",
```
```typescript
    campaignerName: "FundForIndonesia Program Mitra",
```

Seeds are `onConflictDoNothing`/find-or-create (per `ci.yml`'s own note), so this changes what a *fresh* database gets and does **not** update the two existing production rows. Task 5 Step 6 does that.

- [ ] **Step 7: Rewrite `scripts/backup-db.sh`**

Lines 17 and 20–29 and 45. The script's `WORKDIR`-equivalent path stays `/home/ubuntu/galangdana` (directory rename is out of scope); everything else changes:

```bash
#   0 3 * * * /home/ubuntu/galangdana/scripts/backup-db.sh >> /home/ubuntu/fundforindonesia-backups/backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/fundforindonesia-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
CONTAINER="${POSTGRES_CONTAINER:-fundforindonesia-postgres-1}"
DB_USER="${POSTGRES_USER:-fundforindonesia}"
DB_NAME="${POSTGRES_DB:-fundforindonesia}"
```

and line 29:

```bash
outfile="$BACKUP_DIR/fundforindonesia-$timestamp.sql.gz"
```

and the retention prune on line 45:

```bash
find "$BACKUP_DIR" -name 'fundforindonesia-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete
```

The container name `fundforindonesia-postgres-1` is what the renamed compose project will produce. **This script is broken between this PR merging and Task 5 completing** — it targets a container that does not exist yet, and the nightly cron would fail with a non-zero exit and no backup written. That is acceptable only because Task 5 runs the same day and Task 5 Step 1 takes a manual dump. **If Task 5 will not run within 24 hours of this PR merging, do not merge this PR yet.** Task 8 fixes the cron path and directory afterwards.

`RETENTION_DAYS` changed from 14 to 35, not just renamed — a consequence of the soak period decision (Open Questions, decided 2026-09-05: 30 days). Task 11 Step 1 needs 30 consecutive nightly dumps still present to verify a full soak; the original 14-day retention would have auto-pruned them away by day 15, long before Task 11 ever runs. 35 gives a 5-day margin over the 30-day soak.

- [ ] **Step 8: Verify**

```bash
cd /home/ubuntu/galangdana
bun run lint && bun run typecheck && bun run test && bun run test:web && bun run test:ui
bash -n scripts/backup-db.sh
```

`bun run test` runs against the still-old local database via `.env`'s unchanged `DATABASE_URL` — it must pass with the same counts as Task 1's baseline. Do **not** run `docker compose config` or any other `docker compose` subcommand here without `--project-name galangdana`; and note `docker compose config` will now fail unless `POSTGRES_PASSWORD`/`MINIO_ROOT_PASSWORD`/`MEILI_MASTER_KEY` are set in `.env` (they are not yet — Task 5 Step 2 adds them). That failure is expected and correct at this point.

- [ ] **Step 9: Commit, PR, merge**

```bash
git checkout -b rename/infra-config
git add -A
git commit -m "chore: rename galangdana to fundforindonesia in compose, CI, env template, and fallbacks

Also drops six env vars nothing reads (S3_ENDPOINT, S3_ACCESS_KEY,
S3_SECRET_KEY, S3_BUCKET_MEDIA, MEILI_URL, MEILI_MASTER_KEY) and moves the
three committed container passwords into required .env interpolation.

Inert on deploy: the deploy job runs no docker compose command, and every
changed source fallback is shadowed by an explicit value in .env.production.
Host-side volume and database migration follows in Task 5 of
docs/superpowers/plans/2026-09-05-rename-galangdana-to-fundforindonesia.md."
git push -u origin rename/infra-config
gh pr create --title "Rename infra config to fundforindonesia (inert; host migration follows)" --body "See plan Task 4."
```

Merge after CI green.

- [ ] **Step 10: Acceptance gate**

```bash
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
curl -sf 'https://api.fundforindonesia.org/search?q=banjir' | head -c 200; echo
docker ps --format '{{.Names}}' | grep galangdana   # still the OLD names -- correct
```

Both `200`, search still returns results (proving Task 3 did its job), and the running containers still carry the old project prefix — confirming this PR was genuinely inert.

**Rollback:** revert the merge commit. No host state changed.

---

## Task 5: Maintenance window — Compose project + volume migration, database rename, credential rotation

**Files:**
- Host only: Docker volumes, the live Postgres database, `/home/ubuntu/galangdana/.env`, `/home/ubuntu/galangdana/.env.production`

**Interfaces:**
- Consumes: Task 4's merged `docker-compose.yml` (already describing project `fundforindonesia` with `${...}` credential interpolation) and its rewritten `scripts/backup-db.sh`.
- Produces: database `fundforindonesia` owned by role `fundforindonesia`, volumes `fundforindonesia_*`, containers `fundforindonesia-*-1`, rotated Postgres/MinIO/Meilisearch credentials, and `.env`/`.env.production` pointing at all of it.

**Expected downtime: 3–6 minutes.** This is the one coordinated restart the plan budgets for. Announce it. Do it at low traffic.

**The single biggest risk in this plan is Step 5.** Bringing the renamed compose project up before copying the volumes creates three empty volumes; the database, the real cover images in `campaign-media`, and every object in `campaign-documents` (currently ~3845 objects, mostly placeholder/stub data rather than real KYC documents — see "Deliberately NOT renamed") appear to vanish. The originals are not deleted by anything in this task, so even that is recoverable — but the ordering below avoids it entirely.

- [ ] **Step 1: Take a manual backup and verify it is real**

```bash
cd /home/ubuntu/galangdana
BACKUP_DIR=/home/ubuntu/galangdana-backups \
POSTGRES_CONTAINER=galangdana-postgres-1 \
POSTGRES_USER=galangdana \
POSTGRES_DB=galangdana \
  ./scripts/backup-db.sh
```

(The env overrides are required: Task 4 changed the script's defaults to the post-rename names, which do not exist yet.)

Then prove the dump is not empty or truncated:

```bash
ls -la /home/ubuntu/galangdana-backups/
latest=$(ls -t /home/ubuntu/galangdana-backups/*.sql.gz | head -1)
gzip -t "$latest" && echo "gzip OK"
zcat "$latest" | grep -c 'COPY public.donations' 
zcat "$latest" | wc -l
```

The gzip integrity test must pass and the line count must be substantial (the 2026-09-05 nightly was 903 KB compressed). **Do not proceed if this step did not produce a verified dump.**

Also snapshot the row counts you will verify against afterwards:

```bash
docker exec galangdana-postgres-1 psql -U galangdana -d galangdana -tAc \
  "select 'campaigns='||count(*) from campaigns
   union all select 'donations='||count(*) from donations
   union all select 'users='||count(*) from users"
```

Write these numbers down.

Also snapshot the MinIO object counts you will verify against afterwards. **Always compare Step 6 against this fresh snapshot, never against a number fixed in this document** — the `campaign-documents` count was observed drifting (+191 in a few hours) during this plan's own review, so any hardcoded figure will be stale by execution time:

```bash
docker run --rm --network host --entrypoint sh minio/mc -c \
  "mc alias set local http://localhost:9000 galangdana galangdana-dev-secret && \
   mc ls --recursive --summarize local/campaign-media | tail -2 && \
   mc ls --recursive --summarize local/campaign-documents | tail -2"
```

Write these numbers down too.

- [ ] **Step 2: Generate the three new secrets and stage them in `.env`**

```bash
cd /home/ubuntu/galangdana
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)"
echo "MEILI_MASTER_KEY=$(openssl rand -hex 24)"
```

Append the three generated lines to **`.env`** (this is the file `docker compose` interpolates from). Do not put them in `.env.production` — compose does not read that file. Keep the terminal output; the values are needed in Steps 6 and 8. They are referred to below as `<NEW_DB_PASSWORD>`, `<NEW_MINIO_PASSWORD>`, `<NEW_MEILI_KEY>`.

Confirm compose can now resolve the file, still against the OLD project so nothing is created:

```bash
docker compose --project-name galangdana config --quiet && echo "compose config OK"
```

- [ ] **Step 3: Stop the application services — downtime begins**

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user stop galangdana-web.service galangdana-api.service
systemctl --user is-active galangdana-api.service galangdana-web.service   # expect "inactive"
```

Stop `web` first, then `api`, so no request is in flight against the API when it goes down.

- [ ] **Step 4: Rename the database, the role, and the role's password**

`ALTER DATABASE ... RENAME TO` cannot run while connected to the target database, so connect to the `postgres` maintenance database. It also requires no other sessions on the target — the services are stopped, but confirm:

```bash
docker exec galangdana-postgres-1 psql -U galangdana -d postgres -tAc \
  "select count(*) from pg_stat_activity where datname='galangdana' and pid <> pg_backend_pid()"
```

This must print `0`. If it does not, find the holdout (`select pid, application_name, client_addr from pg_stat_activity where datname='galangdana'`) and stop it properly — do **not** reach for `pg_terminate_backend` against something you have not identified.

Then, as one transaction-free sequence (Postgres does not allow `ALTER DATABASE ... RENAME` inside a transaction block):

```bash
docker exec galangdana-postgres-1 psql -U galangdana -d postgres -v ON_ERROR_STOP=1 -c \
  "ALTER DATABASE galangdana RENAME TO fundforindonesia;"

docker exec galangdana-postgres-1 psql -U galangdana -d postgres -v ON_ERROR_STOP=1 -c \
  "ALTER ROLE galangdana RENAME TO fundforindonesia;"
```

The role rename may emit `NOTICE: MD5 password cleared because of role rename`. That is expected and harmless **because the very next statement sets a new password** — do not skip it, and do not reorder it before the rename:

```bash
docker exec galangdana-postgres-1 psql -U fundforindonesia -d postgres -v ON_ERROR_STOP=1 -c \
  "ALTER ROLE fundforindonesia WITH PASSWORD '<NEW_DB_PASSWORD>';"
```

Note the `-U fundforindonesia` on that last one — the role no longer answers to the old name. Verify:

```bash
docker exec galangdana-postgres-1 psql -U fundforindonesia -d fundforindonesia -c "\l"
docker exec galangdana-postgres-1 psql -U fundforindonesia -d fundforindonesia -c "\du"
```

`\l` must list `fundforindonesia` owned by `fundforindonesia`, with no `galangdana` database remaining. `\du` must show exactly one role, `fundforindonesia`.

**Rollback for this step:** `ALTER ROLE fundforindonesia RENAME TO galangdana; ALTER DATABASE fundforindonesia RENAME TO galangdana; ALTER ROLE galangdana WITH PASSWORD 'galangdana';` then jump to Step 10's restart with the original `.env.production`.

- [ ] **Step 5: Stop the old compose project and copy the volumes**

The compose file now says `fundforindonesia`, so the old project must be addressed explicitly. `down` without `-v` **preserves volumes** — never add `-v` here:

```bash
cd /home/ubuntu/galangdana
docker compose --project-name galangdana down
docker ps --format '{{.Names}}' | grep galangdana   # expect no output
docker volume ls --format '{{.Name}}' | grep galangdana   # expect all three, still present
```

Copy each volume. This is a copy, not a move — the originals remain untouched as the rollback path:

```bash
for v in pgdata miniodata meilidata; do
  docker volume create "fundforindonesia_${v}"
  docker run --rm \
    -v "galangdana_${v}:/from:ro" \
    -v "fundforindonesia_${v}:/to" \
    alpine sh -c 'cd /from && cp -a . /to/'
done
```

Verify the copies match the originals in size (expected: pgdata ≈ 70 MB, miniodata ≈ 55 MB, meilidata ≈ 3.2 MB):

```bash
docker run --rm \
  -v galangdana_pgdata:/old_pg -v fundforindonesia_pgdata:/new_pg \
  -v galangdana_miniodata:/old_mi -v fundforindonesia_miniodata:/new_mi \
  -v galangdana_meilidata:/old_me -v fundforindonesia_meilidata:/new_me \
  alpine du -sh /old_pg /new_pg /old_mi /new_mi /old_me /new_me
```

Each old/new pair must match. **If any pair differs, stop.** Delete the mismatched `fundforindonesia_*` volume, re-run its copy, and re-verify. Do not proceed on a partial copy.

- [ ] **Step 6: Bring up the renamed project**

```bash
cd /home/ubuntu/galangdana
docker compose up -d
docker compose ps
```

Every service must reach `healthy`. `docker ps --format '{{.Names}}'` must now show `fundforindonesia-postgres-1`, `fundforindonesia-redis-1`, `fundforindonesia-minio-1`, `fundforindonesia-meilisearch-1`, `fundforindonesia-mailpit-1`, `fundforindonesia-imgproxy-1`.

Confirm the data came with it — these are the numbers from Step 1:

```bash
docker exec fundforindonesia-postgres-1 psql -U fundforindonesia -d fundforindonesia -tAc \
  "select 'campaigns='||count(*) from campaigns
   union all select 'donations='||count(*) from donations
   union all select 'users='||count(*) from users"
```

They must match Step 1 exactly. If any count is `0` or the tables do not exist, the new project picked up an empty volume — go to this task's rollback immediately.

Confirm MinIO kept its objects under the rotated root credentials — compare against the Step 1 snapshot you wrote down, **not** against any fixed number in this document (the object count, especially in `campaign-documents`, has been observed drifting):

```bash
docker run --rm --network host --entrypoint sh minio/mc -c \
  "mc alias set local http://localhost:9000 fundforindonesia '<NEW_MINIO_PASSWORD>' && \
   mc ls local && \
   mc ls --recursive --summarize local/campaign-media | tail -2 && \
   mc ls --recursive --summarize local/campaign-documents | tail -2"
```

`campaign-media`'s 8 objects (~532 KiB, real cover images) are the data whose loss would be irreversible; `campaign-documents` currently holds placeholder/stub objects (14–57 bytes each) rather than real KYC uploads, so an exact count match there is a sanity check on the migration mechanism, not a check against losing real donor documents.

Then update the two live brand rows (same window, database already open, backup already taken):

```bash
docker exec fundforindonesia-postgres-1 psql -U fundforindonesia -d fundforindonesia -v ON_ERROR_STOP=1 -c \
  "UPDATE campaigners SET display_name = 'FundForIndonesia Program Mitra'
     WHERE display_name = 'GalangDana Program Mitra';
   UPDATE campaigns SET title = 'Dana Zakat untuk Program Amil Mitra FundForIndonesia'
     WHERE title = 'Dana Zakat untuk Program Amil Mitra GalangDana';"
```

Each must report `UPDATE 1`. Then confirm nothing else in the ledger carries the old brand:

```bash
docker exec fundforindonesia-postgres-1 psql -U fundforindonesia -d fundforindonesia -tAc \
  "select count(*) from campaigns where title ilike '%galangdana%'
   union all select count(*) from campaigners where display_name ilike '%galangdana%'"
```

Both must be `0`.

- [ ] **Step 7: Repoint `.env.production` and `.env`**

In **both** `/home/ubuntu/galangdana/.env.production` and `/home/ubuntu/galangdana/.env`:

```bash
DATABASE_URL=postgres://fundforindonesia:<NEW_DB_PASSWORD>@localhost:55434/fundforindonesia
MEDIA_S3_ACCESS_KEY_ID=fundforindonesia
MEDIA_S3_SECRET_ACCESS_KEY=<NEW_MINIO_PASSWORD>
MEILISEARCH_API_KEY=<NEW_MEILI_KEY>
```

Also delete the now-dead `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_MEDIA`, `MEILI_URL`, `MEILI_MASTER_KEY` lines from both, matching Task 4 Step 1 — **except** keep the `MEILI_MASTER_KEY=<NEW_MEILI_KEY>` line that Step 2 added to `.env`, which compose genuinely reads. (`.env.production` needs no `MEILI_MASTER_KEY`; nothing reads it there.) Leave `MEDIA_S3_BUCKET=campaign-media` and `MEDIA_S3_PRIVATE_BUCKET=campaign-documents` alone.

Double-check no old credential survives in either file:

```bash
grep -n 'galangdana' /home/ubuntu/galangdana/.env /home/ubuntu/galangdana/.env.production
```

Expected: no output.

- [ ] **Step 8: Restart the application services — downtime ends**

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user start galangdana-api.service
sleep 3
systemctl --user start galangdana-web.service
systemctl --user status galangdana-api.service galangdana-web.service --no-pager
```

(Unit names are still the old ones — Task 6 renames them.)

- [ ] **Step 9: Acceptance gate — verify the whole stack end to end**

```bash
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
curl -sf 'https://api.fundforindonesia.org/campaigns?limit=3' | head -c 400; echo
curl -sf 'https://api.fundforindonesia.org/search?q=banjir' | head -c 300; echo
journalctl --user -u galangdana-api.service -n 50 --no-pager | grep -i 'error\|econnrefused\|password'
```

Then, in a browser, walk the paths that exercise each renamed dependency:

1. https://fundforindonesia.org/ — campaign cards render **with cover images** (proves Postgres + MinIO + imgproxy signing).
2. https://fundforindonesia.org/search?q=banjir — results appear (proves the rotated Meilisearch key).
3. Open any campaign detail page — the "Dana Zakat" campaign must show its **new** title.
4. Re-run the `campaign-documents` object-count check from Step 6 and confirm it still matches the Step 1 snapshot. **Do not rely on an admin-UI document preview as this check** — as of 2026-09-05 this bucket holds placeholder/stub objects of 14–57 bytes each, not real renderable KYC documents, so a preview will not load correctly regardless of whether the credential rotation succeeded. If this bucket later holds real KYC uploads, upgrade this check to an actual admin-UI document preview load.

Only when all four pass is this task complete.

**Rollback (any point after Step 4):**
1. `systemctl --user stop galangdana-web.service galangdana-api.service`
2. `docker compose --project-name fundforindonesia down` (no `-v`)
3. `docker exec` into a temporary postgres against `galangdana_pgdata`, or simply restore the ORIGINAL project: `git -C /home/ubuntu/galangdana stash push docker-compose.yml` is not available (deploy resets it) — instead run `docker compose --project-name galangdana --file <(sed 's/^name: fundforindonesia/name: galangdana/' docker-compose.yml) up -d`, which starts the untouched original volumes.
4. Reverse the SQL: `ALTER ROLE fundforindonesia RENAME TO galangdana; ALTER DATABASE fundforindonesia RENAME TO galangdana; ALTER ROLE galangdana WITH PASSWORD 'galangdana';` plus the two `UPDATE` statements in reverse.
5. Restore `.env`/`.env.production` to `DATABASE_URL=postgres://galangdana:galangdana@localhost:55434/galangdana`, `MEDIA_S3_ACCESS_KEY_ID=galangdana`, `MEDIA_S3_SECRET_ACCESS_KEY=galangdana-dev-secret`, `MEILISEARCH_API_KEY=galangdana-dev-master-key`.
6. `systemctl --user start galangdana-api.service galangdana-web.service`, re-run Step 9's gate.
7. Revert Task 4's merge commit so the repo matches the restored host state.

The `galangdana_*` volumes are never deleted by this task, which is what makes this rollback safe. Task 11 deletes them only after a soak period.

---

## Task 6: Rename the systemd units

**Files:**
- Host: `~/.config/systemd/user/fundforindonesia-api.service` (new), `~/.config/systemd/user/fundforindonesia-web.service` (new), removal of the two `galangdana-*` units
- Modify: `.github/workflows/ci.yml` (the two `systemctl --user restart` lines)

**Interfaces:**
- Consumes: Task 5's completed host migration.
- Produces: units named `fundforindonesia-api.service` / `fundforindonesia-web.service`, and a CD deploy job that restarts them by their new names.

**Expected downtime: a few seconds** (one stop/start cycle). The new units must exist and be running *before* the workflow change merges, or the deploy that ships that change fails at its restart step with the build already swapped in.

`WorkingDirectory=` and `EnvironmentFile=` keep the `/home/ubuntu/galangdana` path — the directory rename is out of scope.

- [ ] **Step 1: Create the two new unit files**

`~/.config/systemd/user/fundforindonesia-api.service`:

```ini
[Unit]
Description=FundForIndonesia API (Elysia/Bun)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/galangdana/apps/api
EnvironmentFile=/home/ubuntu/galangdana/.env.production
ExecStart=/home/ubuntu/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

`~/.config/systemd/user/fundforindonesia-web.service` — note `After=` now names the renamed API unit:

```ini
[Unit]
Description=FundForIndonesia Web (SvelteKit adapter-node)
After=network.target fundforindonesia-api.service

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/galangdana/apps/web
EnvironmentFile=/home/ubuntu/galangdana/.env.production
ExecStart=/usr/bin/node build/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Swap them in**

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user daemon-reload
systemctl --user disable --now galangdana-web.service galangdana-api.service
systemctl --user enable --now fundforindonesia-api.service
sleep 3
systemctl --user enable --now fundforindonesia-web.service
systemctl --user status fundforindonesia-api.service fundforindonesia-web.service --no-pager
```

Both must be `active (running)`.

- [ ] **Step 3: Acceptance gate before touching CI**

```bash
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
systemctl --user list-units --type=service --all --no-pager | grep -i 'galangdana\|fundforindonesia'
```

Both `200`; only the two `fundforindonesia-*` units should be listed as loaded. **Do not proceed to Step 4 until this passes** — merging the CI change against non-running new units breaks the next deploy.

- [ ] **Step 4: Remove the old unit files**

Only after Step 3 passes:

```bash
rm ~/.config/systemd/user/galangdana-api.service ~/.config/systemd/user/galangdana-web.service
systemctl --user daemon-reload
ls ~/.config/systemd/user/
```

- [ ] **Step 5: Update the deploy job's restart step**

In `.github/workflows/ci.yml`, the `Restart services` step. Update both unit names and the comment above it that names the old units (there are two such comments — one on the `Update the live checkout` step and one on `Restart services`; update both so the file does not describe units that no longer exist):

```yaml
      - name: Restart services
        run: |
          export XDG_RUNTIME_DIR=/run/user/$(id -u)
          systemctl --user restart fundforindonesia-api.service
          systemctl --user restart fundforindonesia-web.service
```

Also update the `Run database migrations` step's comment, which references `galangdana-api.service / galangdana-web.service`'s `EnvironmentFile=`.

Leave `runs-on:` and `concurrency.group` alone — that is Task 7.

- [ ] **Step 6: Commit, PR, merge, verify**

```bash
git checkout -b rename/systemd-units
git add .github/workflows/ci.yml
git commit -m "ci: restart the renamed fundforindonesia-{api,web} systemd units"
git push -u origin rename/systemd-units
gh pr create --title "Point the deploy job at the renamed systemd units" --body "See plan Task 6. New units are already created, enabled, and serving."
```

After merge, watch the deploy job's `Restart services` step succeed, then re-run Step 3's gate.

**Rollback:** recreate the two `galangdana-*.service` files with their original content, `daemon-reload`, `disable --now` the new pair, `enable --now` the old pair, and revert the CI merge commit.

---

## Task 7: Rename the runner label and the deploy concurrency group

**Files:**
- GitHub repository settings (Actions → Runners)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 6's merged workflow.
- Produces: `runs-on: [self-hosted, fundforindonesia-deploy]` and `concurrency.group: fundforindonesia-production-deploy`.

**Decision: rename the label, not the runner.** Verified from `/home/ubuntu/actions-runner-galangdana/.runner`, the runner is registered as `galangdana-host-runner` against `https://github.com/andrianm28/galangdana`, and `/home/ubuntu/actions-runner-galangdana/.service` shows its installed system unit is `actions.runner.andrianm28-galangdana.galangdana-host-runner.service`.

- **Labels are mutable from the GitHub UI** with no re-registration, no token, and no service restart. They can be added and removed while the runner is online.
- **The runner's *name* is fixed at `config.sh` time.** Changing it requires `svc.sh uninstall` (sudo), `config.sh remove` with a fresh removal token, `config.sh --name ...` with a fresh registration token, and `svc.sh install/start` (sudo) — which also rewrites the root-owned system unit whose name embeds both the repo slug and the runner name, and which would be re-derived from the repo slug that Task 12's open question has not settled.

The runner name is internal, invisible to every workflow, and appears in no code. Re-registering it buys nothing and risks leaving CD with no runner. **Out of scope; the label rename delivers the entire user-visible benefit.**

- [ ] **Step 1: Add the new label additively**

In the GitHub UI: repository → Settings → Actions → Runners → `galangdana-host-runner` → Labels → add `fundforindonesia-deploy`. **Do not remove `galangdana-deploy` yet.** The runner now carries both, so the currently-merged workflow keeps matching.

Confirm on the runner page that both labels are listed and the runner shows **Idle** (not Offline).

- [ ] **Step 2: Switch the workflow to the new label**

In `.github/workflows/ci.yml`'s `deploy` job:

```yaml
    runs-on: [self-hosted, fundforindonesia-deploy]
    concurrency:
      group: fundforindonesia-production-deploy
      cancel-in-progress: false
```

Keep the existing explanatory comments on both keys. Leave the `if:` guard, the job key `deploy`, and `needs: test` untouched.

- [ ] **Step 3: Commit, PR, merge**

```bash
git checkout -b rename/runner-label
git add .github/workflows/ci.yml
git commit -m "ci: target the fundforindonesia-deploy runner label"
git push -u origin rename/runner-label
gh pr create --title "Target the fundforindonesia-deploy runner label" --body "See plan Task 7. Label already added additively; the runner carries both during the switch."
```

- [ ] **Step 4: Verify the deploy job actually picked up**

Watch the Actions run for the merge. The `deploy` job must move from queued to running within seconds. **If it sits queued for more than ~60 seconds, the label did not apply** — revert the merge immediately (a stuck deploy job holds the `concurrency` group with `cancel-in-progress: false`, blocking every subsequent deploy) and re-check Step 1.

```bash
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
```

- [ ] **Step 5: Remove the old label**

Only after Step 4's deploy has completed successfully: GitHub UI → the runner → remove `galangdana-deploy`. Nothing references it any more; confirm:

```bash
grep -rn 'galangdana-deploy\|galangdana-production-deploy' .github/   # expect no output
```

**Rollback:** re-add the `galangdana-deploy` label in the UI and revert the merge commit.

---

## Task 8: Rename the backup cron entry and backup directory (requires sudo)

**Files:**
- Host: `/etc/cron.d/galangdana-pg-backup` → `/etc/cron.d/fundforindonesia-pg-backup`, `/home/ubuntu/galangdana-backups` → `/home/ubuntu/fundforindonesia-backups`

**Interfaces:**
- Consumes: Task 4's rewritten `scripts/backup-db.sh` (defaults already `fundforindonesia-postgres-1` / `fundforindonesia` / `fundforindonesia-backups`) and Task 5's renamed container.
- Produces: a nightly backup that runs green against the renamed stack, with existing dumps preserved.

`crontab -l` is unavailable to the `ubuntu` user on this host (`/etc/cron.allow` denies it). The backup is a **system** cron drop-in at `/etc/cron.d/galangdana-pg-backup`, root-owned, running as user `ubuntu`. Editing it needs sudo.

- [ ] **Step 1: Move the existing backups, preserving them**

```bash
mv /home/ubuntu/galangdana-backups /home/ubuntu/fundforindonesia-backups
ls -la /home/ubuntu/fundforindonesia-backups/
```

Existing dumps keep their `galangdana-<ts>.sql.gz` filenames. **Leave them named as they are** — they are dumps of a database that was called `galangdana`, and the script's retention `find -name 'fundforindonesia-*.sql.gz'` deliberately will not prune them. Task 11 handles them after the soak period.

- [ ] **Step 2: Write the renamed cron drop-in**

```bash
sudo tee /etc/cron.d/fundforindonesia-pg-backup > /dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
0 3 * * * ubuntu /home/ubuntu/galangdana/scripts/backup-db.sh >> /home/ubuntu/fundforindonesia-backups/backup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/fundforindonesia-pg-backup
sudo rm /etc/cron.d/galangdana-pg-backup
ls -la /etc/cron.d/
```

The script path stays `/home/ubuntu/galangdana/scripts/backup-db.sh` — directory rename is out of scope.

- [ ] **Step 3: Acceptance gate — run the backup for real, now**

Do not wait for 03:00 to discover it is broken:

```bash
/home/ubuntu/galangdana/scripts/backup-db.sh
ls -la /home/ubuntu/fundforindonesia-backups/
latest=$(ls -t /home/ubuntu/fundforindonesia-backups/fundforindonesia-*.sql.gz | head -1)
gzip -t "$latest" && echo "gzip OK"
zcat "$latest" | grep -c 'CREATE TABLE public.donations'
```

A `fundforindonesia-<ts>.sql.gz` must appear, pass the gzip integrity test, and contain real schema. This runs with no env overrides, proving the script's new defaults line up with the renamed container, role, and database.

**Rollback:** `mv /home/ubuntu/fundforindonesia-backups /home/ubuntu/galangdana-backups`, restore `/etc/cron.d/galangdana-pg-backup` with the original single line, `sudo rm /etc/cron.d/fundforindonesia-pg-backup`.

---

## Task 9: Disable the legacy `galangdana.adri.web.id` nginx vhosts — these are live aliases, not dead configs (requires sudo)

**Files:**
- Host: `/etc/nginx/sites-enabled/galangdana.adri.web.id.conf`, `/etc/nginx/sites-enabled/api.galangdana.adri.web.id.conf` (symlinks), and their targets in `sites-available/`

**Interfaces:**
- Consumes: nothing.
- Produces: nginx serving only the current `fundforindonesia.org` vhosts.

**Corrected from an earlier draft of this plan, which got two things wrong here.** `/etc/nginx/sites-enabled/` currently contains **both** the current `fundforindonesia.org.conf` / `api.fundforindonesia.org.conf` and the pre-rebrand `galangdana.adri.web.id.conf` / `api.galangdana.adri.web.id.conf`, all four enabled — plus three vhosts belonging to unrelated projects on this host (`dev.makam.co.id.conf`, `makam.co.id.conf`, `opencode-yiem.adri.web.id.conf`), which this task does not touch.

First, these configs are **not** unreadable. An earlier draft assumed mode `640` root-owned files couldn't be read while writing this plan — that's wrong; `sudo` bypasses file-permission checks by design, and `sudo cat` reads them fine (this task already uses `sudo` in the very next step). Having now actually read them: **`galangdana.adri.web.id.conf` proxies to `127.0.0.1:3002` and `api.galangdana.adri.web.id.conf` proxies to `127.0.0.1:3001` — the identical upstreams as the live `fundforindonesia.org.conf` / `api.fundforindonesia.org.conf`.** These are not dead legacy vhosts sitting around from before the rebrand; they are currently-functional public aliases of the live production app, right now. Disabling them (as this task does) takes two working public hostnames offline — it is not simply removing unused config, whatever "retire" suggests. Both already contain certbot's standard `:80 → 301 https://$host` block and a bare `return 404` for everything else; **neither currently redirects visitors to `fundforindonesia.org`.** If anyone still has one of these old URLs bookmarked or linked, after this task they get a 404, not a redirect. See the corrected Open Question below, which this evidence now answers with real information instead of a guess.

- [ ] **Step 1: Re-confirm no `default_server` is enabled, with a corrected command**

The two legacy configs were already read above. Re-run this check yourself immediately before disabling anything, since state can change between planning and execution:

```bash
sudo cat /etc/nginx/sites-available/galangdana.adri.web.id.conf
sudo cat /etc/nginx/sites-available/api.galangdana.adri.web.id.conf
sudo grep -Rn 'default_server' /etc/nginx/sites-enabled/
```

**Use `-R` (capital), not `-r`.** Every vhost file in `sites-enabled/` is a symlink; GNU `grep -r` does not follow symlinks encountered during directory recursion and silently returns empty regardless of the real content — an earlier draft of this plan specified `-r` here, which made this entire safety gate a no-op. Verified directly on this host: `grep -rln 'server_name' sites-enabled/` finds only the one file in that directory that isn't a symlink, while `grep -Rln 'server_name' sites-enabled/` correctly finds all of them. With the corrected `-R` command, this host currently shows no `default_server` enabled in `sites-enabled/` — the only `default_server` on the system lives in `sites-available/default`, which is not symlinked into `sites-enabled/` and is therefore inactive. If your own re-run disagrees, **stop and hand this decision to the user** rather than guessing — note it and skip to Task 10.

- [ ] **Step 2: Disable, do not delete**

The user has already confirmed (2026-09-05, see Open Questions) that taking these two currently-working hostnames offline — rather than 301-redirecting them — is intended, given the corrected framing above. This is not neutral cleanup; it is a deliberate, accepted tradeoff.

```bash
sudo rm /etc/nginx/sites-enabled/galangdana.adri.web.id.conf
sudo rm /etc/nginx/sites-enabled/api.galangdana.adri.web.id.conf
sudo nginx -t
```

Only the symlinks are removed; `sites-available/` keeps the originals, so re-enabling is one `ln -s`. `nginx -t` must report `syntax is ok` / `test is successful`. **Do not reload if it does not.**

- [ ] **Step 3: Reload and verify the live domains are unaffected**

```bash
sudo systemctl reload nginx
curl -sf -o /dev/null -w "api=%{http_code}\n" https://api.fundforindonesia.org/healthz
curl -sf -o /dev/null -w "web=%{http_code}\n" https://fundforindonesia.org/
sudo systemctl status nginx --no-pager | head -5
```

Both `200` and nginx `active (running)`.

There is a certbot renewal entry at `/etc/cron.d/certbot`. If the legacy domains had their own certificates, renewal for them will now fail (the vhost no longer answers). That is expected for a retired domain, but note it so a failed-renewal alert later is not mistaken for a problem with `fundforindonesia.org`. Confirm the live certs are unaffected:

```bash
sudo certbot certificates 2>/dev/null | grep -A2 'fundforindonesia'
```

**Rollback:** `sudo ln -s /etc/nginx/sites-available/galangdana.adri.web.id.conf /etc/nginx/sites-enabled/` (and the api one), `sudo nginx -t && sudo systemctl reload nginx`.

---

## Task 10: Documentation — decide and record what stays

**Files:**
- Modify: `docs/research/effortx-recommendations.md` (6 occurrences)
- Leave unchanged: `docs/superpowers/plans/*.md` (11 historical files — this rename plan itself is the 12th file in the directory and necessarily mentions both names throughout, as it is the bridge document)

**Interfaces:**
- Consumes: nothing.
- Produces: a written record of the naming decision so a future reader does not "fix" the historical plans.

**Decision: the ten historical plan documents under `docs/superpowers/plans/` keep saying "galangdana", and are not rewritten.**

Reasoning, stated so it is not re-litigated:

1. They are a **record of work already done**, describing a codebase that genuinely was called `galangdana` at the time. Rewriting them would make them describe commits that do not exist.
2. They quote **exact code snippets and exact commit messages** from merged commits (e.g. `feat(db): add payments.redirect_url...`, import blocks reading `@galangdana/db`). Rewriting the prose while the referenced commits still say the old name makes the documents actively misleading — worse than leaving them accurate-as-of-their-date.
3. Several contain **verification transcripts** ("confirmed via `docker compose exec minio mc ...`", recorded row counts, recorded test pass/fail baselines) whose value is that they are a faithful record of what was actually run. Editing them destroys that.
4. They are not operational documents. Nothing reads them at runtime, nothing deploys from them, and a reader arriving at a 2026-08-29 plan already understands they are reading history.

**This plan itself** (`2026-09-05-rename-galangdana-to-fundforindonesia.md`) necessarily contains both names throughout, by nature. It is the bridge document.

- [ ] **Step 1: Update `docs/research/effortx-recommendations.md`**

This one is different: it is **forward-looking design input** for phases not yet built (per the project's own memory index: "consult before planning Phases 5/6/7/9"), not a record of completed work. A future planner reading it should see the current brand name. Read its 6 occurrences and update each **in context** — some may be package references (`@galangdana/...` → `@fundforindonesia/...`), some prose brand mentions (`GalangDana` → `FundForIndonesia`):

```bash
cd /home/ubuntu/galangdana
grep -n 'galangdana\|GalangDana' docs/research/effortx-recommendations.md
```

Update each by hand. Do not `sed` this file — check whether any occurrence is quoting a competitor's naming or a historical comparison, in which case leave it.

- [ ] **Step 2: Record the decision where it will actually be seen**

Append to this plan's own Self-Review Notes (below) is not enough — a future contributor greps the repo, not the plans directory. Add a short note at the top of `docs/superpowers/plans/README.md` if one exists; if it does not, create it:

```markdown
# Implementation plans

Historical record. Plans dated before 2026-09-05 describe this codebase when it
was named "galangdana" (npm scope `@galangdana/*`, database `galangdana`). The
rebrand to FundForIndonesia is
`2026-09-05-rename-galangdana-to-fundforindonesia.md`. Earlier plans are
deliberately NOT rewritten -- they quote real commit messages and real
verification transcripts from the period, and editing them would make them
describe commits that do not exist.
```

- [ ] **Step 3: Verify, commit, PR, merge**

```bash
cd /home/ubuntu/galangdana
bun run lint
grep -rn 'galangdana' docs/research/   # expect no output
git checkout -b rename/docs
git add docs/
git commit -m "docs: update forward-looking research doc to FundForIndonesia; record why historical plans keep the old name"
git push -u origin rename/docs
gh pr create --title "Update forward-looking docs; keep historical plans as-is" --body "See plan Task 10."
```

- [ ] **Step 4: Acceptance gate**

Both health checks `200` after the deploy (a docs-only change still triggers a full deploy on this pipeline).

---

## Task 11: Soak, then clean up (execute no earlier than 30 days after Task 5)

**Files:**
- Host: the three `galangdana_*` Docker volumes, the pre-rename backup dumps

**Interfaces:**
- Consumes: a full month (30 days) of the renamed stack running without incident.
- Produces: reclaimed disk (~131 MB of volumes) and a tidy backup directory.

**Do not run this task on the same day as Task 5.** The `galangdana_*` volumes are the rollback path for the entire host migration; a problem that only shows up after weeks of real donations (a subtly wrong credential, a Meilisearch index that silently stopped updating, an issue that only surfaces during month-end reconciliation) is exactly what they exist for. **Soak period decided 2026-09-05: 30 days, not the 7 days an earlier draft of this plan proposed** — the three volumes together total only ~131 MB, so there is essentially no cost to waiting longer, and this data is a real donation ledger plus KYC storage, not something to rush. 30 days also comfortably spans a full month-end financial reconciliation cycle, which the foundation is expected to run.

- [ ] **Step 1: Confirm a full month of clean operation**

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
journalctl --user -u fundforindonesia-api.service --since '30 days ago' --no-pager \
  | grep -ci 'error\|econnrefused\|authentication failed'
ls -la /home/ubuntu/fundforindonesia-backups/
docker compose ps
```

**Note on journald retention:** whether journald actually retains 30 days of logs on this host was not verified (depends on its own vacuum/disk-usage settings, untouched by this plan). If the `--since '30 days ago'` query returns suspiciously few lines relative to the API's normal request volume, check `journalctl --disk-usage` and journald's retention config before concluding "zero errors" — it may mean "no logs that far back," which is a different thing.

There must be 30 consecutive nightly `fundforindonesia-*.sql.gz` dumps, all services healthy, and no recurring connection/auth errors. **If any nightly dump is missing, stop** — investigate before deleting the rollback path. (This is why Task 4 Step 7 set `RETENTION_DAYS=35` rather than the original 14 — a 30-day soak needs at least 30 days of dumps to still exist when you check.)

- [ ] **Step 2: Confirm the old volumes are genuinely unused**

```bash
docker ps -a --format '{{.Names}}\t{{.Mounts}}' | grep galangdana_
docker volume ls --format '{{.Name}}' | grep galangdana
```

The first command must return nothing (no container, running or stopped, references them).

- [ ] **Step 3: Remove the old volumes**

```bash
docker volume rm galangdana_pgdata galangdana_miniodata galangdana_meilidata
docker volume ls --format '{{.Name}}' | grep -c fundforindonesia   # expect 3
```

- [ ] **Step 4: Archive the pre-rename dumps**

The old `galangdana-*.sql.gz` dumps in `/home/ubuntu/fundforindonesia-backups/` are outside the script's retention glob and will accumulate forever. Keep the single dump taken in Task 5 Step 1 (the last known-good pre-rename state) and remove the rest:

```bash
ls -t /home/ubuntu/fundforindonesia-backups/galangdana-*.sql.gz
# keep the newest; delete the others explicitly, by name, after reading the list
```

Delete by explicit filename after reading the listing — no glob-delete in a directory holding the donation ledger's only offline copies.

- [ ] **Step 5: Final repo-wide sweep**

```bash
cd /home/ubuntu/galangdana
grep -rn 'galangdana' --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=.worktrees --exclude-dir=.claude --exclude=bun.lock . \
  | grep -v '^./docs/superpowers/plans/'
```

Expected remaining hits, and nothing else:
- `docs/superpowers/plans/README.md` — the deliberate historical note (excluded by the filter above; verify separately).
- `docker-compose.yml` — the explanatory comment about the volume migration.
- Path literals `/home/ubuntu/galangdana` in `ci.yml` (5 `working-directory:` keys), `scripts/backup-db.sh` (the crontab example comment), and this plan. **These are correct** — the directory rename is out of scope.

Confirm no *name* (as opposed to *path*) survives:

```bash
grep -rn 'galangdana' --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=.worktrees --exclude-dir=.claude --exclude=bun.lock . \
  | grep -v '^./docs/superpowers/plans/' \
  | grep -v '/home/ubuntu/galangdana'
```

- [ ] **Step 6: Final acceptance gate**

Both health checks `200`; homepage renders with images; search returns results; the `campaign-documents` object count still matches its last known snapshot (an admin-UI document preview is not a valid check here — see Task 5 Step 9's note on why this bucket currently holds placeholder data, not renderable documents).

---

## Open Questions (for the user — deliberately not decided here)

- [x] **Should the GitHub repository be renamed from `andrianm28/galangdana` to `andrianm28/fundforindonesia`? — DECIDED 2026-09-05: yes.**

  The user confirmed the rename. Per this plan's own reasoning below, it is **not** bolted onto this plan's Tasks 1–11 — it executes as its own short follow-up plan, **after Task 11 completes and its 30-day soak has passed**, so it doesn't add a second live-URL change on top of the database/volume/credential migration this plan already carries. That follow-up plan should be written closer to when Task 11 actually finishes (state — runner registration, `.env` files, CI status — may have shifted by then), and must at minimum address the four facts already verified below.

  What was verified: `git remote -v` in `/home/ubuntu/galangdana` points at `https://github.com/andrianm28/galangdana.git`, and the self-hosted runner's `.runner` file records `"gitHubUrl": "https://github.com/andrianm28/galangdana"` with its installed system unit named `actions.runner.andrianm28-galangdana.galangdana-host-runner.service`.

  What renaming would involve:
  - GitHub serves permanent redirects for the old repo URL, so `git remote` keeps working for existing clones — but the live checkout's remote should still be updated explicitly (`git remote set-url origin ...`) rather than relying on a redirect that the deploy job's `git fetch origin master` depends on every single deploy.
  - Runner registration is keyed by repository **ID**, not name, so the runner survives a rename — but its `.runner` file and its root-owned system unit name would both permanently record the stale slug, and any future `svc.sh`/`config.sh` operation would re-derive from the new one. Cosmetic, but confusing.
  - Every external reference (bookmarks, any CI badge, anything the foundation has documented) changes.
  - Branch protection, secrets, and the required status checks all survive a rename.

  If the answer is yes, it should be its own short plan executed after Task 11, not bolted onto this one.

- [x] **Should the pre-rebrand `galangdana.adri.web.id` / `api.galangdana.adri.web.id` domains be kept serving a redirect to `fundforindonesia.org`, rather than simply disabled (Task 9)? — DECIDED 2026-09-05: disable, do not redirect.**

  The user confirmed disabling (not redirecting) after seeing the corrected evidence — these domains currently proxy to the exact same upstreams as the live domains (`:3002` web, `:3001` api), i.e. they are live, working aliases right now, not dead hosts. Disabling them per Task 9 as written turns two currently-functional public hostnames into a bare 404 rather than a 301 to `fundforindonesia.org`. That tradeoff is accepted. Task 9 as written already implements this decision (disable, do not delete the underlying config) — no task changes needed as a result of this decision.

- [x] **Is a 7-day soak (Task 11) the right window before deleting the `galangdana_*` volumes? — DECIDED 2026-09-05: no, extend to 30 days.**

  An earlier draft of this plan proposed 7 days (a full weekly donation cycle, seven nightly backups). The user agreed to extend this to **30 days** instead, on the recommendation that: the three volumes total only ~131 MB combined, so waiting longer costs essentially nothing; this is a real donation ledger plus KYC storage, not disposable cache, and the migration itself combines three simultaneous changes (database rename, three credential rotations, volume migration) with a larger-than-usual combined risk surface; and 30 days comfortably spans a full month-end financial reconciliation cycle, which a donation foundation is expected to run. Task 11 and Task 4 Step 7 (`RETENTION_DAYS`) have both been updated to reflect 30 days.

---

## Self-Review Notes (for the controller, not a task)

- **Spec coverage — all seven requested areas are addressed:**
  1. *Code-only renames* → Tasks 1–2. Package names in all ten `package.json` files, all 159 import specifiers across 105 files (145 across 95 tracked-source files, excluding gitignored `.svelte-kit/types/` build artifacts), `app.css`, and the lockfile, as one atomic PR that rides the existing auto-deploy with zero manual coordination. Verified and stated: `biome.json`, `bunfig.toml`, and every `tsconfig` need **no** change, and there are **no** TypeScript `paths` mappings in this repo at all.
  2. *Environment/config renames needing coordination* → Tasks 3–4. The lead's question — do Compose *service* names need to change? — is answered explicitly **no**, with reasoning, in "Deliberately NOT renamed"; only the top-level `name:` key and the three brand-bearing credential literals change. Task 3 exists because a real hidden coupling was found: production search depends on a hardcoded `?? "galangdana-dev-master-key"` fallback because `.env.production` defines `MEILI_MASTER_KEY` (read by nothing) instead of `MEILISEARCH_API_KEY` (read by the client). Renaming the fallback without Task 3 first would have silently broken production search on deploy.
  3. *Database rename* → Task 5, with its own maintenance-window sequence, the manual `scripts/backup-db.sh` run plus dump verification before the destructive step, `ALTER DATABASE`/`ALTER ROLE RENAME TO`/`ALTER ROLE ... PASSWORD` in a deliberate order, row-count verification against a pre-recorded snapshot, and a complete rollback. The `POSTGRES_USER`/`POSTGRES_DB`-only-apply-at-initdb trap and the `ALTER ROLE RENAME` password-clearing trap are both called out in Global Constraints.
  4. *S3/MinIO bucket rename* → **investigated and found unnecessary, with evidence.** The live MinIO holds exactly `campaign-media` and `campaign-documents`; no bucket contains the brand name; `S3_BUCKET_MEDIA=galangdana-media` names a bucket that has never existed and is read by zero code. There is therefore no create-copy-repoint-verify-delete sequence to write — inventing one would have been busywork against a nonexistent bucket. The genuinely brand-bearing MinIO values (root user/password) are rotated in Task 5 Step 6, with object-count verification against a fresh Step-1 snapshot (never a fixed number — the count drifts) rather than a browser document-preview check, since `campaign-documents` currently holds placeholder/stub data (3845 objects, 14–57 bytes each, verified 2026-09-05) rather than real KYC documents.
  5. *systemd service renames* → Task 6, at `~/.config/systemd/user/`, in the create → `daemon-reload` → `enable --now` new → `disable --now` old → remove order, with the CI deploy job's two `systemctl --user restart` lines updated in a **separate, later** PR so the new units are provably running before anything depends on their names.
  6. *Runner name and labels* → Task 7. Judged: rename the **label** (UI-only, additive, zero-downtime, no re-registration) and **not** the runner name (requires sudo `svc.sh uninstall`/`install` plus fresh removal and registration tokens, rewrites a root-owned system unit, and is invisible to every workflow). The full re-registration cost is documented so the decision can be revisited. The queued-job-blocks-the-concurrency-group failure mode is called out with its detection window and immediate revert.
  7. *Documentation and stray references* → Task 10, with the decision made and justified in four numbered points: historical plans stay, the forward-looking research doc is updated, and the reasoning is written into `docs/superpowers/plans/README.md` so it is not silently "fixed" later.

- **Placeholder scan:** no `TODO`, `FIXME`, `XXX`, `handle appropriately`, `as needed`, `etc.`-as-instruction, or `/path/to/...` appears in any task. Every path is absolute and real; every command is runnable as written. The four angle-bracket tokens — `<NEW_DB_PASSWORD>`, `<NEW_MINIO_PASSWORD>`, `<NEW_MEILI_KEY>`, and the `<ts>` in backup filenames — are **not** unresolved placeholders: the first three are secrets generated by a specific command in Task 5 Step 2 and deliberately never written into this document (the repo is public), and `<ts>` is a timestamp the backup script generates. Global Constraints states this explicitly so a reviewer does not flag them.

- **Name and path consistency:** every value is fixed in the Final Names table and used identically in every task — scope `@fundforindonesia/*`; root package `fundforindonesia`; database, role, and MinIO root user all `fundforindonesia`; compose project `fundforindonesia` (hence volumes `fundforindonesia_{pgdata,miniodata,meilidata}` and containers `fundforindonesia-*-1`); units `fundforindonesia-api.service` / `fundforindonesia-web.service`; runner label `fundforindonesia-deploy`; concurrency group `fundforindonesia-production-deploy`; cron `/etc/cron.d/fundforindonesia-pg-backup`; backups `/home/ubuntu/fundforindonesia-backups/fundforindonesia-<ts>.sql.gz`; wordmark `FundForIndonesia`. Nothing is left as a choice for the executor. Two things are intentionally *inconsistent* with the rename and marked as such wherever they appear: the path `/home/ubuntu/galangdana` (out of scope) and the buckets `campaign-media` / `campaign-documents` (never carried the brand).

- **Three traps a careless execution would hit, each defused by a specific step:** (a) `docker compose up` after the `name:` change but before the volume copy silently creates empty volumes and the database appears gone — Task 4 Step 9 forbids bare compose commands in that window, Task 5 Step 5 uses `--project-name galangdana` explicitly, and the copy is verified size-for-size before Step 6; (b) a case-insensitive global replace corrupts the Indonesian prose `"Galang Dana untuk Kebaikan"` — every substitution in this plan is bounded to `@galangdana/` or the exact token `GalangDana`, and Task 2 Step 5 asserts that file does not appear; (c) renaming the `test` job key permanently blocks every future PR through branch protection's required checks — stated in Global Constraints and re-asserted with a grep in Task 4 Step 4.

- **Decided by the user, 2026-09-05 (see Open Questions for full reasoning):** the GitHub repository rename (yes — as its own follow-up plan after Task 11's soak), the retired `*.adri.web.id` domains (disable, do not redirect), and the volume-deletion soak window (30 days, not the 7 originally proposed — `RETENTION_DAYS` in Task 4 Step 7 was bumped from 14 to 35 to match).
