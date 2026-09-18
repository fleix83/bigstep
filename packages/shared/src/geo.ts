import type { BBox, LineString, LonLat } from './types'

const EARTH_RADIUS_M = 6371000

/** Grosskreis-Distanz zweier Punkte in Metern (Haversine). */
export function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180
  const dLat = (b[1] - a[1]) * toRad
  const dLon = (b[0] - a[0]) * toRad
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/**
 * Nächster Punkt einer Linie zu `pt` (Fusspunkt auf dem nächsten Segment) samt
 * Distanz in Metern. Lokale äquirektanguläre Näherung – für Tour-Massstäbe
 * (wenige km, GPS-Abweichungen von Metern) völlig ausreichend.
 */
export function nearestPointOnLine(line: LineString, pt: LonLat): { point: LonLat; distM: number } {
  const c = line.coordinates
  if (c.length === 0) return { point: pt, distM: Number.POSITIVE_INFINITY }
  const kx = Math.cos((pt[1] * Math.PI) / 180)
  const toXY = (p: number[]): [number, number] => [(p[0]! - pt[0]) * kx, p[1]! - pt[1]]
  let bestPoint: LonLat = [c[0]![0]!, c[0]![1]!]
  const a0 = toXY(c[0]!)
  let bestD2 = a0[0] * a0[0] + a0[1] * a0[1]
  for (let i = 1; i < c.length; i++) {
    const a = toXY(c[i - 1]!)
    const b = toXY(c[i]!)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : (-a[0] * dx - a[1] * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    const d2 = px * px + py * py
    if (d2 < bestD2) {
      bestD2 = d2
      bestPoint = [pt[0] + px / kx, pt[1] + py]
    }
  }
  return { point: bestPoint, distM: haversineM(pt, bestPoint) }
}

/** Gesamtlänge einer Linie in Metern (gerundet). */
export function lineDistanceM(line: LineString): number {
  let sum = 0
  const c = line.coordinates
  for (let i = 1; i < c.length; i++) {
    const prev = c[i - 1]!
    const cur = c[i]!
    sum += haversineM([prev[0]!, prev[1]!], [cur[0]!, cur[1]!])
  }
  return Math.round(sum)
}

/** [minLon, minLat, maxLon, maxLat] einer Linie. */
export function lineBbox(line: LineString): BBox {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const coord of line.coordinates) {
    const lon = coord[0]!
    const lat = coord[1]!
    if (lon < minLon) minLon = lon
    if (lat < minLat) minLat = lat
    if (lon > maxLon) maxLon = lon
    if (lat > maxLat) maxLat = lat
  }
  return [minLon, minLat, maxLon, maxLat]
}

/**
 * Auf-/Abstieg aus den Höhenwerten einer Linie. Kleine Schwankungen unterhalb
 * der Schwelle (GPS-Rauschen) werden ignoriert, indem erst ab `threshold`
 * Metern kumulierter Differenz gezählt wird. `null`, wenn Höhen fehlen.
 */
export function elevationGainLoss(
  line: LineString,
  threshold = 3
): { ascent_m: number; descent_m: number } | null {
  const eles = line.coordinates
    .map((c) => c[2])
    .filter((e): e is number => typeof e === 'number' && Number.isFinite(e))
  if (eles.length < 2 || eles.length !== line.coordinates.length) return null

  let ascent = 0
  let descent = 0
  let ref = eles[0]!
  for (let i = 1; i < eles.length; i++) {
    const ele = eles[i]!
    const diff = ele - ref
    if (diff >= threshold) {
      ascent += diff
      ref = ele
    } else if (diff <= -threshold) {
      descent += -diff
      ref = ele
    }
  }
  return { ascent_m: Math.round(ascent), descent_m: Math.round(descent) }
}

/**
 * WGS84 → LV95 (EPSG:2056) mit den offiziellen swisstopo-Näherungsformeln
 * («Näherungslösung», Genauigkeit ≈ 1 m — ausreichend für Höhenprofile).
 * Nötig, weil api3.geo.admin.ch/rest/services/profile.json nur sr=2056/21781
 * akzeptiert (sr=4326 wird mit HTTP 400 abgelehnt; am 2026-08-31 verifiziert).
 */
export function wgs84ToLv95([lon, lat]: LonLat): [number, number] {
  const p = (lat * 3600 - 169028.66) / 10000
  const l = (lon * 3600 - 26782.5) / 10000
  const e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3
  const n =
    1200147.07 +
    308807.95 * p +
    3745.25 * l * l +
    76.63 * p * p -
    194.56 * l * l * p +
    119.79 * p ** 3
  return [Math.round(e * 100) / 100, Math.round(n * 100) / 100]
}

/**
 * Wanderzeit nach der vereinfachten Formel der Schweizer Wanderwege (PRD F3):
 * 4.2 km/h horizontal, 300 Hm/h Aufstieg, 500 Hm/h Abstieg;
 * Gesamtzeit = grösserer Wert + halber kleinerer Wert. Ergebnis in Minuten.
 */
export function hikingTimeMin(distanceM: number, ascentM: number, descentM: number): number {
  const horizontalMin = (distanceM / 1000 / 4.2) * 60
  const verticalMin = (ascentM / 300) * 60 + (descentM / 500) * 60
  const bigger = Math.max(horizontalMin, verticalMin)
  const smaller = Math.min(horizontalMin, verticalMin)
  return Math.round(bigger + smaller / 2)
}
