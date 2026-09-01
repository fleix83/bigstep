import { z } from 'zod'

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

export const lonLatSchema = z.tuple([
  z.number().min(-180).max(180), // lon
  z.number().min(-90).max(90), // lat
])

/** GeoJSON LineString, Positionen [lon,lat] oder [lon,lat,ele]. */
export const lineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.array(z.number()).min(2).max(3)).min(2),
})

/** [minLon, minLat, maxLon, maxLat] */
export const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()])

// ---------------------------------------------------------------------------
// Tour
// ---------------------------------------------------------------------------

export const tourStatusSchema = z.enum(['geplant', 'gemacht'])
export const tourVisibilitySchema = z.enum(['private', 'public'])

/** Tour, wie die API sie liefert (Timestamps als ISO-Strings, soft-deleted nie enthalten). */
export const tourSchema = z.object({
  id: z.uuid(),
  // Owner (Neon-Auth-User-ID) – der Client vergleicht damit gegen den
  // eingeloggten User, um fremde (geteilte) Touren read-only zu rendern.
  user_id: z.string(),
  name: z.string(),
  status: tourStatusSchema,
  visibility: tourVisibilitySchema,
  geometry: lineStringSchema.nullable(),
  waypoints: z.array(lonLatSchema).nullable(),
  distance_m: z.number().int().nullable(),
  ascent_m: z.number().int().nullable(),
  descent_m: z.number().int().nullable(),
  duration_min: z.number().int().nullable(),
  bbox: bboxSchema.nullable(),
  notes_md: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const tourCreateSchema = z.object({
  name: z.string().min(1).max(200),
  status: tourStatusSchema.optional(),
})

export const tourUpdateSchema = z
  .object({
    name: z.string().min(1).max(200),
    status: tourStatusSchema,
    visibility: tourVisibilitySchema,
    geometry: lineStringSchema.nullable(),
    waypoints: z.array(lonLatSchema).nullable(),
    distance_m: z.number().int().nonnegative().nullable(),
    ascent_m: z.number().int().nonnegative().nullable(),
    descent_m: z.number().int().nonnegative().nullable(),
    duration_min: z.number().int().nonnegative().nullable(),
    bbox: bboxSchema.nullable(),
    notes_md: z.string().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Leeres Update' })

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const cardKindSchema = z.enum(['text', 'images'])

export const cardSchema = z.object({
  id: z.uuid(),
  tour_id: z.uuid(),
  title: z.string().nullable(),
  kind: cardKindSchema,
  body_md: z.string().nullable(),
  position: z.number().int(),
  taken_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const cardCreateSchema = z.object({
  tour_id: z.uuid(),
  kind: cardKindSchema.optional(),
  title: z.string().max(300).optional(),
  body_md: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
  taken_at: z.iso.datetime({ offset: true }).optional(),
})

export const cardUpdateSchema = z
  .object({
    title: z.string().max(300).nullable(),
    body_md: z.string().nullable(),
    position: z.number().int().nonnegative(),
    taken_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Leeres Update' })

/** Neue Reihenfolge: ids in Zielreihenfolge, position wird 0..n-1 gesetzt. */
export const cardsReorderSchema = z.object({
  tour_id: z.uuid(),
  ids: z.array(z.uuid()).min(1),
})

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export const uploadStateSchema = z.enum(['pending', 'uploaded', 'failed'])

export const imageSchema = z.object({
  id: z.uuid(),
  card_id: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  caption: z.string().nullable(),
  r2_key_display: z.string().nullable(),
  r2_key_thumb: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  taken_at: z.string().nullable(),
  upload_state: uploadStateSchema,
  created_at: z.string(),
})

export const imageCreateSchema = z.object({
  card_id: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  taken_at: z.iso.datetime({ offset: true }).optional(),
})

export const imageUpdateSchema = z
  .object({
    caption: z.string().max(500).nullable(),
    r2_key_display: z.string().nullable(),
    r2_key_thumb: z.string().nullable(),
    upload_state: uploadStateSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Leeres Update' })

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingValueSchema = z.json()

export const settingPutSchema = z.object({
  value: settingValueSchema,
})

// ---------------------------------------------------------------------------
// Abgeleitete Typen
// ---------------------------------------------------------------------------

/** Geteilte Tour eines anderen Users (Liste «Von anderen geteilt»). */
export const sharedTourSchema = tourSchema.extend({
  owner_name: z.string().nullable(),
})

export type Tour = z.infer<typeof tourSchema>
export type SharedTour = z.infer<typeof sharedTourSchema>
export type TourCreate = z.infer<typeof tourCreateSchema>
export type TourUpdate = z.infer<typeof tourUpdateSchema>
export type Card = z.infer<typeof cardSchema>
export type CardCreate = z.infer<typeof cardCreateSchema>
export type CardUpdate = z.infer<typeof cardUpdateSchema>
export type CardsReorder = z.infer<typeof cardsReorderSchema>
export type Image = z.infer<typeof imageSchema>
export type ImageCreate = z.infer<typeof imageCreateSchema>
export type ImageUpdate = z.infer<typeof imageUpdateSchema>
