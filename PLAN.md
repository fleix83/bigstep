# Implementierungsplan für Claude Code – Tourenbuch

Bezieht sich auf PRD.md. Arbeite die Phasen strikt in Reihenfolge ab; jede Phase endet mit einem lauffähigen Zustand und einem Commit. Bei Unklarheiten: zuerst PRD.md konsultieren, dann nachfragen.

## Grundregeln für dieses Repo

- Monorepo mit pnpm workspaces:

```
tourenbuch/
  apps/
    desktop/        # Tauri 2 + React + Vite
    api/            # Cloudflare Worker, Hono
  packages/
    shared/         # Typen, Zod-Schemas, Wanderzeit-Formel, GPX-Utils
    ui/             # gemeinsame React-Komponenten (Desktop + PWA)
  drizzle/          # Migrations
  PRD.md
  PLAN.md
```

- TypeScript strict überall. Zod für alle API-Payloads, Typen aus `packages/shared` beziehen.
- **Secrets:** `DATABASE_URL` und `API_TOKEN` nur aus env (`.dev.vars` für Wrangler lokal, `.env` für Desktop-Dev). `.env*` und `.dev.vars` stehen in `.gitignore`. Lege `.env.example` mit leeren Platzhaltern an. Niemals einen Connection-String in Code, Doku oder Commits schreiben.
- Nach jeder Phase: `pnpm test && pnpm lint` grün, kurzer Eintrag in `CHANGELOG.md`.

---

## Phase 0 – Fundament

1. Monorepo initialisieren (pnpm, TypeScript-Basis-Config, ESLint, Prettier, Vitest).
2. `packages/shared`: Zod-Schemas für Tour, Card, Image gemäss PRD §6; Typen exportieren.
3. Drizzle einrichten (`drizzle-kit`), Schema gemäss PRD §6, erste Migration generieren.
4. Migration gegen Neon ausführen (DATABASE_URL aus env). Vorher prüfen, dass der Nutzer das Passwort rotiert hat; wenn keine Verbindung möglich, Phase mit Hinweis stoppen.
5. `gitleaks` (oder vergleichbar) als CI-/pre-commit-Check.

**Fertig wenn:** Tabellen existieren in Neon, `pnpm drizzle:push`/`migrate` reproduzierbar, kein Secret im Repo.

## Phase 1 – API (Cloudflare Worker, Hono)

1. Hono-App mit Bearer-Token-Middleware (Vergleich gegen `API_TOKEN`).
2. Neon-Anbindung über `@neondatabase/serverless` + Drizzle.
3. Endpunkte:
   - `GET /api/health`
   - `GET /api/tours` (ohne deleted, sortierbar), `POST /api/tours`, `PATCH /api/tours/:id`, `DELETE /api/tours/:id` (Soft-Delete)
   - `GET /api/tours/:id/cards`, `POST /api/cards`, `PATCH /api/cards/:id`, `DELETE /api/cards/:id`, `POST /api/cards/reorder`
   - `GET /api/settings`, `PUT /api/settings/:key`
4. Fehlerformat vereinheitlichen (`{ error: { code, message } }`), Zod-Validierung an jeder Schreibroute.
5. Vitest-Tests gegen lokalen Wrangler-Dev-Server; für DB-Tests einen Neon-Branch `test` verwenden.

**Fertig wenn:** CRUD per curl mit Token durchspielbar, Tests grün, `wrangler deploy` funktioniert.

## Phase 2 – Desktop-Shell

1. Tauri 2 + React + Vite in `apps/desktop`, Tailwind.
2. Zwei-Spalten-Layout: links Tourenliste (fixe Breite, scrollbar), rechts Content-Bereich mit Reitern "Karte" / "Book".
3. API-Client in `packages/shared` (fetch-Wrapper mit Token aus env/Settings-Dialog).
4. Tourenliste mit echten Daten: anlegen, umbenennen (Inline-Edit), löschen (Dialog), Status-Badge. Optimistic Updates mit Rollback bei Fehler.

