import { elevationGainLoss, wgs84ToLv95, type LineString } from '@tourenbuch/shared'

export interface ElevationStats {
  ascent_m: number
  descent_m: number
}

// GeoAdmin Fair Use: 20 Requests/min über alle REST-Dienste; wir bleiben mit
// 15/min bewusst darunter (PRD §7.1). Zusätzlich ruft der Editor nur nach
// abgeschlossenen Änderungen (500 ms Ruhe) auf.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 15
const requestTimes: number[] = []

/** true, wenn gerade ein Request-Slot frei ist (ohne ihn zu belegen). */
export function elevationSlotFree(): boolean {
  const cutoff = Date.now() - WINDOW_MS
  while (requestTimes.length > 0 && requestTimes[0]! < cutoff) requestTimes.shift()
  return requestTimes.length < MAX_PER_WINDOW
}

/**
 * Auf-/Abstieg einer Route über das GeoAdmin-Höhenprofil.
 * profile.json akzeptiert nur LV95/LV03 (sr=4326 → HTTP 400, verifiziert
 * 2026-08-31), darum Transformation über wgs84ToLv95. Liefert null bei
 * Drosselung, Netzfehler oder unbrauchbarer Antwort — der Aufrufer behält
 * dann die bisherigen Werte und versucht es bei der nächsten Änderung erneut.
 */
export async function fetchElevationStats(
  line: LineString,
  fetchImpl: typeof fetch = fetch
): Promise<ElevationStats | null> {
  if (line.coordinates.length < 2) return null
  if (!elevationSlotFree()) return null
  requestTimes.push(Date.now())

  // Lange Routen ausdünnen, damit der POST-Body klein bleibt; das Profil wird
  // ohnehin serverseitig auf nb_points Stützstellen gerechnet.
  const coords = line.coordinates
  const step = Math.max(1, Math.ceil(coords.length / 500))
  const sampled = coords.filter((_, i) => i % step === 0)
  const last = coords[coords.length - 1]!
  const sampledLast = sampled[sampled.length - 1]!
  if (sampledLast[0] !== last[0] || sampledLast[1] !== last[1]) sampled.push(last)

  const lv95 = sampled.map((c) => wgs84ToLv95([c[0]!, c[1]!]))
  try {
    const res = await fetchImpl('https://api3.geo.admin.ch/rest/services/profile.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        geom: JSON.stringify({ type: 'LineString', coordinates: lv95 }),
        sr: '2056',
        nb_points: '200',
      }),
    })
    if (!res.ok) return null
    const points = (await res.json()) as { alts?: { COMB?: number } }[]
    const eles = points
      .map((p) => p.alts?.COMB)
      .filter((e): e is number => typeof e === 'number' && Number.isFinite(e))
    if (eles.length < 2) return null
    // Pseudo-LineString: elevationGainLoss liest nur die dritte Komponente.
    return elevationGainLoss({
      type: 'LineString',
      coordinates: eles.map((e, i) => [0, i, e]),
    })
  } catch {
    return null
  }
}
