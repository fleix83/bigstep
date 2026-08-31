# Changelog

## Phase 0 – Fundament (2026-08-31)

- Monorepo mit pnpm-Workspaces (`apps/*`, `packages/*`), TypeScript strict, ESLint (flat config) + Prettier, Vitest.
- `packages/shared`: Zod-Schemas und Typen für Tour, Card, Image, Settings gemäss PRD §6 (inkl. Create-/Update-/Reorder-Payloads); 11 Unit-Tests.
- Drizzle-Schema in `packages/shared/src/db/schema.ts`, `drizzle-kit`-Config an der Wurzel; erste Migration `drizzle/0000_cheerful_patch.sql` generiert und gegen Neon (Projekt „Bigstep", Branch `main`) ausgeführt – Tabellen `tours`, `cards`, `images`, `settings` existieren.
- Secrets nur in `.env` (gitignored); `.env.example` ohne Werte. Hinweis: Das Neon-Projekt „Bigstep" wurde am 31.08.2026 frisch angelegt, die Credentials sind neu; der im PRD erwähnte alte Connection-String gehört zu keinem aktiven Projekt mehr.
- gitleaks 8.30.1 als Pre-Commit-Hook (`.githooks/pre-commit`, aktiviert via `core.hooksPath`) und als CI-Job (GitHub Actions).
