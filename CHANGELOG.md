# Changelog

## Phase 1 – API (2026-08-31)

- `apps/api`: Cloudflare Worker mit Hono; alle `/api/*`-Routen hinter Bearer-Token (timing-safe Vergleich gegen `API_TOKEN`).
- Endpunkte gemäss Plan: Health, Tours-CRUD (Soft-Delete inkl. Cards), Cards-CRUD + `POST /api/cards/reorder` (eine atomare UPDATE-Anweisung), Settings GET/PUT (Upsert).
- Einheitliches Fehlerformat `{ error: { code, message } }`; Zod-Validierung an allen Schreibrouten; `deleted_at` erscheint nie in Antworten.
- Neon-Anbindung via `@neondatabase/serverless` + Drizzle (`neon-http`, pro Request).
- 21 Vitest-Tests gegen den Neon-Branch `test` (`TEST_DATABASE_URL` aus `.env`; ohne die Variable werden DB-Tests übersprungen). Abweichung vom Plan: Tests treffen die Hono-App direkt über `app.request()` statt über einen laufenden `wrangler dev`-Server – gleicher Code-Pfad, deutlich stabiler.
- `wrangler deploy --dry-run` erfolgreich (Bundle 223 KiB gzip). Echtes Deploy braucht einmalig `wrangler login` (offener Punkt für den Nutzer).

## Phase 0 – Fundament (2026-08-31)

- Monorepo mit pnpm-Workspaces (`apps/*`, `packages/*`), TypeScript strict, ESLint (flat config) + Prettier, Vitest.
- `packages/shared`: Zod-Schemas und Typen für Tour, Card, Image, Settings gemäss PRD §6 (inkl. Create-/Update-/Reorder-Payloads); 11 Unit-Tests.
- Drizzle-Schema in `packages/shared/src/db/schema.ts`, `drizzle-kit`-Config an der Wurzel; erste Migration `drizzle/0000_cheerful_patch.sql` generiert und gegen Neon (Projekt „Bigstep", Branch `main`) ausgeführt – Tabellen `tours`, `cards`, `images`, `settings` existieren.
- Secrets nur in `.env` (gitignored); `.env.example` ohne Werte. Hinweis: Das Neon-Projekt „Bigstep" wurde am 31.08.2026 frisch angelegt, die Credentials sind neu; der im PRD erwähnte alte Connection-String gehört zu keinem aktiven Projekt mehr.
- gitleaks 8.30.1 als Pre-Commit-Hook (`.githooks/pre-commit`, aktiviert via `core.hooksPath`) und als CI-Job (GitHub Actions).
