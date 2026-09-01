# Changelog

## Phase 8 – Cloudflare R2 (2026-09-01)

- R2-Binding «topos» im Worker; Keys content-addressed (`images/<sha256>/<display|thumb>`) — PUTs idempotent, ein abgebrochener Upload hinterlässt keinen inkonsistenten Zustand.
- Endpunkte: `PUT/GET /api/images/:sha256/:variant` (Auth wie übrig; GET mit `Cache-Control: private, max-age=1y, immutable`, Content-Type aus R2), `GET /api/images[?state=…]` für die Upload-Queue (Bilder soft-gelöschter Cards ausgenommen), `POST /api/admin/r2-cleanup` (Dry-Run default, `?dry=0` löscht Waisen); Bild-DELETE entsorgt die R2-Objekte mit. 5 neue Tests mit In-Memory-R2-Mock (32 API-Tests).
- Desktop-Upload-Queue (`useUploadQueue`): lädt alle pending-Bilder hoch (display + thumb), setzt danach `r2_key_*` und `upload_state='uploaded'`; Retry mit exponentiellem Backoff pro Bild, Poll alle 30 s, Status-Badge im Header («☁︎ lädt hoch …»). Geräte ohne lokale Ableitungen überspringen fremde pending-Bilder.
- Anzeige (`resolveImageUrls`): zuerst lokale Ableitungen, sonst authentifiziert aus R2 — damit erscheinen Bilder in der PWA und auf Zweitgeräten; Foto-Pins nutzen denselben Weg. E2E verifiziert: Desktop lädt hoch, die PWA (frische Origin, leeres OPFS) zeigt alle Bilder ohne weiteres Zutun.
- Bewusst NICHT verwendet: die öffentliche r2.dev-Bucket-URL — sie würde alle Fotos ungeschützt ins Netz stellen und ist laut Cloudflare nicht für Produktion gedacht; die Auslieferung bleibt hinter dem Bearer-Token. Empfehlung: Public Access am Bucket deaktivieren.
- Deployment vorbereitet (Assets + Worker + R2 in einer wrangler.toml); ausstehend nur `wrangler login`, `wrangler secret put DATABASE_URL/API_TOKEN`, `wrangler deploy`.

## Karten-Features: Ortssuche, Vollbild, Standort (2026-09-01)

- Ortssuche in der Karte (Desktop + Mobile): GeoAdmin SearchServer (`type=locations`, sr=4326 — am 2026-09-01 verifiziert), debounced ab 2 Zeichen, Dropdown mit Objekttyp, Tastatur-Navigation; Auswahl fliegt die Karte an und setzt einen 📍-Pin.
- Vollbild-Modus (⛶ auf der Karte): blendet Topbar, Tourenliste und Reiter aus — auf mobile füllt die Karte den ganzen Viewport; ✕ oder Escape verlässt das Vollbild.
- Kartenoptionen-Panel einklappbar (▤); auf Smartphones startet es eingeklappt («möglichst viel Karte»).
- Standort-Button unten rechts (MapLibre GeolocateControl, High-Accuracy, Follow-Modus mit Puck und Genauigkeitskreis) — v. a. für die mobile PWA; braucht Secure Context und einmalige Standort-Freigabe.
- Tourenliste: geschätzte Wanderzeit als dritter Kennwert (🕓 neben km und ↑ m).

## Phase 7 – Mobile-PWA read-only (2026-09-01)

- Gleiche React-Codebasis für Desktop und PWA (kein separates `packages/ui` nötig — die App baut ohnehin ohne Tauri; Entscheid statt PLAN 7.1-Auslagerung).
- `useReadOnly` (Smartphone-Viewport < 768 px ausserhalb der Tauri-App): sämtliche Editier-Controls werden **nicht gerendert** — Tour anlegen/umbenennen/löschen, Status-Toggle, GPX-Import/-Export, Routen-Editor, Card-Erstellen/-Editieren/-Löschen, Bild-Upload und -Löschen. Karte, Overlays, Kennzahlen, Cards und Lightbox bleiben.
- Responsive: unter 768 px ist die Tourenliste der Startscreen; eine Tour öffnet Karte/Book mit «‹ Touren»-Zurück-Navigation.
- Token-Einrichtung: Settings-Dialog mit same-origin-Vorbelegung (die PWA kommt vom selben Worker wie die API); Ablage in localStorage. `apps/desktop/.env.production` (leer, committet) verhindert, dass Dev-URL/-Token in den Build eingebacken werden.
- PWA: Manifest (Icons 192/512 + maskable, standalone), Service Worker cached nur die App-Shell (Navigationen network-first, gehashte Assets cache-first) — nie `/api/*`, nie Cross-Origin (Kacheln/BRouter/GeoAdmin); Registrierung nur im Prod-Build ausserhalb Tauris.
- Auslieferung über den Worker: `[assets]` in wrangler.toml (SPA-Fallback, `run_worker_first = ["/api/*"]`) — gleiche Origin wie die API, kein CORS-Thema. Vorher `pnpm --filter @tourenbuch/desktop build`.
- Verifiziert (Chrome-Device-Emulation 390×844 gegen den Worker): Vollbild-Liste ohne Editier-UI, Detail mit Zurück-Navigation, Book read-only, SW aktiv und kontrollierend, Manifest ok; Lighthouse (mobile): Accessibility 97, Best Practices 96 — die frühere Lighthouse-PWA-Kategorie existiert seit LH 12 nicht mehr, die Installierbarkeits-Kriterien sind einzeln geprüft. Bilder in der PWA zeigen «nicht lokal», bis der R2-Sync (Phase 8) sie geräteübergreifend verfügbar macht (OPFS/App-Data sind origin- bzw. gerätegebunden).

