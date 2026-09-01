import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { and, asc, desc, eq, isNull, max, sql } from 'drizzle-orm'
import { cards, images, settings, tours } from '@tourenbuch/shared/db'
import {
  cardCreateSchema,
  cardUpdateSchema,
  cardsReorderSchema,
  imageCreateSchema,
  imageUpdateSchema,
  settingPutSchema,
  tourCreateSchema,
  tourUpdateSchema,
} from '@tourenbuch/shared'
import { getDb } from './db'
import { ApiError, uuidParam, validate } from './errors'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()

// Desktop (Tauri-Webview bzw. Vite-Dev) läuft auf anderer Origin als der Worker;
// die Daten schützt der Bearer-Token, nicht die Origin. PWA wird same-origin ausgeliefert.
app.use('/api/*', cors())

// ---------------------------------------------------------------------------
// Auth: alle /api-Routen hinter statischem Bearer-Token (PRD §7.4)
// ---------------------------------------------------------------------------

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

app.use('/api/*', async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!c.env.API_TOKEN || !token || !timingSafeEqual(token, c.env.API_TOKEN)) {
    return c.json(
      { error: { code: 'unauthorized', message: 'Fehlender oder ungültiger Bearer-Token' } },
      401
    )
  }
  await next()
})

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status)
  }
  console.error('Unbehandelter Fehler:', err)
  return c.json({ error: { code: 'internal', message: 'Interner Fehler' } }, 500)
})

app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: 'Route nicht gefunden' } }, 404)
)

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request-Body ist kein gültiges JSON')
  }
}

function idParam(raw: string): string {
  const r = uuidParam.safeParse(raw)
  if (!r.success) throw new ApiError(400, 'validation_error', 'id muss eine UUID sein')
  return r.data
}

