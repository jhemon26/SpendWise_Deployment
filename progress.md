# SpendWise — Progress

New here? Read [`START-READING-HERE.md`](START-READING-HERE.md) first.

**Last updated:** 7 August 2026
**Branch:** `development`
**Tests:** 276 passing — 49 shared-types, 121 server, 106 client
**Build:** all three packages typecheck under full strictness; client 106 kB gzipped

---

## Where we are

```
Phase 1  Architecture .................. ████████████ done
Phase 2  Monorepo scaffold ............. ████████████ done
Phase 3  Backend ....................... ██████████░░ ~85%
Phase 4  Client ........................ █████████░░░ ~75%
Phase 5  Infrastructure ................ ░░░░░░░░░░░░ not started
Phase 6  CI/CD & store release ......... ░░░░░░░░░░░░ not started
```

**Overall: roughly 60% of the way to something shippable.** The backend is the
mature part. The client records, persists and syncs — but there are no auth
screens, so nothing signs in yet, and nothing has been deployed to DigitalOcean.

> An earlier version of this file said "80%". That counted the backend as the
> whole project. It is not — the infrastructure does not exist at all, and the
> client still cannot reach the API.

---

## Phase 1 — Architecture ✅

- [x] [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 20 sections: folder structure,
      schema, API, auth flow, sync protocol, conflict resolution, Docker/Nginx,
      Cloudflare, CI/CD, monitoring, backup, costs, security checklist
- [x] Capacity model for 10k daily active users (§15.1)
- [x] All seven open decisions resolved with the project owner (§20)

---

## Phase 2 — Monorepo ✅

- [x] pnpm workspace, TypeScript strict everywhere
- [x] `libs/shared-types` — dual CJS/ESM, imported by both ends
- [x] `apps/server` — NestJS
- [x] `apps/client` — Ionic/Capacitor + React + Vite

---

## Phase 3 — Backend (~85%)

**Done**

- [x] Schema, monthly partitioning, indexes — `001_init.sql`
- [x] Row-Level Security + `spendwise_app` role — `002_rls.sql`
- [x] Pre-auth lookup functions — `003_auth_lookups.sql`
- [x] **RLS release gate** — `scripts/rls-gate.sh`, 10 cross-tenant checks
- [x] JWT access tokens + refresh rotation with **reuse detection**
- [x] Deny-by-default `AuthGuard` with explicit `@Public()` opt-out
- [x] Identity resolution and account linking (verified email only)
- [x] OIDC ID-token verification — Google and Apple, full claim validation
- [x] Phone OTP — attempt limits, abuse limits, SMS spend ceiling
- [x] Sync push/pull — idempotency, conflicts, clock skew, server-authoritative FX
- [x] PostgreSQL repositories wired into the running server
- [x] Redis-backed OTP store — sliding windows, survives restart
- [x] Append-only audit logging
- [x] **HttpOnly refresh cookie** for browsers — SameSite=Strict, scoped to
      `/v1/auth`; the token is withheld from the response body unless the client
      declares itself native

**Left**

- [ ] Email magic-link and SMS **delivery transports** (logic is done and tested;
      needs an SES/Twilio adapter and credentials)
- [ ] Optional TOTP enrolment
- [ ] Redis session denylist for immediate access-token revocation
- [ ] BullMQ queues
- [ ] Audit logging on auth events (currently only on sync mutations)
- [ ] Per-user envelope encryption — `dek_wrapped` exists and is populated with a
      placeholder; the KEK wrapping is not implemented
- [ ] Live OIDC round trip against real Google/Apple credentials
      *(verified only against an injected JWKS so far)*

---

## Phase 4 — Client (~75%)

**Done**

- [x] `StorageAdapter` interface + `MemoryAdapter`
- [x] Zustand store as a cache over the adapter
- [x] Client sync engine — push-before-pull, batching, jittered backoff
- [x] Pure selectors — the prototype's `derive()`, now tested
- [x] Design system — tokens, 32 icons, gauge with cap compensation
- [x] Five screens rendering real derived data
- [x] Demo seed so the app is never blank

**Recently done**

- [x] **Add / edit transaction sheet** — FAB to add, tap a row to edit, delete,
      with the live impact preview
- [x] **Dexie/IndexedDB adapter**, behind a shared contract suite run against
      *both* adapters, plus a timeout-and-degrade opener so unavailable storage
      can never hang the app
**Left**

- [ ] Category and bank editors
- [x] **`SyncTransport` over HTTP** — bearer auth, single-flight refresh on 401,
      health probe, responses validated against the shared schema
- [x] **Client ↔ server verified end to end** — the real client stack pushes a
      locally-created transaction to the real API and it lands in Postgres
- [ ] **Verify Dexie against a real browser.** It passes 29 contract tests under
      fake-indexeddb, but headless Chrome in this environment would not complete
      IndexedDB operations, so a real-browser run is still outstanding
- [ ] Capacitor SQLite adapter — native
- [ ] Connectivity detection (Capacitor Network / `navigator.onLine`)
- [x] **Auth screens and session restore** — passwordless sign-in UI, phone OTP
      flow end to end, and the cookie-for-token exchange that keeps a session
      alive across a reload. Sync starts automatically once signed in
- [ ] Real Google/Apple buttons — the UI is there but disabled until OAuth
      client IDs are configured
- [ ] Onboarding: welcome, setup wizard, coach marks (§3.5)
- [ ] Light theme is defined in tokens but has no toggle

---

## Phase 5 — Infrastructure ⬜ not started

- [ ] Dockerfiles and `docker-compose.yml`
- [ ] Nginx reverse proxy, TLS, blue/green
- [ ] DigitalOcean droplet (LON1)
- [ ] Cloudflare DNS, Full Strict, WAF, firewall restricted to Cloudflare IPs
- [ ] Encrypted backups to Spaces + a rehearsed restore

---

## Phase 6 — CI/CD & release ⬜ not started

- [ ] GitHub Actions: lint, test, scan, build, deploy
- [ ] Zero-downtime deploy + rollback
- [ ] Monitoring: Loki, Prometheus, Sentry, UptimeRobot
- [ ] Capacitor Android/iOS builds and store submission
- [ ] Security audit against the §18 checklist

---

## Known issues

| # | Issue | Impact |
|---|---|---|
| 1 | **Pages Actions workflow is dormant** — `total_count: 0`, not firing on push | Live site is published by the legacy branch builder instead. Needs repo-settings access; likely Pages source is still "Deploy from a branch" |
| 2 | **App icons are the old teal wallet** | Off-brand against the indigo/cyan UI. A new logo was supplied but it is a horizontal lockup with text — unusable as an icon without extracting the mark |
| 3 | **Logo palette conflicts with the app** | Logo is pink on dark purple; UI is indigo/cyan/violet. One of them has to move |
| 4 | **Dexie unverified in a real browser** | Contract tests pass under fake-indexeddb; headless Chrome could not complete IndexedDB here. Open it in Chrome/Safari and confirm data survives a refresh |

---

## Decisions log

| Date | Decision |
|---|---|
| 7 Aug 2026 | Multi-currency from v1 |
| 7 Aug 2026 | No Open Banking — stays outside FCA regulation |
| 7 Aug 2026 | Passwordless auth only: Google, Apple, phone OTP, email magic link |
| 7 Aug 2026 | Per-user RLS **and** envelope encryption |
| 7 Aug 2026 | UK / LON1; UK GDPR obligations documented |
| 7 Aug 2026 | Zustand for state |
| 7 Aug 2026 | Prototype stays in-memory; persistence arrives with the native build |
| 7 Aug 2026 | Launch on 4 vCPU / 8GB, scale the droplet vertically as users grow |

**Still open:** household/shared budgets, App Store business model, push notifications.

---

## Notable corrections

Kept deliberately — a wrong belief left in place costs more than the admission.

- **`ARCHITECTURE.md` §9.2** claimed `USING` without `WITH CHECK` allows forging
  rows for another user. False: Postgres reuses `USING` as the write check.
  Verified against PG16 and corrected in place.
- **Argon2id was specified, then removed entirely.** Passwordless auth deleted
  the memory-exhaustion DoS that had required a semaphore to contain it.
- **Two test suites were passing without testing anything** — one skipped every
  case while reporting success, one exercised a control that was not the control
  it claimed. Both found by deliberately breaking the implementation.
- **The cost estimate moved from $6–12/mo to ~$78/mo** once SMS, snapshots,
  Spaces and ICO registration were counted honestly.
