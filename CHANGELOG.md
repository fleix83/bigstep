# Changelog

## Phase 4 – GPX-Import/-Export (2026-08-31)

- `packages/shared`: GPX-Parser/-Serializer (`gpx.ts`, fast-xml-parser) für Tracks (1.0/1.1, mehrere Segmente werden aneinandergehängt) mit `<rte>`-Fallback; Geo-Helfer (`geo.ts`): Haversine-Distanz, bbox, Auf-/Abstieg aus GPX-Höhen (3-m-Schwelle gegen GPS-Rauschen). 12 neue Tests mit Fixtures (mit/ohne Höhen, nur Route, Fehlerfälle); Roundtrip parse→serialize→parse verlustfrei.
- Import-Dialog im Desktop: Datei wählen, gestrichelte orange Vorschau auf der Karte (Dialog ohne Backdrop, fitBounds auf die Vorschau), Name editierbar (Vorbelegung aus Trackname bzw. Dateiname), Kennzahlen-Anzeige; Übernehmen legt die Tour mit Geometrie, bbox, Distanz und – falls Höhen vorhanden – Auf-/Abstieg an. Wanderzeit folgt in Phase 5 (profile.json).
- Export der aktiven Tour als GPX 1.1: in der Tauri-App über den nativen Save-Dialog (`tauri-plugin-dialog` + `tauri-plugin-fs`, per `cargo check` verifiziert), im Browser/PWA als Download. Export-Inhalt im Browser E2E verifiziert: identische Koordinaten und Höhen wie die Quelldatei.

## Phase 3 – Karte (2026-08-31)

- `apps/desktop`: MapLibre GL JS mit swisstopo-WMTS-Basiskarten (Landeskarte `ch.swisstopo.pixelkarte-farbe`, Luftbild `ch.swisstopo.swissimage`), Attribution «© swisstopo» dauerhaft sichtbar (nicht kollabierbar).
- Layer-IDs am 2026-08-31 gegen das WMTS-GetCapabilities (EPSG:3857) verifiziert und in `apps/desktop/src/lib/geo-layers.ts` als Konstanten mit Quellenkommentar abgelegt: Wanderwege `ch.swisstopo.swisstlm3d-wanderwege` (png, z18), ÖV-Haltestellen `ch.bav.haltestellen-oev` (png, z18), Wildruhezonen `ch.bafu.wrz-wildruhezonen_portal` (png, z18).
- **Schneehöhe (SLF) gestrichen:** Der Layer existiert weder im geoadmin-WMTS noch im geoadmin-WMS (`wms.geo.admin.ch`, geprüft: keine Treffer für «schnee»/«slf»/«snow» ausser Schneeschuhrouten) noch im öffentlichen SLF-WMTS (`map.slf.ch`, nur Terrain-/Pisten-/Hangneigungs-Layer). Das Overlay-Panel zeigt darum nur drei Overlays; Wiederaufnahme, falls ein öffentlicher Dienst auftaucht.
- Overlay-Panel (Checkboxen) + Basiskarten-Umschalter; Kartenzustand (Basiskarte, Overlays, Position/Zoom, «Andere Touren») wird debounced in `settings.map_state` persistiert und beim Start wiederhergestellt.
- Tourwechsel: `fitBounds` auf die gespeicherte bbox (Padding 48, maxZoom 15); aktive Route als blaue Linie mit weissem Casing, übrige Touren optional grau zuschaltbar; Tour ohne Geometrie zeigt «Noch keine Route».

## Phase 2 – Desktop-Shell (2026-08-31)

- `apps/desktop`: Tauri-2-App (Vite + React + Tailwind + TanStack Query), Zwei-Spalten-Layout mit Tourenliste links und Reitern «Karte»/«Book» rechts.
- Tourenliste gemäss PRD F1: Anlegen (öffnet Inline-Edit), Umbenennen per Doppelklick, Status-Badge geplant/gemacht, Löschen mit Bestätigungsdialog, Sortierung zuletzt-geändert oder A–Z; Optimistic Updates mit Rollback.
- Settings-Dialog für API-URL/-Token (localStorage, Vorbelegung aus `VITE_API_URL`/`VITE_API_TOKEN`).
- `packages/shared`: typisierter `ApiClient` (fetch + Zod-Validierung der Antworten), gedacht für Desktop und spätere PWA.
- API: CORS-Middleware auf `/api/*` (Desktop-Webview läuft auf anderer Origin; Zugriffsschutz bleibt beim Bearer-Token).

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
