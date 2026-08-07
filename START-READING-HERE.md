# Start Reading Here

You are picking up **SpendWise** — a secure, offline-first personal finance app for
Web, iOS and Android from one codebase. This file exists so you can be useful
within ten minutes without reading everything.

Read this file, then §0 and §20 of [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
That is enough to start. Read the rest of the architecture doc when you touch
the area it covers, not before.

---

## 1. Orientation in sixty seconds

| Question | Answer |
|---|---|
| What is it? | Personal finance app. Track spending, know what is safe to spend today. |
| Who for? | UK users. **10,000+ daily active** is the design target. |
| Killer constraint | Works with **no internet**. The local database is the source of truth; the server reconciles. |
| Budget | **One** DigitalOcean droplet + Cloudflare free tier. ~$78/mo at launch. |
| Priority order | Security → Performance → Usability → Developer experience. |
| Branch | Work on `development`. `main` is the published prototype. |

**The one idea that explains most decisions:** the client owns its data. A write
lands in local SQLite/IndexedDB and returns *before* the network is considered.
This is why a single droplet is defensible — request volume tracks *sync events*,
not screen views — and why the sync engine is the highest-risk component here.

---

## 2. Where everything lives

```
START-READING-HERE.md      ← you are here
progress.md                ← what is done, what is next. Update it when you finish work.
docs/
  ARCHITECTURE.md          ← the blueprint. 20 sections. Authoritative.
  BRIEF.md                 ← the original requirements from the project owner.
prototype/                 ← the original single-file HTML prototype. STILL THE LIVE DEMO.
apps/
  server/                  ← NestJS API
    migrations/            ← SQL. Run in numeric order. 001 → 002 → 003.
    scripts/rls-gate.sh    ← security release gate. Must pass before shipping.
    src/auth/              ← tokens, identity, OIDC, OTP, guard
    src/sync/              ← the sync engine (server half)
    src/db/                ← Postgres pool + tenant context
    src/audit/             ← append-only audit log
  client/                  ← Ionic/Capacitor + React + Vite
    src/core/db/           ← StorageAdapter: one interface, swappable engines
    src/core/sync/         ← the sync engine (client half)
    src/core/store.ts      ← Zustand, as a cache over the adapter
    src/features/          ← vertical slices
    src/design-system/     ← tokens, icons, gauge geometry
libs/
  shared-types/            ← zod schemas + currency + UUIDv7. BOTH ends import this.
```

---

## 3. Run it

```bash
corepack enable pnpm          # Node ≥20 required
pnpm install
pnpm -r build                 # topological: shared-types first
pnpm -r test                  # 197 tests
pnpm -r typecheck
```

**Database and Redis are optional for unit tests** — the integration suites skip
themselves when nothing is listening, and `pnpm test` stays green on a bare
checkout. To run them for real:

```bash
# Postgres on a throwaway port so your own instance is untouched
initdb -D /tmp/swpg -U postgres --auth=trust
pg_ctl -D /tmp/swpg -o "-p 55432" -l /tmp/swpg.log -w start
redis-server --port 56379 --daemonize yes --save '' --appendonly no

PGPORT=55432 REDIS_TEST_PORT=56379 pnpm -r test
cd apps/server && PGPORT=55432 ./scripts/rls-gate.sh
```

Server: `cd apps/server && pnpm dev`. Client: `cd apps/client && pnpm dev`.

---

## 4. Rules that are not negotiable

These are load-bearing. Breaking one causes a bug that is expensive or invisible.

1. **Money is integer minor units. Never a float.** And never hardcode `/100` —
   JPY has 0 decimal places, KWD has 3. Everything goes through
   `libs/shared-types/src/currency.ts`.
2. **Push before pull, always.** Pulling first lets a server record overwrite a
   local edit that has not been transmitted. Silent data loss.
3. **`user_id` comes from the verified token, never from a request body.**
4. **Every user-scoped query runs inside `Db.withUser`.** That sets the RLS
   context. Outside it, queries return *nothing* — which looks like an empty
   account, not an error.
5. **Never link accounts on an unverified email.** It is an account-takeover
   primitive.
6. **Deletes are tombstones.** A hard delete cannot sync; the other device
   resurrects the row.
7. **The client generates primary keys** (UUIDv7). A device offline for three
   days must create permanently addressable records.
8. **Do not weaken `tsconfig.base.json`.** Full strictness is deliberate.

---

## 5. How work is expected to be done here

The codebase has a specific standard. Match it.

**Write the test so it can fail.** Twice in this project a green suite turned
out to be hollow — one file skipped everything while reporting success, and an
`alg: none` test passed with the security control removed. After adding a test
for a security property, **break the implementation and confirm the test
fails.** Examples of this discipline are in the git history under "mutation
controls".

**Run it, do not just typecheck it.** Every serious bug in this project so far
was invisible to `tsc` and only appeared when the built artifact was executed:
a phantom dependency, an ESM/CJS mismatch, an error-mapping regex that matched
the wrong string, two test suites racing over a shared Postgres catalog.

**Explain *why* in comments, not *what*.** The code says what. Comments carry
the reason a non-obvious choice was made — see `gauge-math.ts` or
`003_auth_lookups.sql` for the register.

**Correct the docs when reality disagrees.** `ARCHITECTURE.md` §9.2 contains a
correction notice because an earlier claim about Postgres RLS was wrong. Do the
same rather than leaving a confident falsehood in place.

---

## 6. Things that will surprise you

Hard-won, and cheaper to read than to rediscover.

- **`sessions` and `identities` are under RLS, but sign-in and refresh happen
  *before* a user is known.** Migration `003` solves this with three
  `SECURITY DEFINER` functions that are the *entire* bypass surface. Do not add
  a fourth without a very good reason.
- **`transactions` is partitioned on `occurred_at`, which is in the primary
  key.** So `ON CONFLICT (local_id)` is unavailable, and conflicting on the
  composite key silently *misses* when a user edits a date — inserting a
  duplicate in another partition. Use UPDATE-then-INSERT.
- **`BIGINT` and `NUMERIC` arrive from node-postgres as strings.** Uncoerced,
  every amount comparison is false and every sync push reports a conflict.
- **`libs/shared-types` builds dual CJS + ESM.** NestJS needs CommonJS; Rollup
  cannot statically analyse `export *` through CJS and needs ESM. Either one
  alone breaks the other consumer.
- **Server test files run serially** (`apps/server/vitest.config.ts`). The
  integration suites each run `002_rls.sql`, whose `CREATE ROLE`/`GRANT` touch
  cluster-wide catalogs.
- **The gauge ring compensates for stroke caps.** Round caps overhang half a
  stroke width at *each* end, so a naive arc paints ~4.3 percentage points high
  at every value. See `design-system/gauge-math.ts`.

---

## 7. Deployment reality, as of now

- `main` publishes `prototype/` to GitHub Pages at
  `https://jhemon26.github.io/TestSpendWise/`.
- **The Actions workflow is dormant.** Its runs return `total_count: 0` and it
  has not fired on recent pushes. What is live got there via the legacy
  branch builder. Diagnosing this needs authenticated access to repo settings —
  most likely Pages source is still "Deploy from a branch" rather than
  "GitHub Actions".
- **Nothing is deployed to DigitalOcean yet.** No droplet, no Docker, no
  Cloudflare. That is Phase 5 and it has not started.

---

## 8. Decisions already made — do not relitigate

Settled with the project owner. See `progress.md` for context.

| Topic | Decision |
|---|---|
| Currency | Multi-currency from v1 |
| Open Banking | **No.** Manual entry only — keeps the app outside FCA regulation |
| Authentication | **Passwordless.** Google, Apple, phone OTP, email magic link. No password field anywhere |
| Data isolation | Per-user RLS *plus* per-user envelope encryption |
| Residency | UK. LON1 region |
| State management | Zustand |
| Persistence in the prototype | None — it resets on refresh, deliberately |

**Still genuinely open:** household/shared budgets (the current design assumes
single-writer and Last-Write-Wins; sharing would need both revisited *before*
launch), the App Store business model, and push notifications.

---

## 9. What to do next

`progress.md` has the full breakdown. The short version:

1. **Finish the client.** The five screens render, but the UI is **read-only** —
   there is no add/edit sheet yet, so `store.ts` actions are wired but
   unreachable. This is the biggest gap between "looks done" and "is done".
2. **Wire the client to the real API.** `SyncTransport` is an interface with no
   HTTP implementation; the client currently seeds demo data locally.
3. **Dexie adapter.** `MemoryAdapter` is in use; web data does not survive a
   refresh yet.
4. **Phase 5** — Docker, Nginx, Cloudflare, backups.

Ask before adding scope. The project owner has been clear about decisions and
expects to be consulted on new ones.