/** deleted_at gehört nie in eine API-Antwort. */
function stripDeleted<T extends { deleted_at?: unknown }>(row: T) {
  const { deleted_at: _omit, ...rest } = row
  return rest
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

app.get('/api/tours', async (c) => {
  const db = getDb(c.env)
  const sort = c.req.query('sort') === 'name' ? 'name' : 'updated'
  const rows = await db
    .select()
    .from(tours)
    .where(isNull(tours.deleted_at))
    .orderBy(sort === 'name' ? asc(tours.name) : desc(tours.updated_at))
  return c.json(rows.map(stripDeleted))
})

app.post('/api/tours', async (c) => {
  const body = validate(tourCreateSchema, await readJson(c))
  const db = getDb(c.env)
  const [row] = await db.insert(tours).values(body).returning()
  if (!row) throw new ApiError(500, 'internal', 'Insert lieferte keine Zeile')
  return c.json(stripDeleted(row), 201)
})

app.patch('/api/tours/:id', async (c) => {
  const id = idParam(c.req.param('id'))
  const body = validate(tourUpdateSchema, await readJson(c))
  const db = getDb(c.env)
  const [row] = await db
    .update(tours)
    .set({ ...body, updated_at: sql`now()` })
    .where(and(eq(tours.id, id), isNull(tours.deleted_at)))
    .returning()
  if (!row) throw new ApiError(404, 'not_found', 'Tour nicht gefunden')
  return c.json(stripDeleted(row))
})

app.delete('/api/tours/:id', async (c) => {
  const id = idParam(c.req.param('id'))
  const db = getDb(c.env)
  // Soft-Delete von Tour und zugehörigen Cards (PRD F1); R2-Cleanup ist ein späterer Job.
  const [row] = await db
    .update(tours)
    .set({ deleted_at: sql`now()` })
    .where(and(eq(tours.id, id), isNull(tours.deleted_at)))
    .returning({ id: tours.id })
  if (!row) throw new ApiError(404, 'not_found', 'Tour nicht gefunden')
  await db
    .update(cards)
    .set({ deleted_at: sql`now()` })
    .where(and(eq(cards.tour_id, id), isNull(cards.deleted_at)))
  return c.body(null, 204)
})

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

async function requireTour(db: ReturnType<typeof getDb>, tourId: string) {
  const [row] = await db
    .select({ id: tours.id })
    .from(tours)
    .where(and(eq(tours.id, tourId), isNull(tours.deleted_at)))
  if (!row) throw new ApiError(404, 'not_found', 'Tour nicht gefunden')
}

app.get('/api/tours/:id/cards', async (c) => {
  const tourId = idParam(c.req.param('id'))
  const db = getDb(c.env)
  await requireTour(db, tourId)
  const rows = await db
    .select()
    .from(cards)
    .where(and(eq(cards.tour_id, tourId), isNull(cards.deleted_at)))
    .orderBy(asc(cards.position), asc(cards.created_at))
  return c.json(rows.map(stripDeleted))
})

app.post('/api/cards', async (c) => {
  const body = validate(cardCreateSchema, await readJson(c))
  const db = getDb(c.env)
  await requireTour(db, body.tour_id)
  let position = body.position
  if (position === undefined) {
    const [agg] = await db
      .select({ maxPos: max(cards.position) })
      .from(cards)
      .where(and(eq(cards.tour_id, body.tour_id), isNull(cards.deleted_at)))
    position = (agg?.maxPos ?? -1) + 1
  }
  const [row] = await db
    .insert(cards)
    .values({ ...body, position })
    .returning()
  if (!row) throw new ApiError(500, 'internal', 'Insert lieferte keine Zeile')
  return c.json(stripDeleted(row), 201)
})

app.patch('/api/cards/:id', async (c) => {
  const id = idParam(c.req.param('id'))
  const body = validate(cardUpdateSchema, await readJson(c))
  const db = getDb(c.env)
  const [row] = await db
    .update(cards)
    .set({ ...body, updated_at: sql`now()` })
    .where(and(eq(cards.id, id), isNull(cards.deleted_at)))
    .returning()
  if (!row) throw new ApiError(404, 'not_found', 'Card nicht gefunden')
  return c.json(stripDeleted(row))
})

app.delete('/api/cards/:id', async (c) => {
  const id = idParam(c.req.param('id'))
  const db = getDb(c.env)
  const [row] = await db
    .update(cards)
    .set({ deleted_at: sql`now()` })
    .where(and(eq(cards.id, id), isNull(cards.deleted_at)))
    .returning({ id: cards.id })
  if (!row) throw new ApiError(404, 'not_found', 'Card nicht gefunden')
  return c.body(null, 204)
})

app.post('/api/cards/reorder', async (c) => {
  const body = validate(cardsReorderSchema, await readJson(c))
  const db = getDb(c.env)
  await requireTour(db, body.tour_id)
  // Eine Anweisung für alle Positionen (atomar, Reihenfolge = Index in ids).
  const pairs = body.ids.map((id, i) => sql`(${id}::uuid, ${i}::int)`)
  await db.execute(sql`
    update cards set position = v.pos, updated_at = now()
    from (values ${sql.join(pairs, sql`, `)}) as v(id, pos)
    where cards.id = v.id
      and cards.tour_id = ${body.tour_id}
      and cards.deleted_at is null
  `)
  const rows = await db
    .select()
    .from(cards)
    .where(and(eq(cards.tour_id, body.tour_id), isNull(cards.deleted_at)))
    .orderBy(asc(cards.position), asc(cards.created_at))
  return c.json(rows.map(stripDeleted))
})

// ---------------------------------------------------------------------------
// Images (Metadaten; die Ableitungen liegen in v1 lokal beim Client, ab
// Phase 8 in R2 – kein Bytea in Postgres, PRD F4)
// ---------------------------------------------------------------------------

app.get('/api/tours/:id/images', async (c) => {
  const tourId = idParam(c.req.param('id'))
  const db = getDb(c.env)
  await requireTour(db, tourId)
  const rows = await db
    .select({ image: images })
    .from(images)
    .innerJoin(cards, eq(images.card_id, cards.id))
    .where(and(eq(cards.tour_id, tourId), isNull(cards.deleted_at)))
    .orderBy(asc(images.created_at))
  return c.json(rows.map((r) => r.image))
})

app.post('/api/images', async (c) => {
  const body = validate(imageCreateSchema, await readJson(c))
  const db = getDb(c.env)
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.id, body.card_id), isNull(cards.deleted_at)))
  if (!card) throw new ApiError(404, 'not_found', 'Card nicht gefunden')
  // Duplikat-Import (gleiche sha256) legt keine zweite Zeile an, sondern
  // liefert die bestehende zurück – der Client verknüpft nur (PRD F4).
  const [existing] = await db.select().from(images).where(eq(images.sha256, body.sha256))
  if (existing) return c.json(existing, 200)
  const [row] = await db.insert(images).values(body).returning()
  if (!row) throw new ApiError(500, 'internal', 'Insert lieferte keine Zeile')
  return c.json(row, 201)
})

app.patch('/api/images/:id', async (c) => {
  const id = idParam(c.req.param('id'))
  const body = validate(imageUpdateSchema, await readJson(c))
  const db = getDb(c.env)
  const [row] = await db.update(images).set(body).where(eq(images.id, id)).returning()
  if (!row) throw new ApiError(404, 'not_found', 'Bild nicht gefunden')
  return c.json(row)
})

app.delete('/api/images/:id', async (c) => {
  const id = idParam(c.req.param('id'))
  const db = getDb(c.env)
  const [row] = await db
    .delete(images)
    .where(eq(images.id, id))
    .returning({ id: images.id, sha256: images.sha256 })
  if (!row) throw new ApiError(404, 'not_found', 'Bild nicht gefunden')
  // Zugehörige R2-Ableitungen mitentsorgen (best effort; Rest fängt der Cleanup).
  await Promise.allSettled([
    c.env.R2.delete(`images/${row.sha256}/display`),
    c.env.R2.delete(`images/${row.sha256}/thumb`),
  ])
  return c.body(null, 204)
})

