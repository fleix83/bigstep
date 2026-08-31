import type { LonLat } from './types'

export interface RouteResult {
  /** Segmentlinie inkl. beider Endpunkte, [lon, lat]. */
  line: LonLat[]
  /** false ⇒ Luftlinien-Fallback (Routing fehlgeschlagen oder bewusst deaktiviert). */
  ok: boolean
}

export interface RoutingProvider {
  route(from: LonLat, to: LonLat): Promise<RouteResult>
}

/** Luftlinie – als bewusster Fallback und für Tests. `ok` ist hier true. */
export class StraightLineProvider implements RoutingProvider {
  route(from: LonLat, to: LonLat): Promise<RouteResult> {
    return Promise.resolve({ line: [from, to], ok: true })
  }
}

export interface BRouterOptions {
  /** Default: offizieller Server https://brouter.de/brouter */
  baseUrl?: string
  /** Default: hiking-mountain (am 2026-08-31 auf brouter.de verifiziert, BRouter 1.7.10). */
  profile?: string
  /** Abbruch nach … ms, danach Luftlinie mit ok:false (PRD 7.3). Default 5000. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * Segment-Routing über die BRouter-Web-API (OSM-Wanderwegnetz, Hiking-Profil).
 * Antwortformat GeoJSON; Höhen aus der Antwort werden verworfen — Auf-/Abstieg
 * kommt einheitlich aus dem GeoAdmin-Höhenprofil. Fehler und Timeouts liefern
 * die Luftlinie mit ok:false, damit der Editor nie blockiert.
 */
export class BRouterProvider implements RoutingProvider {
  private baseUrl: string
  private profile: string
  private timeoutMs: number
  private fetchImpl: typeof fetch

  constructor(opts: BRouterOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://brouter.de/brouter'
    this.profile = opts.profile ?? 'hiking-mountain'
    this.timeoutMs = opts.timeoutMs ?? 5000
    // Wrapper statt Direktzuweisung: `this.fetchImpl(...)` würde fetch sonst
    // mit dem Provider als `this` aufrufen → "Illegal invocation" im Browser.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  async route(from: LonLat, to: LonLat): Promise<RouteResult> {
    const fallback: RouteResult = { line: [from, to], ok: false }
    const url =
      `${this.baseUrl}?lonlats=${from[0]},${from[1]}|${to[0]},${to[1]}` +
      `&profile=${encodeURIComponent(this.profile)}&alternativeidx=0&format=geojson`
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      let res: Response
      try {
        res = await this.fetchImpl(url, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) return fallback
      const body = (await res.json()) as {
        features?: { geometry?: { type?: string; coordinates?: number[][] } }[]
      }
      const coords = body.features?.[0]?.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) return fallback
      const line = coords.map((c): LonLat => [c[0]!, c[1]!])
      return { line, ok: true }
    } catch {
      return fallback
    }
  }
}

/**
 * Setzt Segmentlinien zu einer Gesamtlinie zusammen; identische Nahtpunkte
 * (Ende von i = Anfang von i+1) werden nicht doppelt aufgenommen.
 */
export function concatSegments(segments: { line: LonLat[] }[]): LonLat[] {
  const out: LonLat[] = []
  for (const seg of segments) {
    for (const p of seg.line) {
      const last = out[out.length - 1]
      if (last && last[0] === p[0] && last[1] === p[1]) continue
      out.push(p)
    }
  }
  return out
}