**Fertig wenn:** PRD F1 vollständig erfüllt (Akzeptanzkriterien testen).

## Phase 3 – Karte

1. MapLibre GL JS einbinden. Basiskarte als Raster-Source:
   `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`
   Attribution "© swisstopo" konfigurieren (nicht abschaltbar).
2. **Zuerst Layer-IDs verifizieren:** WMTS-GetCapabilities laden und die exakten IDs + Bildformate für Wanderwege, ÖV-Haltestellen, Schneehöhe (SLF), Wildruhezonen ermitteln. Ergebnis als Konstanten-Datei mit Quellenkommentar ablegen. Existiert ein Layer nicht als WMTS: WMS versuchen; sonst Feature im UI ausblenden und in CHANGELOG vermerken.
3. Overlay-Panel (Checkboxen) für die vier Layer; Basiskarten-Umschalter Landeskarte/Luftbild.
4. Kartenzustand (Layer an/aus, letzte Position/Zoom) in `settings` persistieren, beim Start wiederherstellen.
5. Klick auf Touren-Tab: `fitBounds(tour.bbox, { padding: 48 })`; Route der aktiven Tour als GeoJSON-Layer hervorheben, übrige Touren optional schwach anzeigen (Toggle).

**Fertig wenn:** PRD F2 und F5 erfüllt.

## Phase 4 – GPX-Import/-Export

1. GPX-Parser/-Serializer in `packages/shared` (Tests mit Fixture-Dateien, inkl. Track mit Höhen und ohne).
2. Import-Dialog: Datei wählen, Vorschau auf Karte, Übernehmen erzeugt Tour mit Geometrie, bbox, Distanz; Höhenmeter über profile.json nachziehen (Phase-5-Funktion wiederverwenden, sonst vorerst leer).
3. Export: aktive Tour als GPX speichern (Tauri-Save-Dialog).

**Fertig wenn:** Runde Import→Export→Import verlustfrei bzgl. Geometrie.

## Phase 5 – Routen-Editor, Snapping, Kennzahlen

1. `RoutingProvider`-Interface in `packages/shared`:
   `route(from: [lon,lat], to: [lon,lat]): Promise<{ line: [lon,lat][], ok: boolean }>`
   Implementierung A: BRouter-Web-API mit Hiking-Profil. Implementierung B: `StraightLineProvider` (Fallback/Tests). Provider per Setting wählbar. Timeout 5 s, bei Fehler Luftlinie mit `ok:false` zurückgeben.
2. Zeichenmodus: Klick fügt Wegpunkt hinzu; Segment = Ergebnis von `route(prev, next)`. Segmente cachen (Key: beide Endpunkte gerundet), damit Undo/Redo keine neuen Requests auslöst.
3. Editieren: Wegpunkt-Drag (nur betroffene Segmente neu routen, bei Drag-Ende), Punkt einfügen auf Segment, Punkt löschen. `waypoints` und zusammengesetzte `geometry` getrennt im State und in der DB halten (PRD §6).
4. Undo/Redo-Stack (mind. 20 Schritte) über Wegpunkt-Snapshots.
5. Luftlinien-Segmente gestrichelt rendern.
6. Kennzahlen:
   - Distanz aus Geometrie (haversine, in `shared`, mit Tests).
   - Auf-/Abstieg über `profile.json` (POST, LineString; sr-Parameter beim ersten Aufruf austesten und Erkenntnis als Kommentar festhalten). Debounce 500 ms, nur nach abgeschlossener Änderung. Requests zählen und bei > 15/min clientseitig drosseln (PRD §7.1).
   - Wanderzeit-Formel in `shared` (PRD F3), Unit-Tests mit 3 Referenzfällen (flach, steil bergauf, bergab).
   - Leiste am unteren Kartenrand: km, ↑ m, ↓ m, Zeit.
7. Speichern: debounced PATCH auf die Tour (waypoints, geometry, Kennzahlen, bbox).

