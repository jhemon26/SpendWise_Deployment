# SpendWise — Production Architecture & Implementation Plan

**Status:** Phase 1 design, approved for build
**Date:** 7 August 2026
**Constraint:** One DigitalOcean droplet + Cloudflare. Budget-first.
**Scale target:** **10,000+ daily active users** (see §15.1 for the worked capacity model)
**Priority order:** Security → Performance → Usability → Developer experience

---

## 0. Read this first — what one droplet buys you, and what it costs you

Every requirement in the brief is met below except the ones that are *physically impossible* on a single host. I am stating those up front rather than burying them, because designing as if they were solved is how outages become surprises.

| Requirement | On one droplet | Honest status |
|---|---|---|
| Zero-downtime deploys | Blue/green containers behind Nginx | ✅ Fully solved |
| Load balancing | Nginx across N API replicas on the same host | ⚠️ Solved for CPU distribution, **not** for host failure |
| Horizontal scaling | Vertical only (resize droplet) | ⚠️ Deferred — code is written stateless so it's a config change later |
| Database replication | None — one Postgres instance | ❌ **Not possible.** Mitigated by WAL archiving + off-host backups |
| High availability | None — the droplet is a single point of failure | ❌ **Not possible.** Expect ~10–30 min recovery from snapshot |
| DDoS / WAF / TLS termination | Cloudflare edge | ✅ Fully solved, and free |

**The one risk you are accepting:** if the droplet dies, SpendWise is down until you restore a snapshot. This is survivable *specifically because* the app is offline-first — clients keep working from local SQLite/IndexedDB and sync when the API returns. Offline-first is not just a feature here; it is the availability strategy that makes a single droplet defensible.

**At 10,000 daily active users that risk has real weight.** Ten thousand people feel a 30-minute recovery. Two consequences, both costed in §17:

- **Add Managed Postgres (+$15/mo) sooner rather than later.** It removes the worst outcome — losing the database to a stale snapshot — and brings failover and point-in-time recovery. This is the single highest-value line item in the budget.
- **Throughput is genuinely not the problem.** The worked model in §15.1 puts you at ~1.4 req/s average and ~27 req/s peak, roughly 10× under what one droplet serves. What actually bites at this scale is **synchronised sync ticks** (§6.3) — a herd of clients reconnecting in lockstep after an outage. Solved by jitter, but not obvious, and an outage if missed. (An earlier draft also had Argon2 login storms as the top risk; passwordless auth in §9.1 deleted that class entirely.)

**When to stop accepting the single host entirely:** ~30k DAU, or the first time revenue depends on uptime. §15.2 gives the migration path.

---

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENTS — one codebase, three targets                           │
│                                                                  │
│   Web (PWA)          Android (Capacitor)      iOS (Capacitor)    │
│   IndexedDB/Dexie    SQLite                   SQLite             │
│         └──────────────────┬──────────────────────┘              │
│                     Local store is the source of truth           │
│                     Sync engine (background, queue-based)        │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼─────────────────────────────────────┐
│  CLOUDFLARE (free tier)                                          │
│  DNS · SSL Full Strict · WAF · Bot Fight · DDoS · Cache · Rules  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS (origin cert, port 443 only)
┌────────────────────────────▼─────────────────────────────────────┐
│  DIGITALOCEAN DROPLET — Ubuntu 24.04 LTS, Docker Compose         │
│                                                                  │
│  ┌────────────┐   internal bridge network (no public ports)      │
│  │   nginx    │──┬─► api_blue   (NestJS)  ─┐                     │
│  │  :80 :443  │  └─► api_green  (NestJS)  ─┤                     │
│  └────────────┘                            ├─► postgres :5432    │
│                                            └─► redis    :6379    │
│  Volumes: pgdata, redisdata, certs, backups                      │
└──────────────┬───────────────────────────────────────────────────┘
               │
        ┌──────▼───────┐
        │  DO Spaces   │  files, nightly encrypted DB dumps
        └──────────────┘