## Phase 6 – Book-Reiter (2026-08-31)

- API: Images-Endpunkte (`GET /api/tours/:id/images`, `POST/PATCH/DELETE /api/images`) — nur Metadaten, kein Bytea; Duplikat-Import (gleiche sha256) liefert die bestehende Zeile (200) statt einer zweiten. 6 neue API-Tests (jetzt 27).
- **Pipeline-Entscheid (PLAN 6.3):** Verarbeitung im Webview (Canvas + exifr) statt Rust — gleicher Code für Tauri-Webview, Dev-Browser und spätere PWA, keine nativen Encoder-Abhängigkeiten. SHA-256 des Originals als Identität, EXIF (GPS + DateTimeOriginal) via exifr, EXIF-Rotation beim Decodieren, Ableitungen 2000 px + 300 px als WebP (Chromium). **Abweichung:** WKWebView (Tauri macOS) encodiert kein WebP → JPEG-Ableitungen als Fallback; HEIC wird per lazy geladenem heic2any (libheif-wasm) vorkonvertiert.
- Ablage der Ableitungen: Tauri-App im App-Data-Ordner `images/` (plugin-fs, Anzeige übers Asset-Protokoll), Dev-Browser/PWA im OPFS mit Blob-URLs; Dateiname = `sha256_display|thumb.ext`.
- BookView: Card-Grid («+ Neue Card», Titel/Datum inline, Markdown-Notizen mit Klick-zum-Bearbeiten und gerenderter Vorschau via marked + DOMPurify), Cards-Reihenfolge per Drag-and-drop (`POST /api/cards/reorder`, optimistisch), Card-Löschen mit Bestätigung, Bild-Upload per Dateidialog und Drag-and-drop, Lightbox.
- Foto-Pins: Bilder mit GPS erscheinen als Thumb-Marker auf der Karte; Klick öffnet den Book-Reiter und scrollt zur Card.
- E2E verifiziert: EXIF-GPS/-Datum korrekt extrahiert (Pins sitzen exakt), 10 Bilder à 5 MB am Stück importiert bei bedienbarer UI, Cards samt Bildern nach Reload wieder da (F4-Akzeptanz).

## Phase 5 – Routen-Editor, Snapping, Kennzahlen (2026-08-31)

- `packages/shared`: `RoutingProvider`-Interface mit `BRouterProvider` (BRouter-Web-API, Profil `hiking-mountain` — am 2026-08-31 auf brouter.de verifiziert, BRouter 1.7.10; CORS offen; Timeout 5 s, bei Fehler Luftlinie mit `ok:false`) und `StraightLineProvider`; `concatSegments`; Wanderzeit-Formel `hikingTimeMin` (4.2 km/h, 300/500 Hm/h, grösserer Wert + halber kleinerer) mit drei Referenzfall-Tests; `wgs84ToLv95` (swisstopo-Näherungsformeln, < 2 m am Bern-Referenzpunkt). 10 neue Tests.
- **profile.json-Erkenntnis:** akzeptiert nur `sr=2056/21781` — WGS84 wird mit HTTP 400 abgelehnt; darum LV95-Transformation clientseitig. Höhenabfrage debounced (500 ms nach Änderungsende), clientseitig auf 15 Requests/min gedrosselt, lange Routen auf ≤ 500 Stützpunkte ausgedünnt.
- Desktop-Routen-Editor (`useRouteEditor` + MapView-Integration): Klick hängt Wegpunkt an (Segment via Routing), Klick auf die Linie fügt Punkt im Segment ein, Marker-Drag routet nur die zwei betroffenen Segmente neu (bei Drag-Ende), Rechtsklick löscht; Segment-Cache (gerundete Endpunkte) verhindert Requests bei Undo/Redo; Undo/Redo-Stack über Wegpunkt-Snapshots (30 Schritte); Luftlinien-/Fehlersegmente gestrichelt; Snapping-Schalter (persistiert in `settings.routing`); Mutationen laufen durch eine Queue, damit schnelle Klicks sich nicht überholen.
- Kennzahlen-Leiste unten in der Karte (km, ↑ m, ↓ m, Wanderzeit) — im Editor live, sonst gespeicherte Werte; debounced PATCH (waypoints, geometry, bbox, Kennzahlen) mit Dedupe gegen redundante Writes; Editor übersteht Neuladen ohne Datenverlust (E2E verifiziert).
- Browser-Fallstrick behoben: `this.fetchImpl = fetch` ruft fetch mit falschem `this` auf («Illegal invocation») — Wrapper-Funktion statt Direktzuweisung.

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
