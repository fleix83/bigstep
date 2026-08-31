import { describe, expect, it } from 'vitest'
import {
  BRouterProvider,
  StraightLineProvider,
  concatSegments,
} from '../src/routing'
import { hikingTimeMin, wgs84ToLv95 } from '../src/geo'
import type { LonLat } from '../src/types'

const A: LonLat = [7.6, 47.56]
const B: LonLat = [7.62, 47.57]

describe('StraightLineProvider', () => {
  it('liefert die Luftlinie mit ok:true', async () => {
    const r = await new StraightLineProvider().route(A, B)
    expect(r).toEqual({ line: [A, B], ok: true })
  })
})

describe('BRouterProvider', () => {
  const geojson = (coords: number[][]) =>
    new Response(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }],
      })
    )

  it('parst die GeoJSON-Antwort und verwirft Höhen', async () => {
    const provider = new BRouterProvider({
      fetchImpl: async (url) => {
        expect(String(url)).toContain('profile=hiking-mountain')
        expect(String(url)).toContain('7.6,47.56|7.62,47.57')
        return geojson([
          [7.6, 47.56, 260],
          [7.61, 47.565, 280],
          [7.62, 47.57, 300],
        ])
      },
    })
    const r = await provider.route(A, B)
    expect(r.ok).toBe(true)
    expect(r.line).toEqual([
      [7.6, 47.56],
      [7.61, 47.565],
      [7.62, 47.57],
    ])
  })

  it('fällt bei HTTP-Fehler auf die Luftlinie mit ok:false zurück', async () => {
    const provider = new BRouterProvider({
      fetchImpl: async () => new Response('kaputt', { status: 500 }),
    })
    expect(await provider.route(A, B)).toEqual({ line: [A, B], ok: false })
  })

  it('fällt bei Netzwerkfehler und leerer Antwort zurück', async () => {
    const boom = new BRouterProvider({
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    expect(await boom.route(A, B)).toEqual({ line: [A, B], ok: false })

    const empty = new BRouterProvider({ fetchImpl: async () => geojson([]) })
    expect(await empty.route(A, B)).toEqual({ line: [A, B], ok: false })
  })

  it('bricht nach timeoutMs ab (Luftlinie, ok:false)', async () => {
    const provider = new BRouterProvider({
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    expect(await provider.route(A, B)).toEqual({ line: [A, B], ok: false })
  })
})

describe('concatSegments', () => {
  it('entfernt doppelte Nahtpunkte', () => {
    const merged = concatSegments([
      { line: [A, [7.61, 47.565], B] },
      { line: [B, [7.63, 47.575]] },
    ])
    expect(merged).toEqual([A, [7.61, 47.565], B, [7.63, 47.575]])
  })
})

describe('hikingTimeMin (PRD-F3-Referenzfälle)', () => {
  it('flach: 10 km ohne Höhenmeter', () => {
    // horizontal 142.86 min, vertikal 0 ⇒ 143 min
    expect(hikingTimeMin(10_000, 0, 0)).toBe(143)
  })
  it('steil bergauf: 5 km, 900 Hm Aufstieg', () => {
    // horizontal 71.43, vertikal 180 ⇒ 180 + 35.71 = 216 min
    expect(hikingTimeMin(5_000, 900, 0)).toBe(216)
  })
  it('bergab: 8 km, 1000 Hm Abstieg', () => {
    // horizontal 114.29, vertikal 120 ⇒ 120 + 57.14 = 177 min
    expect(hikingTimeMin(8_000, 0, 1000)).toBe(177)
  })
})

describe('wgs84ToLv95', () => {
  it('trifft den Bern-Referenzpunkt auf < 2 m', () => {
    const [e, n] = wgs84ToLv95([7.43863, 46.95108])
    expect(Math.abs(e - 2600000)).toBeLessThan(2)
    expect(Math.abs(n - 1200000)).toBeLessThan(2)
  })
})