```

**Why this shape.** The client is authoritative for its own data; the server is a synchronisation and durability service, not the live datastore the UI reads from. That inversion is what makes true offline-first possible, and it conveniently removes the latency and availability pressure that would otherwise force a multi-node backend.

---

## 2. Monorepo structure

pnpm workspaces. One repo, one `pnpm install`, shared types compiled once.

```
spendwise/
├── apps/
│   ├── client/                       # Ionic React + Capacitor
│   │   ├── src/
│   │   │   ├── app/                  # shell, routing, providers
│   │   │   ├── features/             # vertical slices
│   │   │   │   ├── transactions/     # ui/ store/ db/ api/
│   │   │   │   ├── categories/
│   │   │   │   ├── banks/
│   │   │   │   ├── budgets/
│   │   │   │   ├── insights/
│   │   │   │   └── auth/
│   │   │   ├── core/
│   │   │   │   ├── db/               # storage adapter interface
│   │   │   │   │   ├── adapter.ts    # StorageAdapter contract
│   │   │   │   │   ├── dexie.ts      # web  → IndexedDB
│   │   │   │   │   └── sqlite.ts     # native → Capacitor SQLite
│   │   │   │   ├── sync/             # the sync engine (§6)
│   │   │   │   ├── crypto/           # at-rest field encryption
│   │   │   │   ├── http/             # fetch wrapper, token refresh
│   │   │   │   └── net/              # connectivity detection
│   │   │   ├── design-system/        # tokens + primitives, ported 1:1
│   │   │   └── main.tsx
│   │   ├── android/                  # generated by Capacitor
│   │   ├── ios/                      # generated by Capacitor
│   │   ├── capacitor.config.ts
│   │   └── vite.config.ts
│   └── server/                       # NestJS
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/             # login, refresh, MFA, lockout
│       │   │   ├── users/
│       │   │   ├── rbac/             # roles, permissions, guards
│       │   │   ├── sync/             # push/pull endpoints
│       │   │   ├── transactions/
│       │   │   ├── categories/
│       │   │   ├── files/            # Spaces presigning
│       │   │   ├── notifications/
│       │   │   └── audit/
│       │   ├── common/               # guards, filters, interceptors, pipes
│       │   ├── config/               # zod-validated env
│       │   └── main.ts
│       ├── migrations/
│       └── test/
├── libs/
│   ├── shared-types/                 # DTOs + zod schemas — single source of truth
│   └── sync-protocol/                # envelope types shared by client & server
├── infra/
│   ├── docker/                       # Dockerfiles
│   ├── nginx/
│   ├── compose/                      # base + per-env overrides
│   └── scripts/                      # deploy.sh, backup.sh, restore.sh
├── .github/workflows/
└── docs/
```

**Why vertical feature slices, not `components/ services/ models/`.** Layer-first folders force you to touch four directories to change one behaviour, and they make dead code invisible. Feature-first means deleting a feature is `rm -rf` on one folder. At this codebase's projected size this is the difference between a two-year-maintainable repo and a ball of mud.

**Why `libs/shared-types` is non-negotiable.** The sync protocol has to agree byte-for-byte between client and server. Defining it twice guarantees drift. One zod schema generates both the TypeScript type and the runtime validator, used by the client before writing locally and by the server before touching Postgres.

---

## 3. Frontend

### 3.1 Reusing the existing prototype

The current `index.html` is a 93KB single file: design tokens in `:root`, ~30 SVG icon glyphs, a derived-state render layer, and five screens. Roughly **70% of it survives** the port.

| Existing asset | Destination | Effort |
|---|---|---|
| CSS custom properties (`--brand`, `--s1..7`, `--r-*`, type scale) | `design-system/tokens.css`, imported once | Copy — no change |
| Component CSS (`.card`, `.row`, `.chip`, `.bar`, `.gauge`) | CSS Modules per primitive | Copy, scope class names |
| `ICONS` glyph map (33 entries) | `design-system/Icon.tsx` | Copy the path data verbatim |
| `derive()` pure computation | `features/*/selectors.ts` | Copy — already pure, already tested by eye |
| `setArc()` gauge cap compensation | `design-system/Gauge.tsx` | Copy — the maths is correct and hard-won |
| `money()`, `dayLabel()`, date helpers | `core/format/` | Copy |
| DOM `innerHTML` render functions | React components | **Rewrite** — this is the real work |
| Global mutable `S` object | Zustand stores | **Rewrite** |

The rewrite is confined to the render and state layers. Every pure function — and that is deliberately most of the interesting logic — moves across untouched. Port screen-by-screen behind the existing prototype so you always have a working reference.

### 3.2 Ionic React, not Angular or Vue

Ionic supports all three. React is right here because the hiring pool is deepest, the Capacitor examples are React-first, and — decisively — the existing prototype's `render*()` functions are already pure `state → markup`, which is React's model. Angular would impose DI and RxJS on a codebase that needs neither.

### 3.3 State management: **Zustand**

| Option | Verdict |
|---|---|
| Redux Toolkit | Correct but ceremonious. Actions/reducers/slices for a local-first app whose real store is SQLite is a second state machine you must keep in sync with the first. |
| Jotai / Recoil | Atomic model is elegant but awkward for the *collection* operations (filter, group, aggregate) that dominate this app. |
| React Context | Re-renders every consumer on any change. On low-end Android this is visible jank. Disqualified. |
| **Zustand** | **Selected.** |

**Why Zustand.** ~1.2KB. No provider wrapper. Selector-based subscriptions mean a transaction edit re-renders the affected row, not the tree — which matters directly for the low-end-device requirement. Critically, its store is a plain object you can hydrate from the local DB in one call, so the DB stays the source of truth and Zustand is a *cache* over it, not a competing store. That single property is why it wins here.

```ts
// features/transactions/store.ts
export const useTxStore = create<TxState>()((set, get) => ({
  items: [],
  hydrate: async () => set({ items: await db.transactions.all() }),
  add: async (draft) => {
    const rec = await db.transactions.insert(draft);   // local write first
    set({ items: [rec, ...get().items] });             // then UI
    syncEngine.wake();                                 // then, maybe, network
  },
}));
```

The ordering in `add()` is the whole philosophy: **disk, screen, network — in that order, always.**

### 3.4 Dark mode & responsive

The prototype is dark-only. Production needs both, so tokens gain a light set under `@media (prefers-color-scheme: light)` plus a `[data-theme]` override so the in-app toggle beats the OS. Ionic's breakpoints handle tablet; the existing `@media (max-width:460px)` rule that drops the device frame becomes the phone breakpoint.

### 3.5 First-run experience — nobody meets an empty app

A budgeting app is at its worst on day one: every chart is empty, every total is £0.00, and the user has no idea whether it works. That first screen is where most finance apps lose the user. Four stages, in order:

#### Stage 1 — Welcome (3 screens, skippable)

Value proposition, not a feature tour: *"Know what you can spend today"* → *"Works with no signal"* → *"Your data is encrypted and private"*. Swipeable, dismissible, shown once. Under 15 seconds if read, one tap if not.

#### Stage 2 — Setup wizard (the "data extraction")

Four questions, each on its own screen, each skippable with a sensible default. This is the step that means the app has real numbers immediately:

| Question | Default | Why it's asked |
|---|---|---|
| Reporting currency | GBP (from device locale) | Drives every conversion (§5.1.1) |
| Monthly take-home income | skip → prompts later | Powers the savings projection |
| Day-to-day budget | 40% of income if given | The single most important number in the app |
| Which categories matter | 6 preselected from a grid of ~14 | Avoids both a blank list and an overwhelming one |

Answers write straight to the local DB and sync later — the wizard works **fully offline**, which matters because a first launch on mobile data in a lift shouldn't fail.

#### Stage 3 — Seed the app so it isn't blank

The user lands on a populated Home, never a zero state. Two paths, and the choice is explicit:

- **"Add your first expense"** — opens the add sheet with a coach mark. Home shows the full budget with a genuine "nothing spent yet" framing rather than a broken-looking screen.
- **"Explore with sample data"** — loads a demo month, clearly badged with a persistent **"Sample data · Clear"** banner. One tap wipes it and keeps the user's real settings.

> **The sample data must be unmistakably labelled and trivially removable.** Demo rows that quietly become real data are a genuine harm in a finance app — someone will budget against numbers that were never theirs. The banner stays until dismissed, and clearing is one tap with no confirmation dialog.

The existing prototype's `demoState()` is already exactly this dataset, so it ports directly.

#### Stage 4 — Contextual coach marks

Not a carousel — a single tooltip the first time each screen is opened (Budgets: *"Tap any category to change its limit"*; Insights: *"Fills in as you add transactions"*). Dismissed permanently per screen, tracked in local settings. No tour library; ~40 lines and a `<Popover>`.

**One thing the flow must not skip:** with passwordless sign-in, losing your only provider account means losing the data (§9.1). Stage 2 ends by prompting for a **second sign-in method**, explaining plainly why. It is skippable, but the app re-asks until satisfied.

### 3.6 Low-end device performance

- Route-level code splitting — Insights (charts) never loads for a user who only adds expenses.
- Virtualised transaction list (`@tanstack/react-virtual`) above ~100 rows.
- Aggregates computed in a Web Worker once the dataset exceeds ~2k transactions, keeping the main thread free.
- `content-visibility: auto` on off-screen cards.
- Budget: **< 200KB gzipped** initial JS, **< 2.5s** TTI on a throttled Moto G4. Enforced in CI (§13).

---

## 4. Offline-first data layer

### 4.1 The universal record envelope

Every syncable row, on every platform, carries these columns:

```ts
interface SyncRecord {
  local_id:    string;   // UUIDv7 — generated on device, permanent PK
  server_id:   string | null;
  created_at:  string;   // ISO-8601 UTC
  updated_at:  string;   // ISO-8601 UTC — drives conflict resolution
  deleted_at:  string | null;   // tombstone; never hard-delete before sync
  sync_status: 'pending' | 'synced' | 'failed' | 'conflict';
  version:     number;   // server-assigned, increments per accepted write
  device_id:   string;
}
```

**Why UUIDv7 for `local_id`.** Random UUIDv4 as a primary key destroys B-tree locality — every insert lands in a random leaf page, and on a 2GB droplet that means constant cache misses. UUIDv7 embeds a millisecond timestamp in the high bits, so inserts stay sequential like an auto-increment while remaining collision-free across offline devices. This one choice materially affects Postgres performance at scale and costs nothing.

**Why the client generates the PK.** A device offline for three days must create records that are already permanently addressable. Server-assigned IDs would force a rewrite pass on every local foreign key at sync time. `server_id` exists only as a reconciliation aid, and in practice it equals `local_id`.

**Why tombstones.** A hard delete is invisible to sync — the other device has no way to learn the row is gone and will happily resurrect it. `deleted_at` is set, the row syncs, and only then is it purged (§6.6).

### 4.2 One interface, two engines

```ts
export interface StorageAdapter {
  init(): Promise<void>;
  all<T>(table: Table, where?: Query): Promise<T[]>;
  get<T>(table: Table, localId: string): Promise<T | null>;
  put<T>(table: Table, rec: T): Promise<T>;
  softDelete(table: Table, localId: string): Promise<void>;
  pending(): Promise<SyncRecord[]>;
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;   // real transactions
}
```

- **Web** → Dexie over IndexedDB. Mature, good TS types, real transactions.
- **iOS / Android** → `@capacitor-community/sqlite`. Actual SQLite, WAL mode, with SQLCipher for at-rest encryption.

`Capacitor.isNativePlatform()` picks the implementation at boot. **No feature code ever imports either engine directly** — that discipline is what allows a future swap (say, to OP-SQLite) to be a one-file change.

### 4.3 Local encryption at rest

Financial data is sensitive, and a rooted Android device or a stolen laptop gives an attacker the raw DB file.

- **Native:** SQLCipher (AES-256). Key generated on first run, stored in iOS Keychain / Android Keystore — hardware-backed where available, never in JS memory longer than needed.
- **Web:** IndexedDB cannot be transparently encrypted, so sensitive *fields* (amounts, merchant names, notes) are encrypted with AES-GCM via WebCrypto using a key derived from the session. Structural columns stay plaintext so indexes still work.

This is an honest asymmetry: web is meaningfully weaker than native. Documented, not hidden.

---

## 5. Database (PostgreSQL 16)

### 5.1 Schema

```sql
-- ─── identity (passwordless — see §9.1) ──────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    TEXT NOT NULL,
  base_currency   CHAR(3) NOT NULL DEFAULT 'GBP',   -- reporting currency
  locale          TEXT NOT NULL DEFAULT 'en-GB',
  dek_wrapped     BYTEA NOT NULL,             -- per-user key, KEK-wrapped (§9.3)
  mfa_secret      BYTEA,                      -- optional TOTP, encrypted
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  onboarded_at    TIMESTAMPTZ,                -- NULL => show first-run flow (§3.6)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  purge_after     TIMESTAMPTZ                 -- set on erasure request (§9.6)
);
-- No password_hash, no email column, no lockout counters: identity lives in
-- `identities` (§9.1), one row per linked provider.

CREATE TABLE roles (
  id    SMALLSERIAL PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL           -- user | support | admin
);
CREATE TABLE permissions (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL           -- 'transaction:read', 'user:impersonate'
);
CREATE TABLE role_permissions (
  role_id       SMALLINT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ─── sessions: refresh-token rotation ────────────────────────
CREATE TABLE sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash   TEXT NOT NULL,        -- SHA-256 of the token, never the token
  family_id      UUID NOT NULL,        -- rotation lineage
  device_id      TEXT,
  user_agent     TEXT,
  ip             INET,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ON sessions (family_id);

-- ─── application data ────────────────────────────────────────
CREATE TABLE categories (
  local_id   UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL,
  colour     TEXT NOT NULL,
  limit_cents BIGINT NOT NULL DEFAULT 0,
  is_fixed   BOOLEAN NOT NULL DEFAULT FALSE,
  version    INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE transactions (
  local_id     UUID NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  UUID,
  bank_id      UUID,

  -- multi-currency: what was actually spent …
  amount_minor BIGINT NOT NULL,        -- integers only. never float.
  currency     CHAR(3) NOT NULL,       -- ISO-4217, e.g. 'GBP','EUR','JPY'
  -- … and its value in the user's reporting currency, frozen at entry time
  base_minor   BIGINT NOT NULL,
  base_currency CHAR(3) NOT NULL,
  fx_rate      NUMERIC(18,8) NOT NULL DEFAULT 1,
  fx_rate_date DATE NOT NULL,

  merchant_enc BYTEA,                  -- encrypted (§9.3)
  note_enc     BYTEA,
  occurred_at  TIMESTAMPTZ NOT NULL,
  is_income    BOOLEAN NOT NULL DEFAULT FALSE,
  pending      BOOLEAN NOT NULL DEFAULT FALSE,
  version      INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ,
  PRIMARY KEY (local_id, occurred_at)   -- partition key must be in the PK
) PARTITION BY RANGE (occurred_at);

-- daily reference rates, shared across all users (not user data → no RLS)
CREATE TABLE fx_rates (
  rate_date  DATE NOT NULL,
  base       CHAR(3) NOT NULL,
  quote      CHAR(3) NOT NULL,
  rate       NUMERIC(18,8) NOT NULL,
  source     TEXT NOT NULL DEFAULT 'ecb',
  PRIMARY KEY (rate_date, base, quote)
);

-- ─── sync bookkeeping ────────────────────────────────────────
CREATE TABLE sync_state (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,
  last_pulled_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

-- idempotency: the anti-duplicate guarantee (§6.5)
CREATE TABLE sync_operations (
  idempotency_key UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result_hash     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── audit: append-only, partitioned ─────────────────────────
CREATE TABLE audit_logs (
  id         BIGSERIAL,
  user_id    UUID,
  actor_ip   INET,
  action     TEXT NOT NULL,       -- 'auth.login.success', 'tx.delete'
  entity     TEXT,
  entity_id  UUID,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.1.1 Money and multi-currency

**Integer minor units, never `FLOAT`.** `0.1 + 0.2 !== 0.3` in IEEE-754, and in a finance app that becomes a support ticket you cannot reproduce.

**"Minor units", not "cents".** The exponent is per-currency: GBP/EUR/USD have 2 decimal places, **JPY has 0**, KWD and BHD have **3**. Hardcoding `/100` produces a 100× error on a Tokyo lunch. The ISO-4217 exponent table ships in `libs/shared-types` and every format/parse call goes through it.

**Two amounts are stored, always.** `amount_minor` + `currency` is what the user actually spent — it never changes. `base_minor` is its value in their reporting currency, **frozen at the rate on the day of the transaction** (`fx_rate`, `fx_rate_date` recorded alongside).

> **Never re-convert history at today's rate.** If you store only the foreign amount and convert at read time, every past month's totals silently change as rates move — a user's completed January would show a different figure each time they opened it. Freezing the rate makes history immutable, which is what a ledger has to be. The cost is one extra column; the alternative is a bug you cannot explain to a user.

**Rate source:** European Central Bank daily reference rates via the free `frankfurter.app` API — no key, no quota, authoritative for a UK/EU user base. A nightly BullMQ job caches them into `fx_rates`; the table is shared reference data, so it carries no RLS policy.

#### The offline-first collision

A user in Paris with no signal adds a €14 lunch. There is no live rate. Resolution:

1. The client ships with a rate snapshot and refreshes it opportunistically (daily, ~2KB for the majors).
2. Offline entry converts using the newest cached rate and sets `fx_rate_provisional = true`.
3. On sync, the **server recomputes** `base_minor` using the true ECB rate for `occurred_at` and returns the corrected record.
4. The UI shows a subtle "rate updated" affordance if the corrected figure differs materially.

This keeps the write instant — the promise of §6.1 — while making the server authoritative for the number that ends up in reports. Where a currency has no cached rate at all, the transaction is stored with `base_minor = NULL` and excluded from totals until the first sync fills it in, which is honest rather than inventing a figure.

**Budgets and category limits are denominated in the user's base currency only.** Per-currency budgets sound reasonable and are a trap: "£300 groceries" and "€50 groceries" cannot be meaningfully summed into one progress bar. One budget currency, many spend currencies.

### 5.2 Indexing

```sql
-- the hot path: "this user's transactions, newest first"
CREATE INDEX idx_tx_user_time ON transactions (user_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- the sync pull: "what changed for me since T"
CREATE INDEX idx_tx_user_updated ON transactions (user_id, updated_at);

-- category rollups
CREATE INDEX idx_tx_user_cat ON transactions (user_id, category_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_audit_user_time ON audit_logs (user_id, created_at DESC);
```

Every index is **partial on `deleted_at IS NULL`**. Tombstones are dead weight for read queries but must stay for sync; excluding them keeps the indexes small enough to sit in a 2GB droplet's shared buffers.

### 5.3 Partitioning

`transactions` and `audit_logs` partition **monthly by time**. Both are append-heavy, time-ordered, and almost always queried for a recent window — the textbook case.

The payoff is operational, not just query speed: dropping an expired audit partition is `DROP TABLE` (instant, no bloat) versus a `DELETE` that would generate millions of dead tuples and send autovacuum into a spiral on a small droplet. `pg_partman` creates next month's partition automatically.

**Retention at 10k DAU.** The audit table grows ~7 GB/year — faster than the transaction data it describes. Drop audit partitions older than **12 months** (retain longer only if a compliance obligation requires it, and archive to Spaces if so). Transaction partitions are never dropped; they are user data. This single retention rule roughly halves total disk growth (§15.1).

### 5.4 Tuning for the launch droplet (8GB, Postgres capped at 2GB)

Postgres shares the host with Node, Redis and Nginx, so it is given a 2GB container limit (§11) and tuned to that — **not** to the host's 8GB.

```
shared_buffers = 512MB          # ~25% of the container's 2GB, not the host's 8GB
effective_cache_size = 1536MB   # host page cache does the rest of the work
work_mem = 8MB                  # per sort node: 50 conns × several nodes must not OOM
maintenance_work_mem = 256MB    # vacuum and index builds
max_connections = 50            # real limiter is PgBouncer, below
random_page_cost = 1.1          # SSD
wal_compression = on
```

**Tune `shared_buffers` to the container limit, never the host.** Sizing it at 25% of 8GB gives Postgres 2GB of buffers inside a 2GB cgroup — the OOM killer arrives under load, not at boot, which makes it look like a mystery crash rather than a config error. When the droplet is resized (§15.2), raise the Postgres container limit *first*, then `shared_buffers`.

**PgBouncer in transaction mode is mandatory, not optional.** Each Postgres connection costs ~10MB; 200 idle Node connections would consume the entire droplet. PgBouncer multiplexes hundreds of client connections onto ~20 real ones.

---

## 6. The sync engine

### 6.1 Model

**Client-authoritative, server-reconciled.** Writes land locally and return immediately; sync is asynchronous and invisible. The UI never awaits the network.

### 6.2 Protocol

Two endpoints. Deliberately minimal.

```
POST /v1/sync/push     { device_id, idempotency_key, changes: SyncRecord[] }
                    →  { accepted[], conflicts[], server_time }

GET  /v1/sync/pull?since=<ISO>&device_id=<id>&cursor=<opaque>
                    →  { changes[], next_cursor, server_time, has_more }
```

Pull is cursor-paginated at 500 records. A user returning after a long offline period must not attempt a 50k-row response on a small droplet.

### 6.3 Client loop

```
     ┌──────────────┐  online / app resume / local write / 60s tick
     │     IDLE     │◄──────────────────────────────────────────┐
     └──────┬───────┘                                           │
            ▼                                                   │
   ┌──────────────────┐  no                                     │
   │ reachable?       ├──────► back off, stay IDLE ─────────────┤
   └──────┬───────────┘                                         │
          │ yes                                                 │
          ▼                                                     │
   ┌──────────────────┐   PUSH pending (batched, ≤100)          │
   │  PUSHING         │   mark synced / failed / conflict        │
   └──────┬───────────┘                                         │
          ▼                                                     │
   ┌──────────────────┐   PULL since last_pulled_at             │
   │  PULLING         │   merge, resolve, write locally          │
   └──────┬───────────┘                                         │
          ▼                                                     │
   ┌──────────────────┐                                         │
   │  RESOLVING       │──────────────────────────────────────────┘
   └──────────────────┘
```

**Push before pull, always.** Pulling first would let a server record overwrite a local edit that has not yet been transmitted — silent data loss, and the hardest class of bug to reproduce.

Connectivity uses Capacitor Network on native and `navigator.onLine` + a cheap `HEAD /health` probe on web. `navigator.onLine` alone is famously unreliable: it reports `true` on captive-portal WiFi.

**The 60s tick must be jittered.** At 10k DAU a fixed interval synchronises clients into a herd: everyone who opened the app at 08:30 syncs together at 08:31, 08:32, and so on. Measured, a synchronised tick concentrates ~11 req/s into repeating spikes rather than spreading them. Use `60s ± rand(0,30s)`, and — more importantly — **do not tick at all while the app is idle and nothing is pending**. Sync is event-driven (local write, regained connectivity, app resume); the timer is only a safety net. The same jitter rule applies to reconnect-after-outage, where the herd is at its worst.

### 6.4 Conflict resolution

Detection: the client pushes `version`. If the server's stored version is higher, the record was changed elsewhere.

| Strategy | Applied to | Rationale |
|---|---|---|
| **Last-Write-Wins on `updated_at`** | `merchant`, `note`, `category_id`, `bank_id` | Single-user, multi-device. The most recent human intent is almost always correct, and the cost of being wrong is one mis-labelled row. |
| **Server-wins** | `version`, `server_id`, any server-computed field | The server is definitionally authoritative for its own bookkeeping. |
| **Client-wins** | `deleted_at` (tombstones) | Deletion is deliberate and explicit. A resurrected transaction the user already deleted is far more alarming than a lost edit. |
| **Field-level merge** | `settings`, `budgets` | Two devices editing different fields of the same object should both win. Merge per-field on `updated_at`, not per-record. |
| **Manual** | Amount mismatch on the same `local_id` | The one case where guessing is unacceptable. Flag `sync_status='conflict'`, surface both values, let the user choose. |
| **Server-recomputed** | `base_minor`, `fx_rate`, `fx_rate_date` | Never merged. The server holds authoritative ECB rates and overwrites whatever provisional figure the client computed offline (§5.1.1). `amount_minor` and `currency` — what the user actually typed — are client-authoritative and never touched. |

**Why LWW as the default rather than CRDTs.** SpendWise is single-user, multi-device. Genuine concurrent edits to the *same* record are rare, and true convergence (CRDT/OT) would multiply client complexity and storage several-fold to solve a problem this product does not have. LWW with a clear escalation path to manual resolution for money fields is the right cost/benefit. Revisit only if shared household accounts ship.

**Clock skew.** `updated_at` is written by the device, and device clocks lie. Every push carries `client_time`; the server records `server_time` and returns the delta. Clients with skew beyond ±30s have their timestamps normalised server-side, and the server's `updated_at` is the tiebreaker of record.

### 6.5 Duplicate prevention — three independent layers

1. **Client-generated UUIDv7 PK.** Re-pushing the same record is an upsert on the same key, not an insert. This alone eliminates the common case.
2. **`idempotency_key` per batch.** Every push carries a UUID. The server records it in `sync_operations` inside the same transaction as the write. A replay — mobile radio dropped after the server committed but before the client got the 200 — hits the primary key, and the stored `result_hash` is returned instead of re-applying. This is the layer that handles the genuinely hard case.
3. **`ON CONFLICT (local_id) DO UPDATE`** at the SQL level, guarded by `WHERE excluded.version > transactions.version`. Defence in depth: even a logic bug upstream cannot produce a duplicate row or an out-of-order overwrite.

### 6.6 Retry & tombstone GC

Exponential backoff with jitter: 1s, 2s, 4s … capped at 5 min, max 10 attempts, then `sync_status='failed'` and a UI affordance. Jitter is essential — without it, every client in a region retries in lockstep after an outage and stampedes the single droplet the moment it recovers.

Tombstones are purged locally 30 days after `deleted_at` *and* confirmed sync; server-side after 90 days. The asymmetry gives a long-offline device a window to learn about the deletion before the evidence disappears.

---

## 7. Backend

### 7.1 NestJS over bare Express

NestJS is chosen deliberately despite the heavier footprint. Guards, interceptors and pipes give **declarative, centrally-auditable** security — `@RequirePermission('transaction:write')` on a handler is reviewable at a glance, whereas Express middleware ordering is a per-route audit with no compiler help. When the top priority is security, "the compiler enforces the boundary" beats "the convention is documented". Its DI also makes the security-critical paths genuinely unit-testable.

### 7.2 API design

REST, versioned under `/v1`, JSON, `api.domain.com`.

```
POST   /v1/auth/oidc/start          POST /v1/auth/oidc/callback   (Google, Apple)
POST   /v1/auth/otp/send            POST /v1/auth/otp/verify      (phone)
POST   /v1/auth/magic/send          POST /v1/auth/magic/verify    (email)
POST   /v1/auth/identities/link     DELETE /v1/auth/identities/:id
POST   /v1/auth/refresh             POST /v1/auth/logout
POST   /v1/auth/mfa/enrol           POST /v1/auth/mfa/verify      (optional TOTP)
GET    /v1/me                       PATCH /v1/me
POST   /v1/me/onboarding            GET  /v1/me/export            (GDPR, §9.6)
DELETE /v1/me                       (erasure, 30-day grace)
POST   /v1/sync/push                GET  /v1/sync/pull
GET    /v1/fx/rates?base=GBP        GET  /v1/transactions
POST   /v1/files/presign            GET  /v1/notifications
GET    /v1/health                   (unauthenticated)
```

Conventions: cursor pagination (never `OFFSET` — it degrades linearly), RFC 7807 `application/problem+json` errors, `ETag`/`If-None-Match` on collections, strict zod validation at the boundary with unknown keys **stripped, not ignored**.

### 7.3 Redis

One instance, four logical jobs: token/session denylist (the only way to make a stateless JWT revocable), rate-limit counters, BullMQ queues for email and push, and a small cache for expensive aggregates. `maxmemory-policy noeviction` on the queue DB — silently evicting jobs is worse than failing loudly.

---

## 8. File storage — DigitalOcean Spaces

Files never touch Postgres. Storing binaries in the DB bloats every backup, wrecks the buffer cache, and makes restores enormous.

Flow: client asks `POST /v1/files/presign` → server authorises, validates declared MIME and size, returns a presigned PUT valid for 5 minutes → client uploads **directly to Spaces**, never through the droplet. That last point matters disproportionately here: a single droplet cannot afford to proxy file bytes.

Buckets are **private**; reads go through short-lived presigned GETs. Server-side validation re-checks magic bytes on first access — never trust a client-declared `Content-Type`. Spaces CDN fronts profile images.

---

## 9. Security

Security is the top priority, so this section is the specification, not a summary.

### 9.1 Authentication — passwordless, federated only

**There is no "create account" form and SpendWise never stores a password.** Identity is delegated to providers who do it better than we can, and the user arrives already verified.

> #### ✅ This decision deleted an entire class of risk
>
> An earlier draft of this document specced Argon2id and then had to defend it against a memory-exhaustion DoS at 10k DAU. **Removing passwords removes all of it:** no password hashing, no Argon2 memory budget, no concurrency semaphore, no credential stuffing, no password reset flow (historically the most-attacked endpoint in any app), no breach-reuse exposure, no lockout tuning. The most secure credential store is the one you don't operate.

#### Supported methods

| Method | Protocol | Notes |
|---|---|---|
| **Sign in with Google** | OIDC, auth-code + PKCE | Primary. Widest reach in the UK. |
| **Sign in with Apple** | OIDC, auth-code + PKCE | **Mandatory, not optional** — App Store Guideline 4.8 requires it if you offer any other third-party sign-in on iOS. Omitting it means rejection. |
| **Phone + SMS OTP** | 6-digit, 5-min TTL | Offered, with reservations — see the warning below. |
| **Email magic link** | Signed single-use token, 15-min TTL | **My recommendation as the fourth option** (§20 gave me the call). Costs nothing, needs no provider account, and is the natural fallback for anyone without Google/Apple who doesn't want to hand over a phone number. |

#### Flow

```
App ──► ASWebAuthenticationSession (iOS) / Custom Tab (Android) / redirect (web)
     ──► Provider consent ──► authorization code + PKCE verifier
     ──► POST /v1/auth/oidc/callback
            server: exchange code, fetch provider JWKS (cached 24h),
                    verify signature, iss, aud, exp, nonce
                    find-or-create user, link identity
     ──► SpendWise access token (15 min) + refresh token (30 days)
```

**Never an embedded WebView.** Google actively blocks them, and they are phishable by construction — the user cannot see the address bar to verify who is asking for their credentials. System browser components only.

**PKCE is required on every platform**, including web. Without it a stolen authorization code is redeemable by an attacker.

> #### ⚠️ Phone/SMS is the weakest link — treat it accordingly
>
> For a finance app, SMS OTP is the least safe option offered. Two concrete threats:
>
> **SIM swap.** An attacker who ports the number receives the OTP. This is not theoretical — it is the standard attack on phone-based finance accounts. Mitigations: bind sessions to a device ID; require step-up verification when a phone login arrives from an unrecognised device; impose a **24-hour cooling-off** on data export and account deletion after any phone-only sign-in from a new device.
>
> **SMS pumping fraud.** An attacker triggers thousands of OTPs to premium-rate numbers they control and takes a revenue share. This bills *you*. At £0.04/SMS an unthrottled endpoint is an open cheque. Mitigations: hard caps (3 OTPs per number/hour, 10 per IP/day), block high-risk country and premium ranges by prefix allowlist, Cloudflare Turnstile before the send, and a **daily spend ceiling that hard-stops the endpoint**.
>
> Present Google and Apple first in the UI. Phone is a fallback, not the default.

#### Tokens & session

- **Access token:** JWT, **15 min**, RS256, carrying `sub`/`jti`/`roles`/`perms`. Short-lived because a stateless JWT cannot be revoked mid-life; the expiry *is* the revocation window.
- **Refresh token:** opaque 256-bit random, **30 days**, SHA-256 hashed at rest. Not a JWT — it must be revocable, and only a DB lookup gives that.
- **Refresh-token rotation with reuse detection.** Each refresh issues a new token and retires the old one. If a *retired* token is presented, the entire `family_id` is revoked and the user is alerted — this is the signature of a stolen token being replayed, and it is the single highest-value auth control here.
- **Storage:** web uses `HttpOnly; Secure; SameSite=Strict` cookies for the refresh token (immune to XSS exfiltration); native uses Keychain/Keystore. Access tokens live in memory only — never `localStorage`.
- **Optional TOTP** on top of the provider, for users who want a second factor SpendWise controls. Secret encrypted at rest; 10 single-use recovery codes stored as SHA-256 (they are already 128-bit random, so a slow hash buys nothing).
- **OTP throttling replaces account lockout.** With no password there is nothing to brute-force, but the OTP endpoints still need limits: 5 verify attempts per challenge, then the challenge is burned.

#### Account linking & recovery

One human, many identities:

```sql
CREATE TABLE identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,        -- 'google' | 'apple' | 'phone' | 'email'
  subject       TEXT NOT NULL,        -- provider's stable user id
  email         CITEXT,
  phone_e164    TEXT,
  verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  UNIQUE (provider, subject)
);
CREATE UNIQUE INDEX ON identities (user_id, provider);
```

Matching a returning user by **verified email** links Google and Apple to one account automatically. Never link on an *unverified* email — that is an account-takeover primitive.

**Apple's private relay** (`@privaterelay.appleid.com`) means the email may not match anything else and may be revoked by the user at any time. Treat `provider + subject` as the durable key; email is a hint, never the identifier.

**Users must be prompted to add a second identity.** With one provider and no password, losing that provider account means losing the data — and there is no reset email to fall back on. The onboarding flow (§3.6) asks for a backup method, and the app nags until there are two.

### 9.2 Authorisation & tenant isolation

RBAC + granular permissions. Every handler declares its requirement; a global guard denies by default. **Ownership is enforced in the query, not after it** — `WHERE user_id = $currentUser` rather than fetch-then-compare. That eliminates the IDOR class of bug structurally rather than by vigilance.

#### Postgres Row-Level Security — the second, independent wall

Application-layer checks are one bug away from a cross-account leak, and at 10k users that bug is a reportable breach. **RLS makes isolation a property of the database, not of developer discipline.**

```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;   -- applies to the table owner too

CREATE POLICY tenant_isolation ON transactions
  USING      (user_id = current_setting('app.user_id')::uuid)
  WITH CHECK (user_id = current_setting('app.user_id')::uuid);
```

Repeated for every user-scoped table. A request interceptor issues `SET LOCAL app.user_id = $1` at the start of each transaction; `SET LOCAL` scopes it to that transaction, so a pooled connection can never leak context between requests. The API connects as a role that is **not** the table owner and has no `BYPASSRLS`.

The result: a query that forgets its `WHERE user_id` clause returns **zero rows**, not someone else's data. `USING` filters reads; `WITH CHECK` constrains writes.

> **Correction, verified against Postgres 16.** An earlier draft claimed `USING` alone lets you insert a row attributed to another user. That is **false** — when `WITH CHECK` is omitted, Postgres reuses the `USING` expression as the write check, and the forged insert is rejected either way. We still write both explicitly, for two better reasons: it documents intent at the point of definition, and it is the only way to express a read predicate that legitimately differs from the write predicate (for example, "you may see shared rows but only create your own"). Trusting the implicit fallback is fine for tenant isolation and a trap the moment the two rules diverge.

Verified by a CI test that authenticates as user A and attempts to read, update and delete user B's rows across every table. That test is a release gate.

### 9.3 Per-user encryption — a database dump is not a breach

The brief says "no one sees no one's data, very secure". RLS achieves that against application bugs; envelope encryption achieves it against a **stolen backup or a compromised droplet**.

```
KEK  (master key, DO/Vault secrets manager — never on disk, never in the image)
 └─► DEK per user (random 256-bit, stored wrapped in users.dek_wrapped)
      └─► AES-256-GCM over sensitive fields:
            transactions.merchant, transactions.note_enc,
            identities.phone_e164, users.mfa_secret
```

Structural columns — `user_id`, `amount_minor`, `base_minor`, `occurred_at`, `category_id` — stay plaintext so indexes, partitions and aggregate queries still work. This is a deliberate trade: encrypting the amounts would make every budget rollup a full decrypt-and-scan, which no droplet at this budget can afford. Amounts alone, stripped of merchant and note, are of limited value to an attacker.

**What this buys:** a leaked `pg_dump` or a stolen Spaces backup is ciphertext. Compromising the data requires the KEK too, which lives in a different system.

**Crypto-shredding:** GDPR erasure (§9.6) destroys the user's DEK. Their rows become permanently unreadable in every historical backup instantly — without which "delete my data" would mean rewriting 30 days of encrypted archives, which is not practical.

### 9.4 OWASP Top 10 coverage

| Risk | Control |
|---|---|
| A01 Broken access control | Deny-by-default guards; ownership in the WHERE clause; **Postgres RLS as an independent second wall** (§9.2) |
| A02 Cryptographic failures | TLS 1.3; per-user envelope encryption (§9.3); SQLCipher on device. **No passwords to leak** |
| A03 Injection | Parameterised queries **only** — raw string SQL banned by lint rule; zod validation |
| A04 Insecure design | Threat model per feature; rate limits designed in, not retrofitted |
| A05 Misconfiguration | Distroless images; non-root containers; env validated by zod at boot, process exits if invalid |
| A06 Vulnerable components | Dependabot; `pnpm audit` gates CI; Trivy scans images |
| A07 Auth failures | Federated identity — no passwords, no stuffing, no reset flow; refresh rotation + reuse detection; PKCE |
| A08 Integrity failures | Signed images; pinned digests; CI provenance |
| A09 Logging failures | Structured audit log of every auth and mutation event; alerts on anomalies |
| A10 SSRF | Only provider JWKS endpoints are fetched server-side, from a hardcoded allowlist. No user-supplied URLs |

### 9.5 Transport, headers, and the rest

CSP (`default-src 'self'`, no `unsafe-inline` — the prototype's inline styles move to files during the port), HSTS with preload, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`. CSRF: `SameSite=Strict` plus double-submit token on cookie-authenticated mutations; native clients use bearer tokens and are structurally immune.

Rate limits: `/auth/oidc/*` 10/min/IP, **`/auth/otp/send` 3/hour/number and 10/day/IP** (§9.1 — this one is a direct bill, not just load), `/sync/*` 60/min/user, global 300/min/IP — enforced at Cloudflare *and* in Redis, because edge rules alone fail open if someone finds the origin IP.

**Secrets:** Docker secrets on the droplet, GitHub Encrypted Secrets in CI, never in the image or the repo. `gitleaks` runs in CI. The **KEK never leaves the secrets manager**. Postgres and Redis credentials rotate quarterly; JWT signing keys rotate every 90 days with overlapping validity so no user is logged out.

**Suspicious login detection:** new device/IP/geo triggers an email; impossible-travel (two logins too far apart for the elapsed time) forces re-authentication.

### 9.6 UK data protection (UK GDPR + DPA 2018)

The user base is UK-based, which makes the following obligations rather than nice-to-haves.

| Obligation | Implementation |
|---|---|
| **Data residency** | Droplet and Spaces in **LON1**. Backups never leave the UK region. |
| **ICO registration** | Register as a data controller before launch (~£52/yr for a small organisation). |
| **Lawful basis** | Contract (Art. 6(1)(b)) for the core service. No advertising, no profiling, so no consent banner beyond strictly-necessary cookies. |
| **Right of access / portability** | `GET /v1/me/export` produces a signed JSON+CSV archive of every record, delivered as a 24-hour presigned Spaces link. Must complete within one month. |
| **Right to erasure** | `DELETE /v1/me` → 30-day grace (recoverable, and it protects against a hijacked session wiping an account), then **crypto-shredding of the user's DEK** (§9.3) plus row deletion. |
| **Breach notification** | 72-hour ICO notification runbook in `infra/scripts/`. The audit log is what makes the required "scope of the breach" answerable. |
| **Data minimisation** | No location, no contacts, no device fingerprinting, no third-party analytics SDKs. Sentry is configured to scrub PII. |
| **DPA with processors** | DigitalOcean and the SMS provider both offer GDPR DPAs — sign both before launch. |
| **DPIA** | Financial data at 10k+ users warrants a Data Protection Impact Assessment. Do it during Phase 6. |
| **Retention** | Audit logs 12 months (§5.3); deleted accounts purged after 30 days; backups age out at 30 days. |

**Financial data is not "special category" under Art. 9**, so the stricter Art. 9 conditions do not apply — but it is unambiguously high-risk personal data, which is why the DPIA and the encryption in §9.3 are appropriate rather than excessive.

**No Open Banking means no FCA authorisation.** Manual entry keeps SpendWise entirely outside the regulated-activity perimeter — a very large saving in time, cost and legal exposure. **The moment you add bank feeds, that changes**: you become an Account Information Service Provider and need FCA registration. §20 keeps the schema ready without incurring the obligation.

---

## 10. Cloudflare (free tier)

| Setting | Value | Why |
|---|---|---|
| SSL mode | **Full (Strict)** | Validates the origin certificate. "Flexible" leaves Cloudflare→origin in plaintext and is worse than no TLS because it looks secure. |
| Origin cert | 15-year Cloudflare Origin CA | Free, and the origin then rejects anything not from Cloudflare |
| Always Use HTTPS | On | |
| Min TLS | 1.2 | |
| HSTS | On, 12 months, preload | |
| WAF | Managed ruleset | Free tier covers the OWASP core set |
| Bot Fight Mode | On | |
| DDoS | On (automatic, unmetered) | The single biggest free win — L3/L4/L7 absorbed before your droplet sees it |
| Rate limiting | 1 free rule → `/v1/auth/*` | Spend the single free rule on the login endpoint; everything else is enforced in Redis |
| Cache | Bypass `api.domain.com`; aggressive on the web app's static assets | API responses are user-specific and must never be edge-cached |

**Firewall rules:** block non-GET/POST/PATCH/DELETE, challenge Tor and known-bad ASNs, allow `/v1/health` only from monitoring.

**Critical:** after DNS is proxied, the droplet firewall must allow 443 **only from Cloudflare's published IP ranges**. Otherwise an attacker who discovers the origin IP bypasses every protection above. This is the most commonly skipped step in this entire document.

---

## 11. Docker & Nginx on one droplet

```yaml
# infra/compose/docker-compose.yml
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - certs:/etc/nginx/certs:ro
    depends_on: [api_blue]
    restart: unless-stopped

  api_blue: &api
    image: ghcr.io/jhemon26/spendwise-api:${TAG}
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://app@pgbouncer:6432/spendwise
      REDIS_URL: redis://redis:6379
    secrets: [db_password, jwt_private, spaces_key]
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 10s
      retries: 3
    deploy: { resources: { limits: { memory: 640M } } }
    restart: unless-stopped
    user: "10001:10001"
    read_only: true
    cap_drop: [ALL]

  api_green: { <<: *api, profiles: [green] }

  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment: { POOL_MODE: transaction, MAX_CLIENT_CONN: 300, DEFAULT_POOL_SIZE: 20 }

  postgres:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    deploy: { resources: { limits: { memory: 1G } } }
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 192mb --maxmemory-policy allkeys-lru --appendonly yes
    volumes: [redisdata:/data]
    restart: unless-stopped
```

**No database port is published to the host.** Postgres and Redis are reachable only on the internal bridge network. Containers run non-root, read-only, with all capabilities dropped — if the API is compromised, the blast radius is one unprivileged process in a container that cannot write to its own filesystem.

**Memory budget on a 4GB droplet:** Postgres 1G, API 640M × 2 during a deploy, Redis 192M, PgBouncer/Nginx ~100M, OS ~400M ≈ 3GB peak. Deliberately leaves headroom; a droplet that OOMs during deploy is a droplet that fails exactly when you are changing it.

**Nginx** terminates TLS with the Cloudflare origin cert, proxies `/v1` to the active colour, sets security headers, enables gzip/brotli, and caps request bodies at 2MB.

---

## 12. Zero-downtime deployment & rollback

```
1. CI builds, tests, scans, pushes image :sha to GHCR
2. deploy.sh on droplet:
     docker compose pull api_green
     docker compose up -d api_green
     wait for /health to pass 3 consecutive checks   (fail → abort, blue untouched)
     nginx: switch upstream blue → green, reload (SIGHUP, no dropped connections)
     drain blue 30s, stop
     retag green as the new blue
```

**Rollback** is the same switch in reverse — Nginx points back at the previous container, which is still on disk. **Under 10 seconds**, no image pull, no rebuild.

**Database migrations are the hard part**, because they cannot be rolled back by flipping a pointer. The rule is **expand/contract**, strictly:

1. *Expand* — additive only (add nullable column). Deploy. Old and new code both work.
2. *Migrate* — backfill in batches.
3. *Contract* — drop the old column, **one release later**, only after the previous version is confirmed retired.

A destructive migration in the same release as the code that needs it makes rollback impossible. That rule is worth more than any tooling.

---

## 13. CI/CD (GitHub Actions)

Branches: `development` → `staging` → `main`. On one droplet, staging is a second Compose project on different internal ports behind `staging.domain.com`, sharing the host but with its own database. Not perfect isolation — an honest compromise for the budget, and the reason production migrations are always rehearsed against a *restored production snapshot*, not against staging's data.

```yaml
# .github/workflows/ci.yml  (abridged)
jobs:
  quality:
    steps:
      - lint · typecheck · unit tests (client + server)
      - gitleaks · pnpm audit --audit-level=high
      - bundle-size check   # fails if initial JS > 200KB gzipped
  integration:
    services: [postgres, redis]
    steps: [pnpm migration:run, pnpm test:e2e]
  build:
    steps: [docker build, trivy scan (fail on HIGH/CRITICAL), push ghcr :sha]
  deploy:
    if: github.ref == 'refs/heads/main'
    environment: production        # requires manual approval
    steps: [ssh deploy.sh, smoke test, notify]
```

Deploy authenticates with a dedicated SSH key held in GitHub Environments, restricted to a non-root `deploy` user that may run only `deploy.sh` via a forced command.

---

## 14. Monitoring

Self-hosted and free, because the budget says so:

- **Logs:** Pino JSON → Loki, 14-day retention. Never log tokens, passwords, or amounts.
- **Metrics:** Prometheus + Grafana — Node event-loop lag, Postgres connections/cache-hit/slow queries, Redis memory, droplet CPU/RAM/disk.
- **Errors:** Sentry free tier, source-mapped, on both client and server.
- **Uptime:** UptimeRobot (external — it must not live on the droplet it watches) hitting `/v1/health` every 5 min.
- **Alerts → Telegram/email:** disk > 80%, memory > 90%, 5xx rate > 1%, p95 latency > 800ms, failed logins > 50/min from one IP, refresh-token reuse detected, backup job failed.

That last one matters more than it looks: **a backup you are not alerted about is a backup you do not have.**

---

## 15. Scalability path

### 15.1 Capacity model at 10,000 daily active users

The target is **10k DAU**, not 10k registered. Worked from assumptions you can challenge:

| Input | Assumption |
|---|---|
| Sessions per user per day | 3 |
| API requests per session | 4 (token refresh, sync push, 1–2 pull pages) |
| Transactions created per user per day | 5 |
| Share of daily traffic in the peak hour | 20% (commute-shaped) |

| Derived | Value |
|---|---|
| Requests/day | 120,000 |
| **Average** | **1.4 req/s** |
| **Peak hour** | **6.7 req/s** |
| **Peak-minute burst (4×)** | **~27 req/s** |
| Transactions/day | 50,000 |
| Disk growth | **13.4 GB/year** (6.4 data+indexes, 7.0 audit) |

**27 req/s is not a hard problem** — a single NestJS process handles that with CPU to spare. This is the offline-first design paying off exactly as intended: **request volume scales with sync events, not with screen views.** A user who opens SpendWise fifteen times to check a balance generates zero requests. That property is what makes 10k DAU on one droplet defensible where a conventional server-rendered app would already need three.

**What actually constrains you at this scale, in order:**

1. **Thundering-herd sync** — now the top risk, since passwordless auth (§9.1) removed the Argon2 ceiling that used to hold this spot. Solved by jitter in §6.3.
2. **Backup and autovacuum competing with live traffic** — schedule `pg_dump` at 03:00 local, tune autovacuum to be more aggressive but smaller-batched so it never blocks the peak.
4. **Disk** — 13.4 GB/yr means the 80GB volume lasts ~4 years at 60% usable. Audit partitions older than **12 months** are dropped, which roughly halves the growth rate.
5. **Raw request throughput** — comfortably last, at roughly 10× headroom.

**Droplet sizing at 10k DAU:**

| Option | Cost | Verdict |
|---|---|---|
| 2 vCPU / 4GB | $24 | Serves the traffic, but leaves almost nothing spare when a blue-green deploy (two API containers) overlaps the nightly backup. |
| **4 vCPU / 8GB** | **$48** | **Launch here.** Headroom for deploys and vacuum without competing with live traffic. |

At 10k DAU an outage affects ten thousand people, which changes the calculus: better to spend the extra $24/mo than debug an OOM at 3am, mid-deploy, with a rollback path that also needs memory. §15.2 has the upgrade ladder from here.

### 15.2 The vertical upgrade ladder

**Strategy: launch sized for 10k DAU, then resize the droplet as growth arrives.** DigitalOcean resizes are a reboot — CPU/RAM-only resizes take ~1 minute and are reversible; disk resizes are permanent. Because everything runs in Compose with named volumes, a resize needs no reconfiguration: power off, resize, power on, containers come back.

| Stage | DAU | Droplet | $/mo | Upgrade trigger — whichever comes first |
|---|---|---|---|---|
| **Launch** | **0 – 12k** | **4 vCPU / 8GB** | **$48** | — start here |
| 2 | 12k – 25k | 8 vCPU / 16GB | $96 | p95 latency > 400ms, or RAM > 75% sustained, or CPU > 60% at peak |
| 3 | 25k – 50k | Move Postgres to Managed | +$15 | Disk > 60%, or backup window > 20 min, or **any** data-loss scare |
| 4 | 50k+ | Multi-droplet + LB (§15.3) | ~$150 | Vertical ceiling reached, or uptime becomes contractual |

**Why start at 4 vCPU / 8GB rather than 2/4GB and climb sooner.** The £24/mo saving is real, but the failure mode isn't gradual: a 4GB droplet running Postgres, Redis, and *two* API containers during a blue-green deploy has almost no headroom, and the first symptom is an OOM kill during a deploy — the worst possible moment, because you are mid-change and the rollback path is also memory-hungry. 8GB buys the margin to deploy safely while serving peak traffic.

**Instrument the triggers before you need them.** The Grafana dashboard (§14) should carry exactly the four metrics in the table above, with alerts at the thresholds. Growth that surprises you is growth that pages you at 3am; growth you have a dashboard for is a calendar entry.

**Two things that will not scale vertically**, and no droplet size fixes either — they are addressed in code, at launch, in this document:
- **Argon2 login storms** — moot now, §9.1 removed passwords entirely.
- **Synchronised sync ticks** — jitter, §6.3. A herd of 50k clients hits a 16GB droplet just as hard as a 4GB one.

### 15.3 Beyond vertical

**10k → 30k DAU.** Resize the droplet (vertical, ~5 min downtime). Add Redis caching for aggregates. Tune Postgres. No architecture change.

**Escalated recommendation at this scale:** move Postgres to DigitalOcean Managed Postgres (+$15/mo) *earlier than originally planned* — ideally before you cross 10k DAU rather than at 30k. It buys automated failover, point-in-time recovery, and removes the single worst failure mode (losing the database with a stale snapshot). At 10k daily users, $15/mo against that risk is cheap insurance, and it is the first thing I would add to the budget.

**30k → 100k+.** The single-droplet model ends here, and the code is already written for it:
1. Move Postgres to DigitalOcean Managed Postgres (+$15/mo) — brings automated failover, PITR, and a read replica.
2. Split the API onto 2–3 droplets behind a DO Load Balancer (+$12/mo). The API is already stateless — sessions in Redis, no local disk — so this is configuration, not a rewrite.
3. Route read-heavy `/sync/pull` to the replica.
4. Cloudflare CDN already fronts static assets.

**Sharding is deliberately not planned.** Partitioned tables on managed Postgres comfortably handle low tens of millions of transactions. Sharding before that is complexity in search of a problem.

---

## 16. Backup & recovery

| What | How | Retention |
|---|---|---|
| Postgres logical | Nightly `pg_dump`, gzip, **age-encrypted**, → Spaces | 30 daily, 12 monthly |
| Postgres PITR | WAL archived to Spaces every 5 min | 7 days |
| Redis | AOF + nightly RDB → Spaces | 7 days |
| Uploads | Spaces versioning | 30 days |
| Droplet | DO weekly snapshot (+20% of droplet cost) | 4 weeks |

**RPO 5 minutes. RTO ~30 minutes** (provision droplet → restore snapshot → replay WAL → repoint DNS).

Backups are encrypted **before** upload — Spaces credentials leaking must not equal a database breach. A quarterly restore drill into a scratch droplet is scheduled; the runbook lives in `infra/scripts/restore.sh`. **An untested backup is a hypothesis, not a backup.**

---

## 17. Cost estimate (USD/month)

Sized for **10,000 daily active users** (§15.1).

Launch configuration, sized for **10,000+ daily active users** (§15.1), region **LON1** (§9.6).

| Item | Spec | Cost |
|---|---|---|
| Droplet | **4 vCPU / 8GB / 160GB SSD** | $48.00 |
| Snapshots | 20% of droplet | $9.60 |
| Spaces | 250GB + 1TB transfer | $5.00 |
| SMS OTP | ~2,000/mo @ £0.035 (§9.1) | ~$9.00 |
| Cloudflare | Free tier | $0 |
| Sentry / UptimeRobot / Grafana / Loki | free tiers & self-hosted | $0 |
| Domain | amortised | ~$1.00 |
| ICO registration | £52/yr, amortised (§9.6) | ~$5.50 |
| **Launch total** | | **≈ $78/mo** |

**SMS is the one variable line.** It scales with *new users and new devices*, not DAU — steady state is low, but a growth spike or an SMS-pumping attack can multiply it overnight. The daily spend ceiling in §9.1 is a cost control as much as a security control. **Pushing Google/Apple ahead of phone in the UI is the cheapest optimisation available** — every user who picks one costs $0 instead of $0.04.

**Trimming to ~$63/mo:** drop SMS entirely (Google + Apple + email magic link only) and skip snapshots for the first months. I'd keep snapshots.

**Do not run 10k DAU on 1 vCPU/2GB** — Postgres, Redis and two API containers during a deploy do not fit.

**Growth costs** follow the ladder in §15.2: ~$126/mo at 25k DAU, ~$150/mo at 50k+.

---

## 18. Security checklist

**Before first deploy**
- [ ] Droplet firewall: 443 from **Cloudflare ranges only**; SSH key-only, root login disabled
- [ ] `fail2ban` on SSH
- [ ] Cloudflare SSL = Full (Strict); origin cert installed
- [ ] All secrets in Docker secrets; `gitleaks` clean
- [ ] Containers non-root, read-only, `cap_drop: ALL`
- [ ] No DB/Redis port published to host
- [ ] CSP with no `unsafe-inline`; HSTS preload submitted
- [ ] Automated backup **restore** rehearsed end-to-end
- [ ] **RLS cross-tenant test passes** — authenticate as A, attempt read/update/delete of B's rows on every table (§9.2). Release gate.
- [ ] API role confirmed **not** table owner and lacks `BYPASSRLS`
- [ ] KEK stored in secrets manager, never on the droplet disk or in an image (§9.3)
- [ ] Crypto-shred path tested: erase a test user, confirm their rows are unreadable from a pre-deletion backup
- [ ] OIDC: PKCE enforced; `iss`/`aud`/`exp`/`nonce` all validated; JWKS cached with rotation handling
- [ ] **Sign in with Apple implemented** — App Store rejects without it (§9.1)
- [ ] SMS: per-number and per-IP caps live, premium-prefix blocklist, **daily spend ceiling armed**
- [ ] Region confirmed **LON1** for droplet *and* Spaces; ICO registration filed; DPAs signed (§9.6)
- [ ] Data export and erasure endpoints tested end-to-end

**Ongoing**
- [ ] Dependabot weekly; monthly `pnpm audit`
- [ ] Quarterly secret rotation; 90-day JWT key rotation
- [ ] Quarterly restore drill
- [ ] Audit-log review for anomalous patterns
- [ ] Annual pen test once handling real financial data

---

## 19. Sequenced delivery

| Phase | Deliverable | Est. |
|---|---|---|
| 2 | Monorepo scaffold, shared types, CI skeleton | 1 wk |
| 3 | Auth: OIDC (Google/Apple), phone OTP, magic link, identity linking, JWT+rotation, RBAC, **RLS policies + cross-tenant tests**, audit | 2 wks |
| 4 | Local DB adapters + Zustand + port prototype screens + **first-run flow (§3.5)** + multi-currency | 2.5 wks |
| 5 | Sync engine both sides — **the highest-risk component** | 2 wks |
| 6 | Droplet, Docker, Nginx, Cloudflare, backups | 1 wk |
| 7 | CI/CD, monitoring, blue/green | 1 wk |
| 8 | Capacitor builds, store submission, security audit | 2 wks |

**Build the sync engine on a throwaway branch first, against deliberately hostile conditions** — airplane mode mid-write, clock skew, duplicate pushes, two devices editing one record. It is the one component where bugs corrupt user data rather than merely annoying users, and it is far cheaper to get wrong in a spike than in production.

---

## 20. Decisions — resolved

| # | Question | Decision | Consequence in this document |
|---|---|---|---|
| 1 | Currency | **Multi-currency from v1** | §5.1.1 — dual amounts, frozen FX rate per transaction, ECB daily rates, offline provisional conversion |
| 2 | Open Banking | **No — manual entry only** | **Stays outside the FCA perimeter entirely.** Schema keeps `bank_id` and the sync envelope so feeds can be added later without migration |
| 3 | First-run experience | **Welcome + wizard + seed + coach marks** | §3.5 — the app is never blank; sample data is labelled and one-tap removable |
| 4 | Authentication | **Passwordless: Google, Apple, phone OTP, + email magic link** | §9.1 rewritten. No passwords anywhere. Sign in with Apple is mandatory for App Store approval |
| 5 | Data isolation | **Per-user, defence in depth** | §9.2 Postgres RLS as an independent wall; §9.3 per-user envelope encryption so a stolen dump is ciphertext |
| 6 | Residency | **UK — LON1** | §9.6 UK GDPR: ICO registration, export, erasure by crypto-shredding, DPAs, DPIA |
| 7 | Remaining calls (mine) | see below | — |

**Decisions I made under item 7, with reasons:**

- **Email magic link as a fourth sign-in option.** Free, no provider account, no SMS bill, and the natural path for anyone who has neither Google nor Apple and would rather not hand over a phone number. It also gives every user a cheap route to the *second* identity §9.1 requires.
- **ECB rates via `frankfurter.app`.** No API key, no quota, authoritative for a UK user base. A paid FX provider is unjustifiable at this budget.
- **Budgets in base currency only.** Per-currency budgets cannot be summed into one honest progress bar.
- **Zustand, unchanged.** Nothing in these seven answers moves the state-management argument.
- **No i18n framework yet.** Multi-*currency* is not multi-*language*, and the user base is UK. Strings go through a `t()` shim from day one so adding `i18next` later is a swap, not a refactor — but shipping the framework now is weight for no benefit.
- **TOTP stays optional, not mandatory.** Google and Apple already enforce their own MFA. Forcing a second factor on top would cost more users than it protects, and the users who want it can enable it.

### Still genuinely open

1. **Household / shared budgets.** Answer #5 ("no one sees anyone's data") reads as a firm *no*, and this design assumes it — Last-Write-Wins (§6.4) and per-user RLS both depend on single-writer data. **If shared budgets are ever wanted, both need redesigning before launch, not after.** Worth confirming explicitly.
2. **App Store business model.** Free, paid, or subscription changes whether StoreKit / Play Billing are needed, and receipt validation is server work that isn't scoped here.
3. **Push notifications.** Budget alerts are the obvious use, and the `notifications` table exists — but FCM/APNs setup, token lifecycle and consent aren't yet specified.
