# PRD: Tourenbuch – Tourenverwaltung mit swisstopo-Karten

Version 1.0 · Stand: 31.08.2026 · Autor: Felix Weissheimer

---

## 1. Vision

Eine persönliche Desktop-App zum Verwalten, Planen und Archivieren von Wandertouren auf Basis der amtlichen swisstopo-Karten, ergänzt durch eine Mobile-Ansicht (read-only) zum Anschauen unterwegs. Die App dient als Tourenarchiv und Inspirationsbuch: Routen zeichnen mit Snapping auf das Wanderwegnetz, Kennzahlen (Distanz, Höhenmeter, Wanderzeit) automatisch berechnen, pro Tour Bilder und Notizen als Cards sammeln.

## 2. Nutzer und Rahmen

- **Ein einziger Nutzer** (Single-User). Kein Registrierungs-Flow, keine Rollen.
- Desktop: macOS/Windows/Linux (Tauri 2).
- Mobile: read-only, als PWA im Browser (kein App-Store, keine nativen Builds in v1).
- Sprache der UI: Deutsch.

## 3. Nicht-Ziele (v1)

- Kein Multi-User, kein Sharing, keine Kommentare.
- Kein Offline-Modus mit Kachel-Cache (später evaluierbar).
- Kein Bearbeiten von Routen oder Cards auf Mobile.
- Kein Import aus der swisstopo-App via API (existiert nicht; nur manueller GPX-Import).
- Keine eigene Routing-Infrastruktur (pgRouting/swissTLM3D) in v1, siehe 7.3.

## 4. Features

### F1 – Tourenliste (linke Spalte)

- Vertikale Tab-Liste aller Touren, sortiert nach `updated_at` (neuste oben), umschaltbar auf alphabetisch.
- Tour **erstellen** (Button "+ Neue Tour"): legt leere Tour an, Name inline editierbar, Karte springt in den Zeichenmodus.
- Tour **umbenennen** (Doppelklick oder Kontextmenü).
- Tour **löschen** mit Bestätigungsdialog. Löschen entfernt Tour, Cards und Bildreferenzen (Soft-Delete in DB, `deleted_at`; Hard-Delete der R2-Objekte in einem späteren Cleanup-Job).
- Jeder Tab zeigt: Name, Distanz, Höhenmeter, Status-Badge (geplant / gemacht).
- **Akzeptanz:** CRUD funktioniert vollständig über die API; nach jedem Vorgang ist die Liste ohne Reload konsistent.

### F2 – Karte (rechte Spalte, Reiter "Karte")

- MapLibre GL JS mit swisstopo-WMTS als Basiskarte:
  - Basis: `ch.swisstopo.pixelkarte-farbe` (Landeskarte).
  - Umschaltbar auf `ch.swisstopo.swissimage` (Luftbild).
- **Zuschaltbare Overlays** (Checkbox-Panel in der Karte):
  1. Wanderwege (`ch.swisstopo.swisstlm3d-wanderwege`)
  2. ÖV-Haltestellen (`ch.bav.haltestellen-oev`)
  3. Schneehöhe (SLF-Layer, ID bei Implementierung verifizieren, siehe 7.2)
  4. Wildruhezonen (`ch.bafu.wrz-wildruhezonen_portal`, ID verifizieren)
- Layer-Sichtbarkeit wird pro Nutzer gespeichert (Settings-Tabelle) und beim Start wiederhergestellt.
- Attribution "© swisstopo" dauerhaft sichtbar (Pflicht).
- **Akzeptanz:** Alle vier Overlays lassen sich unabhängig ein-/ausblenden; Kartenzustand (Layer, letzte Position) überlebt einen Neustart.

### F3 – Routen-Editor mit Snapping und Kennzahlen

- Zeichenmodus: Klick setzt Wegpunkte; zwischen zwei Wegpunkten wird die Verbindung **automatisch entlang des Wanderwegnetzes** geroutet (Snapping, siehe 7.3).
- Fallback-Schalter "Luftlinie": deaktiviert Snapping für einzelne Segmente (z. B. weglose Abschnitte).
- Bearbeiten: Wegpunkte verschieben (Drag), einfügen (Klick auf Segment), löschen (Rechtsklick/Alt-Klick). Nach jeder Änderung wird nur das betroffene Segment neu geroutet.
- Undo/Redo (mind. 20 Schritte).
- **Kennzahlen-Leiste unten in der Karte:** Gesamtkilometer, Aufstieg (m), Abstieg (m), geschätzte Wanderzeit. Aktualisierung debounced (500 ms) nach Änderungen.
  - Höhendaten via GeoAdmin `profile.json` (Fair-Use-Limit beachten, siehe 7.1).
  - Wanderzeit v1 nach vereinfachter Formel der Schweizer Wanderwege: 4.2 km/h horizontal, 300 Hm/h Aufstieg, 500 Hm/h Abstieg; Gesamtzeit = grösserer Wert + halber kleinerer Wert. Formel als reine Funktion implementieren und mit Referenzwerten testen.
