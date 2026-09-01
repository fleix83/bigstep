import { beforeAll, describe, expect, it } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { Card, Tour } from '@tourenbuch/shared'
import app from '../src/index'

// Läuft gegen den Neon-Branch "test" (PLAN Phase 1.5). Ohne TEST_DATABASE_URL
// werden die DB-Tests übersprungen (z. B. CI ohne Secret).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

// Neon-Auth-Simulation: eigenes Ed25519-Paar, JWKS als Inline-JSON (TEST_JWKS),
// JWTs wie von Managed Better Auth (iss/aud = Origin der Auth-URL, sub = User).
const AUTH_URL = 'https://test-auth.local/neondb/auth'
const AUTH_ORIGIN = 'https://test-auth.local'
const USER_A = 'user-a-1111'
const USER_B = 'user-b-2222'
let TOKEN = '' // JWT für USER_A (Default in req())
let TOKEN_B = ''

/** In-Memory-Ersatz für das R2-Binding (nur die genutzten Methoden). */
class MemR2 {
  store = new Map<string, { body: ArrayBuffer; contentType?: string }>()
  async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.store.set(key, { body: value, contentType: opts?.httpMetadata?.contentType })
  }
  async get(key: string) {
    const entry = this.store.get(key)
    if (!entry) return null
    return {
      body: new Blob([entry.body]).stream(),
      httpMetadata: { contentType: entry.contentType },
    }
  }
  async delete(key: string) {
    this.store.delete(key)
  }
  async list(opts?: { prefix?: string; cursor?: string }) {
    const objects = [...this.store.keys()]
      .filter((k) => k.startsWith(opts?.prefix ?? ''))
      .map((key) => ({ key }))
    return { objects, truncated: false as const }
  }
}

const memR2 = new MemR2()
const env = {
  DATABASE_URL: TEST_DATABASE_URL ?? '',
  NEON_AUTH_URL: AUTH_URL,
  TEST_JWKS: '',
  R2: memR2 as unknown as R2Bucket,
}

async function initTestAuth() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'test-key'
  jwk.alg = 'EdDSA'
  env.TEST_JWKS = JSON.stringify({ keys: [jwk] })
  const sign = (sub: string) =>
    new SignJWT({ sub })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setIssuer(AUTH_ORIGIN)
      .setAudience(AUTH_ORIGIN)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey)
  TOKEN = await sign(USER_A)
  TOKEN_B = await sign(USER_B)
}

function req(
  method: string,
  path: string,
  body?: unknown,
  token: string | null | undefined = undefined
) {
  if (token === undefined) token = TOKEN
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return app.request(
    path,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    env
  )
}

