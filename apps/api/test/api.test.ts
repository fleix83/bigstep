import { beforeAll, describe, expect, it } from 'vitest'
import { neon } from '@neondatabase/serverless'
import type { Card, Tour } from '@tourenbuch/shared'
import app from '../src/index'

// Läuft gegen den Neon-Branch "test" (PLAN Phase 1.5). Ohne TEST_DATABASE_URL
// werden die DB-Tests übersprungen (z. B. CI ohne Secret).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const TOKEN = 'test-token-phase1'

const env = { DATABASE_URL: TEST_DATABASE_URL ?? '', API_TOKEN: TOKEN }

function req(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
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
    const sql = neon(TEST_DATABASE_URL!)
    await sql`delete from images`
    await sql`delete from cards`
    await sql`delete from tours`
    await sql`delete from settings`
  })

  describe('Auth', () => {
    it('401 ohne Token', async () => {
      const res = await req('GET', '/api/health', undefined, null)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('unauthorized')
    })

    it('401 mit falschem Token', async () => {
      const res = await req('GET', '/api/health', undefined, 'falsch')
      expect(res.status).toBe(401)
    })

    it('200 mit korrektem Token', async () => {
      const res = await req('GET', '/api/health')
      expect(res.status).toBe(200)
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
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
      const b = (await (
        await req('POST', '/api/cards', { tour_id: tourId, title: 'Gipfel', body_md: '**top**' })
      ).json()) as Card
      expect(a.position).toBe(0)
      expect(b.position).toBe(1)
      cardA = a.id
      cardB = b.id
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

    it('PATCH /api/images/:id setzt upload_state', async () => {
      const res = await req('PATCH', `/api/images/${imageId}`, { upload_state: 'uploaded' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { upload_state: string }).upload_state).toBe('uploaded')
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