**Fertig wenn:** PRD-F3-Akzeptanzkriterien erfüllt; Editor übersteht Neuladen ohne Datenverlust.

## Phase 6 – Book-Reiter

1. Card-Grid mit Inline-Markdown-Editor (einfach halten: Textarea + Vorschau-Toggle), Titel, Datum.
2. Reihenfolge per Drag-and-drop, `position` via `POST /api/cards/reorder`.
3. Bild-Pipeline lokal in `apps/desktop` (Rust-Seite oder sharp im Node-Kontext, je nachdem was in Tauri 2 sauberer läuft; Entscheidung dokumentieren):
   - EXIF lesen (GPS, Aufnahmedatum) → `images.lat/lon/taken_at`.
   - HEIC → WebP konvertieren.
   - Ableitungen erzeugen: 2000 px WebP (display), 300 px WebP (thumb).
   - SHA-256 des Originals als Identität; Duplikat-Import erkennt bestehende `sha256` und verknüpft nur.
4. v1-Speicherung (vor R2): Ableitungen im App-Data-Ordner, Pfade lokal; `images.upload_state = 'pending'`. UI zeigt Bilder vom lokalen Pfad. **Kein Bytea in Postgres.**
5. Foto-Pins: Bilder mit GPS als Marker auf der Karte der Tour; Klick auf Pin öffnet Card.

**Fertig wenn:** PRD F4 erfüllt inkl. 10×5-MB-Importtest; EXIF-Pins erscheinen korrekt.

## Phase 7 – Mobile-PWA (read-only)

1. `apps/desktop` so strukturieren, dass die React-App auch ohne Tauri baut (Vite-Target `web`); gemeinsame Komponenten nach `packages/ui` ziehen, wo sinnvoll.
2. Responsive Layout: < 768 px → Tourenliste als Startscreen, Tour öffnet Reiter Karte/Book; alle Editier-Controls hinter einem `readOnly`-Flag entfernt (nicht nur versteckt: Komponenten rendern sie nicht).
3. Token-Eingabe beim ersten Start, Ablage in localStorage.
4. PWA-Manifest + Service Worker (nur App-Shell cachen, keine Kacheln, keine API-Responses).
5. Auslieferung über den Worker (statische Assets) oder Cloudflare Pages; gleiche Origin wie API bevorzugen (kein CORS-Thema).

**Fertig wenn:** PRD F6 erfüllt; Lighthouse-PWA-Check besteht.

## Phase 8 – Cloudflare R2

1. R2-Bucket + Binding im Worker (`wrangler.toml`).
2. Endpunkte: `PUT /api/images/:sha256/:variant` (Worker schreibt nach R2), `GET /api/images/:sha256/:variant` (Worker liest aus R2, Cache-Header setzen). Auth wie übrig.
3. Desktop-Upload-Queue: alle `upload_state='pending'`-Bilder hochladen (display + thumb), bei Erfolg `r2_key_*` setzen, `upload_state='uploaded'`; Retry mit Backoff, Status-Anzeige im UI.
4. PWA lädt Bilder ausschliesslich über die GET-Route (thumb im Grid, display im Detail).
5. Cleanup-Kommando (Script): R2-Objekte ohne DB-Referenz auflisten/löschen.

**Fertig wenn:** Neues Bild auf dem Desktop erscheint ohne weiteres Zutun in der PWA; Abbruch mitten im Upload hinterlässt keinen inkonsistenten Zustand.

---

## Offene Entscheidungen (bei Erreichen klären, nicht vorziehen)

- Schneehöhe-Layer: exakte Quelle/ID (Phase 3, Schritt 2).
- BRouter vs. GraphHopper als Routing-Default (Phase 5, nach kurzem Praxisvergleich auf 3 Testrouten dokumentieren).
- Bildverarbeitung Rust- oder JS-seitig (Phase 6).

## Explizit ausserhalb dieses Plans

- Eigener Routing-Dienst auf swissTLM3D (pgRouting) – erst nach v1 evaluieren.
- Offline-Kachelcache, Multi-User, App-Store-Builds.