// ---------------------------------------------------------------------------
// Bild-Binärdaten in R2 (Phase 8). Keys sind content-addressed
// (images/<sha256>/<variant>), PUTs damit idempotent — ein abgebrochener
// Upload hinterlässt keinen inkonsistenten Zustand, der nächste Versuch
// überschreibt dasselbe Objekt.
// ---------------------------------------------------------------------------

const R2_VARIANTS = ['display', 'thumb'] as const
type R2Variant = (typeof R2_VARIANTS)[number]
const MAX_VARIANT_BYTES = 15 * 1024 * 1024

function shaParam(raw: string): string {
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new ApiError(400, 'validation_error', 'Ungültige sha256')
  }
  return raw
}

function variantParam(raw: string): R2Variant {
  if (!(R2_VARIANTS as readonly string[]).includes(raw)) {
    throw new ApiError(400, 'validation_error', 'variant muss display oder thumb sein')
  }
  return raw as R2Variant
}

const r2Key = (sha: string, variant: R2Variant) => `images/${sha}/${variant}`

/**
 * Liste der Bild-Metadaten, optional nach upload_state gefiltert (Upload-
 * Queue). Bilder soft-gelöschter Cards bleiben aussen vor — sie sollen weder
 * hochgeladen noch angezeigt werden (der r2-cleanup räumt ihre Objekte ab).
 */
app.get('/api/images', async (c) => {
  const state = c.req.query('state')
  const db = getDb(c.env)
  const rows = await db
    .select({ image: images })
    .from(images)
    .innerJoin(cards, eq(images.card_id, cards.id))
    .where(
      state
        ? and(isNull(cards.deleted_at), eq(images.upload_state, state))
        : isNull(cards.deleted_at)
    )
  return c.json(rows.map((r) => r.image))
})

app.put('/api/images/:sha256/:variant', async (c) => {
  const sha = shaParam(c.req.param('sha256'))
  const variant = variantParam(c.req.param('variant'))
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw new ApiError(400, 'validation_error', 'Content-Type muss image/* sein')
  }
  const body = await c.req.arrayBuffer()
  if (body.byteLength === 0) {
    throw new ApiError(400, 'validation_error', 'Leerer Body')
  }
  if (body.byteLength > MAX_VARIANT_BYTES) {
    throw new ApiError(413, 'too_large', 'Ableitung grösser als 15 MB')
  }
  const key = r2Key(sha, variant)
  await c.env.R2.put(key, body, { httpMetadata: { contentType } })
  return c.json({ key })
})

app.get('/api/images/:sha256/:variant', async (c) => {
  const sha = shaParam(c.req.param('sha256'))
  const variant = variantParam(c.req.param('variant'))
  const obj = await c.env.R2.get(r2Key(sha, variant))
  if (!obj) throw new ApiError(404, 'not_found', 'Ableitung nicht in R2')
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      // Content-addressed ⇒ unveränderlich; privat wegen Bearer-Token.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
})

/**
 * Cleanup (PLAN 8.5): R2-Objekte ohne DB-Referenz auflisten bzw. löschen.
 * Default ist Dry-Run; `?dry=0` löscht wirklich.
 */
app.post('/api/admin/r2-cleanup', async (c) => {
  const dryRun = c.req.query('dry') !== '0'
  const db = getDb(c.env)
  const rows = await db.select({ sha256: images.sha256 }).from(images)
  const known = new Set(rows.map((r) => r.sha256))
  const orphans: string[] = []
  let cursor: string | undefined
  do {
    const listing = await c.env.R2.list({ prefix: 'images/', cursor })
    for (const obj of listing.objects) {
      const sha = obj.key.split('/')[1]
      if (!sha || !known.has(sha)) {
        orphans.push(obj.key)
        if (!dryRun) await c.env.R2.delete(obj.key)
      }
    }
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
  return c.json({ dryRun, orphans })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

app.get('/api/settings', async (c) => {
  const db = getDb(c.env)
  const rows = await db.select().from(settings)
  const result: Record<string, unknown> = {}
  for (const row of rows) result[row.key] = row.value
  return c.json(result)
})

app.put('/api/settings/:key', async (c) => {
  const key = c.req.param('key')
  if (!key || key.length > 200) {
    throw new ApiError(400, 'validation_error', 'Ungültiger Settings-Key')
  }
  const body = validate(settingPutSchema, await readJson(c))
  const db = getDb(c.env)
  await db
    .insert(settings)
    .values({ key, value: body.value })
    .onConflictDoUpdate({ target: settings.key, set: { value: body.value } })
  return c.json({ key, value: body.value })
})

export default app