- GPX-Import (Datei öffnen) und GPX-Export pro Tour.
- **Akzeptanz:** Eine Route Basel–Chrischona lässt sich mit ≤ 6 Klicks zeichnen und folgt sichtbar dem Wanderwegnetz; Kennzahlen weichen max. ±10 % von der swisstopo-App ab; Undo stellt den vorherigen Zustand exakt wieder her.

### F4 – Book (rechte Spalte, Reiter "Book")

- Card-Grid pro Tour. Jede Card enthält: optionales Bild, Titel, Notiztext (Markdown, editierbar inline), Datum.
- "+ Neue Card" erstellt leere Card.
- Bild-Upload per Drag-and-drop oder Dateidialog. v1: Bilder werden lokal verarbeitet (Ableitung 2000 px WebP + Thumbnail 300 px, SHA-256 als Dateiname) und die Ableitungen hochgeladen; **R2-Anbindung ist Phase 8**, bis dahin Speicherung über die API im Postgres-Bytea nur für Thumbnails ODER lokaler Ordner mit Upload-Queue (Entscheid in Phase 6, Präferenz: Upload-Queue, kein Bytea).
- HEIC (iPhone) wird beim Import nach WebP konvertiert.
- Cards sortierbar per Drag-and-drop (Positionsfeld).
- Card löschen mit Bestätigung.
- **Akzeptanz:** 10 Bilder à 5 MB lassen sich am Stück importieren, UI bleibt bedienbar, jede Card ist nach Neustart wieder da.

### F5 – Navigation Karte ↔ Touren

- Klick auf einen Touren-Tab: Karte macht `fitBounds` auf die in der DB gespeicherte `bbox` der Tour (mit Padding), Route wird hervorgehoben.
- Tour ohne Geometrie: Karte bleibt stehen, Hinweis "Noch keine Route".
- **Akzeptanz:** Wechsel zwischen zwei Touren an entgegengesetzten Landesenden dauert < 1 s bis zur fertigen Ansicht (ohne Kachel-Nachladen).

### F6 – Mobile-Ansicht (read-only PWA)

- Gleiche React-Codebasis, responsives Layout: Tourenliste als Vollbild-Liste, Tour öffnet Karte + Book als Reiter.
- Keine Editierfunktionen (Zeichnen, Card-Editing, Upload sind ausgeblendet).
- Zugriffsschutz: statischer Bearer-Token (in der PWA einmalig eingegeben, in localStorage), da Single-User. Kein OAuth in v1.
- Installierbar (Manifest + Service Worker für App-Shell; keine Karten-Kacheln cachen).
- **Akzeptanz:** Auf einem Smartphone lassen sich alle Touren mit Route, Kennzahlen und Cards ansehen; Editier-UI ist nirgends erreichbar.

## 5. Architektur

```
┌───────────────┐        ┌──────────────────────────┐
│ Desktop        │        │ Cloudflare Worker (Hono)  │
│ Tauri 2 + React│──API──▶│  - REST /api/*            │
│ + MapLibre     │        │  - Auth: Bearer-Token     │
└───────────────┘        │  - Neon serverless driver │──▶ Neon Postgres
┌───────────────┐        │  - R2-Binding (Phase 8)   │──▶ Cloudflare R2
│ Mobile PWA     │──API──▶│  - liefert PWA-Assets aus │
│ (read-only)    │        └──────────────────────────┘
└───────────────┘                 │
        └────── Kacheln/Höhen direkt von wmts.geo.admin.ch / api3.geo.admin.ch
```

Begründungen:

- **Ein Backend für beide Clients.** Die PWA kann nicht direkt mit Postgres sprechen, und Credentials gehören nicht in einen Browser-Client. Der Worker kapselt Neon und später R2; Desktop nutzt dieselbe API (kein Sonderweg, weniger Code).
- **Cloudflare Worker + Hono**, weil R2 ohnehin geplant ist (natives Binding, keine Presigned-URL-Akrobatik nötig) und der Free-Tier für Single-User locker reicht.
- **Neon** über `@neondatabase/serverless` (HTTP-Driver, Worker-kompatibel). Migrations mit **Drizzle ORM + drizzle-kit**.
- Karten-Kacheln und `profile.json` gehen **direkt vom Client** zu geo.admin.ch (kein Proxy; spart Worker-Traffic, Attribution bleibt Pflicht).

## 6. Datenmodell

