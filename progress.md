# SpendWise Project Progress Tracker

This document tracks the live implementation status, completed achievements, current activities, and future roadmap of the **SpendWise** secure, offline-first personal finance application.

---

## 📊 High-Level Status

- **Current Phase**: Phase 3 — Central Backend Development (Phases 1–2 complete)
- **Architecture Type**: Local-First / Sync-Enabled (Offline-First)
- **Deployment Model**: Cost-Optimized Single-Droplet ($6–$12/mo) + Cloudflare
- **Overall Progress**: 70% (Architecture done; monorepo, database, auth tokens and sync engine built and tested)

---

## 🚀 Active Focus

Phase 3 backend is substantially complete: schema, RLS, tokens, identity, sync and auth endpoints are built and tested (107 server tests, 22 against live PostgreSQL). Remaining: Redis, audit logging, TOTP, magic-link delivery.

---

## 🗺️ Detailed Roadmap & Task Checklist

### Phase 1: Architecture & Planning (COMPLETED)
- [x] Create comprehensive production-ready offline-first architecture design → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [x] Define entity database schemas (users, categories, transactions, audit logs).
- [x] Design sync-engine logic & Last-Write-Wins (LWW) conflict resolution.
- [x] Formulate high-security boundaries (Argon2id, RTR, HTTPS/TLS, Rate limits).
- [x] Adapt infrastructure to a single $6–$12 DigitalOcean droplet with Cloudflare.
- [x] Create the `progress.md` tracking file.

### Phase 2: Monorepo Scaffolding (COMPLETED)
- [x] Initialize standard PNPM Workspace monorepo root structure.
- [x] Configure `libs/shared-types` for shared DTOs and validation schemas.
- [x] Set up `apps/server` (NestJS skeleton with TypeScript).
- [x] Set up `apps/client` (Ionic React skeleton with Capacitor configuration).

**Verification:** 63 tests passing (49 shared-types, 14 server), all three packages
typecheck under full TypeScript strictness, server boots and serves `/v1/health`
with security headers, client builds to 60.74 kB gzipped (budget: 200 kB).

### Phase 3: Central Backend Development (IN PROGRESS)
- [x] PostgreSQL schema, monthly partitioning, and indexes (`migrations/001_init.sql`).
- [x] Row-Level Security with a release gate (`002_rls.sql`, `scripts/rls-gate.sh`).
- [x] JWT authentication with Refresh Token Rotation and reuse detection.
- [x] Deny-by-default `AuthGuard` with an explicit `@Public()` opt-out.
- [x] Sync push/pull service: idempotency, conflict detection, clock-skew
      correction, server-authoritative FX.
- [x] Sync controller wired and verified end-to-end over HTTP.
- [x] Identity resolution and account linking (verified-email only) + `PgSessionStore`.
- [x] OIDC ID-token verification (Google, Apple) with full claim validation.
- [x] Phone OTP with attempt limits, abuse limits and an SMS spend ceiling.
- [x] Auth endpoints wired and verified over HTTP.
- [ ] Optional TOTP enrolment; email magic-link delivery.
- [x] PostgreSQL sync repository behind `Db.withUser`, so every query runs
      inside the tenant's RLS transaction context (9 integration tests).

- [ ] Redis: rate limiting, session denylist, BullMQ queues.
- [ ] Partitioned audit logging wired to mutations.

**Note:** auth no longer uses TypeORM or Argon2 — the passwordless federated
design (ARCHITECTURE §9.1) removed password storage entirely, and repositories
are plain interfaces so the persistence layer can be swapped without touching
security-critical logic.

### Phase 4: Local-First Frontend Development (PENDING)
- [ ] Reorganize existing `index.html` prototype views into React page components.
- [ ] Establish Zustand state management store.
- [ ] Implement IndexedDB Local Storage adapter (Web target via Dexie).
- [ ] Implement SQLite Local Storage adapter (Mobile targets via Capacitor SQLite).
- [ ] Build the client-side background `SyncEngine` with network state listeners.
- [ ] Integrate dark mode, responsive styling, and low-end device optimizations.

### Phase 5: Single-Droplet Orchestration & Security (PENDING)
- [ ] Write optimized Dockerfiles and `docker-compose.yml` for unified single-droplet hosting.
- [ ] Configure Nginx reverse proxy with SSL, compression, and HTTP security headers.
- [ ] Implement automated cron-job database backups to encrypted off-host locations.
- [ ] Configure Cloudflare DNS, SSL Full Strict, WAF, Bot Protection, and Edge Cache.

### Phase 6: CI/CD & Production Release (PENDING)
- [ ] Configure GitHub Actions workflows for continuous build testing and zero-downtime deployment.
- [ ] Execute rigorous security auditing (OWASP top-10 scans, SQLi/XSS validation).
- [ ] Deploy live site under `api.domain.com` and publish web application client.
- [ ] Compile Android (.apk/.aab) and iOS (.ipa) builds via Capacitor CLI.

---

## 📓 Release Log & Milestones

### August 7, 2026
- **Architecture Blueprint**: Designed a robust, production-ready, local-first architecture using Ionic + Capacitor, NestJS, PostgreSQL, Redis, and Cloudflare.
- **Droplet Refactoring**: Redesigned deployment topology to pack all services onto a single, high-performance, cost-optimized droplet using containerized network isolation.
- **Trackers Activated**: Created the `progress.md` tracking file to log the end-to-end development cycle.
- **Branching**: Created and published the `development` branch as the integration target for Phase 2 onward.
- **Architecture Document**: Wrote `docs/ARCHITECTURE.md` — the full 20-section blueprint covering folder structure, DB schema, API design, auth flow, sync protocol and conflict resolution, Docker/Nginx topology, Cloudflare configuration, CI/CD, monitoring, backup/recovery, cost estimates and the security checklist. Records four open decisions needing an answer before Phase 3 (currency scope, Open Banking, household sharing, data residency).