describe.skipIf(!TEST_DATABASE_URL)('API (Neon-Branch test)', () => {
  beforeAll(async () => {
    await initTestAuth()
    const sql = neon(TEST_DATABASE_URL!)
    await sql`delete from images`
    await sql`delete from cards`
    await sql`delete from tours`
    await sql`delete from settings`
  })

  describe('Auth', () => {
    it('401 ohne Token', async () => {
      const res = await req('GET', '/api/tours', undefined, null)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('unauthorized')
    })

    it('401 mit kaputtem JWT', async () => {
      const res = await req('GET', '/api/tours', undefined, 'kein-echtes-jwt')
      expect(res.status).toBe(401)
    })

    it('Health ist öffentlich, Touren mit gültigem JWT erreichbar', async () => {
      const health = await req('GET', '/api/health', undefined, null)
      expect(health.status).toBe(200)
      const tours = await req('GET', '/api/tours')
      expect(tours.status).toBe(200)
    })

    it('User-Isolation: User B sieht die Touren von User A nicht', async () => {
      const created = (await (
        await req('POST', '/api/tours', { name: 'Privat A' })
      ).json()) as Tour
      const listB = (await (await req('GET', '/api/tours', undefined, TOKEN_B)).json()) as Tour[]
      expect(listB.some((t) => t.id === created.id)).toBe(false)
      const patchB = await req('PATCH', `/api/tours/${created.id}`, { name: 'geklaut' }, TOKEN_B)
      expect(patchB.status).toBe(404)
      const cardsB = await req('GET', `/api/tours/${created.id}/cards`, undefined, TOKEN_B)
      expect(cardsB.status).toBe(404)
      await req('DELETE', `/api/tours/${created.id}`)
    })
  })

  describe('Tours CRUD', () => {
    let tourId: string

    it('POST /api/tours legt eine Tour an', async () => {
      const res = await req('POST', '/api/tours', { name: 'Basel – Chrischona' })
      expect(res.status).toBe(201)
      const tour = (await res.json()) as Tour
      expect(tour.name).toBe('Basel – Chrischona')
      expect(tour.status).toBe('geplant')
      expect(tour.geometry).toBeNull()
      expect(tour).not.toHaveProperty('deleted_at')
      tourId = tour.id
    })

    it('GET /api/tours enthält die Tour', async () => {
      const res = await req('GET', '/api/tours')
      const tours = (await res.json()) as Tour[]
      expect(tours.some((t) => t.id === tourId)).toBe(true)
    })

    it('PATCH ändert Name, Status und Kennzahlen', async () => {
      const res = await req('PATCH', `/api/tours/${tourId}`, {
        name: 'Chrischona-Runde',
        status: 'gemacht',
        distance_m: 8200,
        ascent_m: 320,
        bbox: [7.59, 47.55, 7.69, 47.58],
      })
      expect(res.status).toBe(200)
      const tour = (await res.json()) as Tour
      expect(tour.name).toBe('Chrischona-Runde')
      expect(tour.status).toBe('gemacht')
      expect(tour.distance_m).toBe(8200)
      expect(tour.bbox).toEqual([7.59, 47.55, 7.69, 47.58])
    })

    it('PATCH mit leerem Body → 400 validation_error', async () => {
      const res = await req('PATCH', `/api/tours/${tourId}`, {})
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('validation_error')
    })

    it('POST ohne Namen → 400 validation_error', async () => {
      const res = await req('POST', '/api/tours', {})
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('validation_error')
    })

    it('sort=name sortiert alphabetisch, Default nach updated_at desc', async () => {
      await req('POST', '/api/tours', { name: 'AAA Ersttour' })
      const byName = (await (await req('GET', '/api/tours?sort=name')).json()) as Tour[]
      const names = byName.map((t) => t.name)
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

      const byUpdated = (await (await req('GET', '/api/tours')).json()) as Tour[]
      expect(byUpdated[0]!.name).toBe('AAA Ersttour') // zuletzt angefasst → oben
    })

    it('DELETE soft-deleted die Tour; danach 404', async () => {
      const res = await req('DELETE', `/api/tours/${tourId}`)
      expect(res.status).toBe(204)
      const list = (await (await req('GET', '/api/tours')).json()) as Tour[]
      expect(list.some((t) => t.id === tourId)).toBe(false)
      const patch = await req('PATCH', `/api/tours/${tourId}`, { name: 'x' })
      expect(patch.status).toBe(404)
    })
  })

  describe('Cards', () => {
    let tourId: string
    let cardA: string
    let cardB: string

    beforeAll(async () => {
      const res = await req('POST', '/api/tours', { name: 'Card-Testtour' })
      tourId = ((await res.json()) as Tour).id
    })

    it('POST /api/cards legt Cards mit fortlaufender Position an', async () => {
      const a = (await (
        await req('POST', '/api/cards', { tour_id: tourId, title: 'Aufstieg' })
      ).json()) as Card
      expect(a.kind).toBe('text') // Default
      const b = (await (
        await req('POST', '/api/cards', { tour_id: tourId, title: 'Gipfel', body_md: '**top**' })
      ).json()) as Card
      expect(a.position).toBe(0)
      expect(b.position).toBe(1)
      cardA = a.id
      cardB = b.id
    })

    it('POST /api/cards mit kind=images legt eine Bilder-Kachel an', async () => {
      const res = await req('POST', '/api/cards', { tour_id: tourId, kind: 'images' })
      const card = (await res.json()) as Card
      expect(card.kind).toBe('images')
      await req('DELETE', `/api/cards/${card.id}`)
    })

    it('GET /api/tours/:id/cards liefert nach Position sortiert', async () => {
      const rows = (await (await req('GET', `/api/tours/${tourId}/cards`)).json()) as Card[]
      expect(rows.map((r) => r.id)).toEqual([cardA, cardB])
    })

    it('POST /api/cards/reorder dreht die Reihenfolge', async () => {
      const res = await req('POST', '/api/cards/reorder', {
        tour_id: tourId,
        ids: [cardB, cardA],
      })
      expect(res.status).toBe(200)
      const rows = (await res.json()) as Card[]
      expect(rows.map((r) => r.id)).toEqual([cardB, cardA])
      expect(rows.map((r) => r.position)).toEqual([0, 1])
    })

    it('PATCH /api/cards/:id ändert den Text', async () => {
      const res = await req('PATCH', `/api/cards/${cardA}`, { body_md: 'Neu' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as Card).body_md).toBe('Neu')
    })

    it('DELETE /api/cards/:id entfernt die Card aus der Liste', async () => {
      await req('DELETE', `/api/cards/${cardB}`)
      const rows = (await (await req('GET', `/api/tours/${tourId}/cards`)).json()) as Card[]
      expect(rows.map((r) => r.id)).toEqual([cardA])
    })

    it('Tour-Delete soft-deleted auch die Cards', async () => {
      await req('DELETE', `/api/tours/${tourId}`)
      const res = await req('GET', `/api/tours/${tourId}/cards`)
      expect(res.status).toBe(404) // Tour weg → 404, Cards mit-soft-deleted
    })

    it('Card für unbekannte Tour → 404', async () => {
      const res = await req('POST', '/api/cards', {
        tour_id: '00000000-0000-4000-8000-000000000000',
        title: 'x',
      })
      expect(res.status).toBe(404)
    })
  })

  describe('Images', () => {
    let tourId: string
    let cardId: string
    let imageId: string
    const SHA = 'a'.repeat(64)

    beforeAll(async () => {
      const tour = (await (
        await req('POST', '/api/tours', { name: 'Bilder-Testtour' })
      ).json()) as Tour
      tourId = tour.id
      const card = (await (
        await req('POST', '/api/cards', { tour_id: tourId, title: 'Mit Bild' })
      ).json()) as Card
      cardId = card.id
    })

    it('POST /api/images legt Metadaten an (201)', async () => {
      const res = await req('POST', '/api/images', {
        card_id: cardId,
        sha256: SHA,
        lat: 47.572,
        lon: 7.687,
        taken_at: '2026-08-30T10:15:00+02:00',
      })
      expect(res.status).toBe(201)
      const img = (await res.json()) as { id: string; upload_state: string; lat: number }
      expect(img.upload_state).toBe('pending')
      expect(img.lat).toBeCloseTo(47.572)
      imageId = img.id
    })

    it('Duplikat (gleiche sha256) liefert bestehende Zeile mit 200', async () => {
      const res = await req('POST', '/api/images', { card_id: cardId, sha256: SHA })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { id: string }).id).toBe(imageId)
    })

    it('GET /api/tours/:id/images liefert die Bilder der Tour', async () => {
      const res = await req('GET', `/api/tours/${tourId}/images`)
      expect(res.status).toBe(200)
      const rows = (await res.json()) as { id: string }[]
      expect(rows.map((r) => r.id)).toEqual([imageId])
    })

    it('PATCH /api/images/:id setzt upload_state und caption', async () => {
      const res = await req('PATCH', `/api/images/${imageId}`, {
        upload_state: 'uploaded',
        caption: 'Blick vom Grat',
      })
      expect(res.status).toBe(200)
      const img = (await res.json()) as { upload_state: string; caption: string | null }
      expect(img.upload_state).toBe('uploaded')
      expect(img.caption).toBe('Blick vom Grat')
    })

    it('POST für unbekannte Card → 404; kaputte sha256 → 400', async () => {
      const notFound = await req('POST', '/api/images', {
        card_id: '00000000-0000-4000-8000-000000000000',
        sha256: 'b'.repeat(64),
      })
      expect(notFound.status).toBe(404)
      const invalid = await req('POST', '/api/images', { card_id: cardId, sha256: 'zu-kurz' })
      expect(invalid.status).toBe(400)
    })

    it('DELETE /api/images/:id entfernt die Zeile', async () => {
      const res = await req('DELETE', `/api/images/${imageId}`)
      expect(res.status).toBe(204)
      const rows = (await (
        await req('GET', `/api/tours/${tourId}/images`)
      ).json()) as unknown[]
      expect(rows).toHaveLength(0)
    })
  })

  describe('R2-Ableitungen', () => {
    let cardId: string
    let imageId: string
    const SHA = 'c'.repeat(64)
    const ORPHAN_SHA = 'd'.repeat(64)
    const bytes = new Uint8Array([1, 2, 3, 4, 5])

    function putVariant(sha: string, variant: string, body: Uint8Array, type = 'image/webp') {
      return app.request(
        `/api/images/${sha}/${variant}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': type },
          body,
        },
        env
      )
    }

    beforeAll(async () => {
      const tour = (await (
        await req('POST', '/api/tours', { name: 'R2-Testtour' })
      ).json()) as Tour
      const card = (await (
        await req('POST', '/api/cards', { tour_id: tour.id, title: 'R2' })
      ).json()) as Card
      cardId = card.id
      const img = (await (
        await req('POST', '/api/images', { card_id: cardId, sha256: SHA })
      ).json()) as { id: string }
      imageId = img.id
    })

    it('PUT lädt eine Ableitung nach R2, GET liefert sie mit Content-Type zurück', async () => {
      const put = await putVariant(SHA, 'display', bytes)
      expect(put.status).toBe(200)
      expect(((await put.json()) as { key: string }).key).toBe(`images/${SHA}/display`)

      const get = await req('GET', `/api/images/${SHA}/display`)
      expect(get.status).toBe(200)
      expect(get.headers.get('content-type')).toBe('image/webp')
      expect(get.headers.get('cache-control')).toContain('immutable')
      expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes)
    })

    it('validiert sha, variant und Content-Type', async () => {
      expect((await req('GET', '/api/images/zu-kurz/display')).status).toBe(400)
      expect((await req('GET', `/api/images/${SHA}/original`)).status).toBe(400)
      expect((await putVariant(SHA, 'thumb', bytes, 'text/plain')).status).toBe(400)
      expect((await req('GET', `/api/images/${'e'.repeat(64)}/display`)).status).toBe(404)
    })

    it('GET /api/images?state=pending listet fürs Upload-Queueing', async () => {
      const res = await req('GET', '/api/images?state=pending')
      const rows = (await res.json()) as { id: string }[]
      expect(rows.some((r) => r.id === imageId)).toBe(true)
    })

    it('PUT für eine sha ohne eigenes Bild → 404 (Besitz-Check)', async () => {
      const res = await putVariant(ORPHAN_SHA, 'thumb', bytes)
      expect(res.status).toBe(404)
    })

    it('r2-cleanup listet Waisen im Dry-Run und löscht mit dry=0', async () => {
      // Waise direkt in R2 ablegen (über die API ist das nicht mehr möglich).
      await memR2.put(`images/${ORPHAN_SHA}/thumb`, bytes.buffer as ArrayBuffer)
      const dry = (await (
        await req('POST', '/api/admin/r2-cleanup')
      ).json()) as { dryRun: boolean; orphans: string[] }
      expect(dry.dryRun).toBe(true)
      expect(dry.orphans).toContain(`images/${ORPHAN_SHA}/thumb`)
      expect(dry.orphans).not.toContain(`images/${SHA}/display`)

      const real = (await (
        await req('POST', '/api/admin/r2-cleanup?dry=0')
      ).json()) as { orphans: string[] }
      expect(real.orphans).toContain(`images/${ORPHAN_SHA}/thumb`)
      expect((await req('GET', `/api/images/${ORPHAN_SHA}/thumb`)).status).toBe(404)
    })

    it('DELETE /api/images/:id entfernt auch die R2-Objekte', async () => {
      await putVariant(SHA, 'thumb', bytes)
      const res = await req('DELETE', `/api/images/${imageId}`)
      expect(res.status).toBe(204)
      expect((await req('GET', `/api/images/${SHA}/display`)).status).toBe(404)
      expect((await req('GET', `/api/images/${SHA}/thumb`)).status).toBe(404)
    })
  })

  describe('Sharing (visibility public)', () => {
    let tourId: string
    let cardId: string
    const SHA = 'f'.repeat(64)
    const bytes = new Uint8Array([9, 8, 7])

    function putVariantAs(token: string) {
      return app.request(
        `/api/images/${SHA}/thumb`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/webp' },
          body: bytes,
        },
        env
      )
    }

    beforeAll(async () => {
      const tour = (await (
        await req('POST', '/api/tours', { name: 'Geteilte Tour' })
      ).json()) as Tour
      tourId = tour.id
      const card = (await (
        await req('POST', '/api/cards', { tour_id: tourId, title: 'Öffentlich' })
      ).json()) as Card
      cardId = card.id
      await req('POST', '/api/images', { card_id: cardId, sha256: SHA })
      await app.request(
        `/api/images/${SHA}/display`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/webp' },
          body: bytes,
        },
        env
      )
    })

    it('privat: B sieht die Tour nirgends, Cards und R2 → 404', async () => {
      const shared = (await (
        await req('GET', '/api/tours/shared', undefined, TOKEN_B)
      ).json()) as Tour[]
      expect(shared.some((t) => t.id === tourId)).toBe(false)
      expect((await req('GET', `/api/tours/${tourId}/cards`, undefined, TOKEN_B)).status).toBe(404)
      expect((await req('GET', `/api/images/${SHA}/display`, undefined, TOKEN_B)).status).toBe(404)
    })

    it('visibility=public macht die Tour für B sichtbar (inkl. Book und R2)', async () => {
      const patch = await req('PATCH', `/api/tours/${tourId}`, { visibility: 'public' })
      expect(patch.status).toBe(200)
      expect(((await patch.json()) as Tour).visibility).toBe('public')

      const shared = (await (
        await req('GET', '/api/tours/shared', undefined, TOKEN_B)
      ).json()) as (Tour & { owner_name: string | null })[]
      const found = shared.find((t) => t.id === tourId)
      expect(found).toBeDefined()
      // USER_A existiert nicht im Neon-Auth-Verzeichnis → Name bleibt null.
      expect(found!.owner_name).toBeNull()

      expect((await req('GET', `/api/tours/${tourId}/cards`, undefined, TOKEN_B)).status).toBe(200)
      expect((await req('GET', `/api/tours/${tourId}/images`, undefined, TOKEN_B)).status).toBe(200)
      expect((await req('GET', `/api/images/${SHA}/display`, undefined, TOKEN_B)).status).toBe(200)
    })

    it('eigene Touren tauchen in /api/tours/shared nicht auf', async () => {
      const own = (await (await req('GET', '/api/tours/shared')).json()) as Tour[]
      expect(own.some((t) => t.id === tourId)).toBe(false)
    })

    it('öffentlich bleibt read-only: B kann nichts ändern oder hochladen', async () => {
      expect(
        (await req('PATCH', `/api/tours/${tourId}`, { name: 'gekapert' }, TOKEN_B)).status
      ).toBe(404)
      expect((await req('POST', '/api/cards', { tour_id: tourId }, TOKEN_B)).status).toBe(404)
      expect(
        (await req('PATCH', `/api/cards/${cardId}`, { title: 'fremd' }, TOKEN_B)).status
      ).toBe(404)
      expect((await req('DELETE', `/api/cards/${cardId}`, undefined, TOKEN_B)).status).toBe(404)
      expect((await putVariantAs(TOKEN_B)).status).toBe(404)
    })

    it('zurück auf privat entzieht B den Zugriff wieder', async () => {
      await req('PATCH', `/api/tours/${tourId}`, { visibility: 'private' })
      expect((await req('GET', `/api/tours/${tourId}/cards`, undefined, TOKEN_B)).status).toBe(404)
      expect((await req('GET', `/api/images/${SHA}/display`, undefined, TOKEN_B)).status).toBe(404)
    })
  })

  describe('Settings', () => {
    it('PUT + GET Roundtrip, Upsert überschreibt', async () => {
      await req('PUT', '/api/settings/map', { value: { layers: ['wanderwege'], zoom: 12 } })
      await req('PUT', '/api/settings/map', { value: { layers: [], zoom: 9 } })
      const all = (await (await req('GET', '/api/settings')).json()) as Record<string, unknown>
      expect(all.map).toEqual({ layers: [], zoom: 9 })
    })
  })

  describe('Fehlerformat', () => {
    it('unbekannte Route → 404 { error: { code, message } }', async () => {
      const res = await req('GET', '/api/nix')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('not_found')
      expect(typeof body.error.message).toBe('string')
    })

    it('ungültige UUID → 400', async () => {
      const res = await req('PATCH', '/api/tours/keine-uuid', { name: 'x' })
      expect(res.status).toBe(400)
    })

    it('kaputtes JSON → 400 invalid_json', async () => {
      const res = await app.request(
        '/api/tours',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: '{kaputt',
        },
        env
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('invalid_json')
    })
  })
})