```sql
create table tours (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'geplant',  -- 'geplant' | 'gemacht'
  geometry    jsonb,          -- GeoJSON LineString, WGS84
  waypoints   jsonb,          -- Stützpunkte [[lon,lat],...] (Editier-Grundlage)
  distance_m  integer,
  ascent_m    integer,
  descent_m   integer,
  duration_min integer,
  bbox        jsonb,          -- [minLon,minLat,maxLon,maxLat]
  notes_md    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table cards (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references tours(id),
  title       text,
  body_md     text,
  position    integer not null default 0,
  taken_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table images (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references cards(id),
  sha256      text not null unique,      -- Content-Adressierung
  r2_key_display text,                   -- 2000px WebP (Phase 8)
  r2_key_thumb   text,                   -- 300px WebP  (Phase 8)
  lat double precision, lon double precision,  -- aus EXIF
  taken_at    timestamptz,
  upload_state text not null default 'pending', -- 'pending'|'uploaded'|'failed'
  created_at  timestamptz not null default now()
);

create table settings (
  key   text primary key,
  value jsonb not null
);
```

Hinweise: Kein PostGIS nötig in v1 (bbox reicht für fitBounds; Geometrie ist reines Anzeige-/Exportformat). `waypoints` getrennt von `geometry` speichern, damit Editieren nach Neuladen exakt weitergeht.

## 7. Externe Dienste, Grenzen, Risiken

### 7.1 GeoAdmin API

- Kacheln: `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.jpeg` (bzw. `.png` für Overlays; korrektes Format pro Layer aus dem WMTS-GetCapabilities übernehmen).
- Höhenprofil: `POST https://api3.geo.admin.ch/rest/services/profile.json` mit LineString (sr=4326 oder 2056 – bei Implementierung testen, notfalls nach LV95 transformieren).
- **Fair Use: 20 Requests/Minute im Dauerschnitt** auf den REST-Diensten. Konsequenz: Profile-Aufrufe debouncen, nur bei "Drag-Ende" feuern, nie pro Mousemove. Kacheln zählen hier nicht hinein, trotzdem sparsam (kein automatisches Vorladen der ganzen Schweiz).
- Attribution "© swisstopo" ist verpflichtend sichtbar.

### 7.2 Layer-IDs verifizieren (offener Punkt)

Die IDs für ÖV-Haltestellen, Schneehöhe (SLF) und Wildruhezonen sind plausibel, aber **vor Implementierung gegen das GetCapabilities bzw. den Layer-Katalog auf map.geo.admin.ch prüfen**. Falls der Schneehöhen-Layer nicht als WMTS verfügbar ist: als WMS einbinden oder Feature streichen und im PRD vermerken.

### 7.3 Snapping/Routing (grösstes Risiko)

swisstopo bietet **keinen öffentlich dokumentierten Routing-Dienst**. Strategie:

- **v1: BRouter-Web-API** (OSM-basiert, Hiking-Profil) oder GraphHopper-Cloud (Free-Tier mit API-Key) für das Segment-Routing zwischen zwei Wegpunkten. Das OSM-Wanderwegnetz ist in der Schweiz sehr gut gepflegt; Abweichungen vom swisstopo-Netz sind möglich und werden akzeptiert.
- Abstraktion: `RoutingProvider`-Interface (`route(from, to): Promise<LineString>`), damit später ein eigener Dienst auf swissTLM3D-Wanderwege (pgRouting) eingehängt werden kann, ohne den Editor anzufassen.
- Parallel (ausserhalb der Entwicklung): Anfrage an info@geo.admin.ch, ob ein Routing-/Snapping-Dienst nutzbar ist.
- Verfügbarkeits-Fallback: Wenn der Routing-Dienst nicht antwortet (Timeout 5 s), Luftlinie einfügen und Segment visuell markieren (gestrichelt).

### 7.4 Sicherheit

- **Der Neon-Connection-String wurde ausserhalb sicherer Kanäle geteilt und ist vor Projektstart in der Neon-Konsole zu rotieren.**
- Secrets ausschliesslich als Umgebungsvariablen / Wrangler-Secrets (`DATABASE_URL`, `API_TOKEN`). Nie im Repo, `.env` in `.gitignore`, `.env.example` ohne Werte einchecken.
- API: alle Routen hinter Bearer-Token; Schreibrouten zusätzlich nur für Desktop-Client gedacht (gleicher Token in v1, saubere Trennung ist v2).

## 8. Qualität

- TypeScript strikt, ESLint + Prettier.
- Unit-Tests (Vitest) für: Wanderzeit-Formel, bbox-Berechnung, GPX-Import/-Export, Metrik-Aggregation aus profile.json-Antworten (mit Fixtures).
- API-Tests gegen lokale Hono-Instanz mit Test-Datenbank (Neon-Branch).
- Manuelle Testtour als Referenz definieren (feste Wegpunkte) und Kennzahlen dokumentieren.

## 9. Erfolgskriterien v1

1. 20 reale Touren erfasst (Import oder gezeichnet), jede mit Kennzahlen und mindestens einer Card.
2. Zeichnen einer neuen Tour inkl. Kennzahlen dauert unter 5 Minuten.
3. Mobile-PWA zeigt alle Touren vollständig und schnell (< 3 s bis zur Karte auf 4G).
4. Kein Secret im Repo (geprüft mit gitleaks o. ä.).
