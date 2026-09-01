import {
  pgTable,
  primaryKey,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
} from 'drizzle-orm/pg-core'
import type { BBox, LineString, LonLat } from '../types'

// Spalten- und Property-Namen bewusst identisch (snake_case), damit Drizzle-Rows
// ohne Mapping direkt als API-DTOs dienen (siehe packages/shared/src/schemas.ts).

export const tours = pgTable('tours', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Neon-Auth-User (JWT `sub`); jede Tour gehört genau einem User.
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('geplant'), // 'geplant' | 'gemacht'
  geometry: jsonb('geometry').$type<LineString>(),
  waypoints: jsonb('waypoints').$type<LonLat[]>(),
  distance_m: integer('distance_m'),
  ascent_m: integer('ascent_m'),
  descent_m: integer('descent_m'),
  duration_min: integer('duration_min'),
  bbox: jsonb('bbox').$type<BBox>(),
  notes_md: text('notes_md'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
})

export const cards = pgTable('cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  tour_id: uuid('tour_id')
    .notNull()
    .references(() => tours.id),
  title: text('title'),
  // Kachel-Typ: 'text' (Überschrift + Markdown) oder 'images' (Galerie).
  kind: text('kind').notNull().default('text'),
  body_md: text('body_md'),
  position: integer('position').notNull().default(0),
  taken_at: timestamp('taken_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
})

export const images = pgTable('images', {
  id: uuid('id').primaryKey().defaultRandom(),
  card_id: uuid('card_id')
    .notNull()
    .references(() => cards.id),
  sha256: text('sha256').notNull().unique(), // Content-Adressierung
  r2_key_display: text('r2_key_display'), // 2000px WebP (Phase 8)
  r2_key_thumb: text('r2_key_thumb'), // 300px WebP (Phase 8)
  caption: text('caption'), // Untertitel unterm grossen Bild
  lat: doublePrecision('lat'), // aus EXIF
  lon: doublePrecision('lon'),
  taken_at: timestamp('taken_at', { withTimezone: true, mode: 'string' }),
  upload_state: text('upload_state').notNull().default('pending'), // 'pending'|'uploaded'|'failed'
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
})

export const settings = pgTable(
  'settings',
  {
    user_id: text('user_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.key] })]
)
