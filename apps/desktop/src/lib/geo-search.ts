/**
 * Ortssuche über den GeoAdmin SearchServer (type=locations: Orte, Flurnamen,
 * Haltestellen, Adressen; am 2026-09-01 verifiziert). sr=4326 liefert
 * attrs.lat/lon direkt in WGS84. CORS-offen, kein API-Key; Fair-Use wie die
 * übrigen REST-Dienste — die Suche ist debounced und feuert erst ab 2 Zeichen.
 */

export interface LocationResult {
  /** Reiner Text, z. B. «Sörenberg (LU) - Flühli». */
  label: string
  /** Objekttyp, z. B. «Ort», «Übrige Bahnen». */
  kind: string
  lon: number
  lat: number
  /** Zoomstufe-Empfehlung des Dienstes (grob), auf WebMercator gemappt. */
  zoom: number
}

interface RawResult {
  attrs?: {
    label?: string
    lat?: number
    lon?: number
    zoomlevel?: number
  }
}

function stripTags(html: string): { label: string; kind: string } {
  // Labels enthalten teils HTML-Entities (&lt;i&gt;…), erst decodieren.
  const decoded = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  const kind = /<i>(.*?)<\/i>/.exec(decoded)?.[1] ?? ''
  const label = decoded
    .replace(/<i>.*?<\/i>\s*/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
  return { label, kind }
}

export async function searchLocations(
  query: string,
  signal?: AbortSignal
): Promise<LocationResult[]> {
  const url =
    'https://api3.geo.admin.ch/rest/services/api/SearchServer' +
    `?searchText=${encodeURIComponent(query)}&type=locations&limit=8&sr=4326`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const body = (await res.json()) as { results?: RawResult[] }
  const out: LocationResult[] = []
  for (const r of body.results ?? []) {
    const a = r.attrs
    if (!a || typeof a.lat !== 'number' || typeof a.lon !== 'number') continue
    const { label, kind } = stripTags(a.label ?? '')
    if (!label) continue
    // GeoAdmin-zoomlevel (LV95-Stufen 0–13) grob auf WebMercator-Zoom mappen.
    const zoom = Math.min(17, (a.zoomlevel ?? 8) + 7)
    out.push({ label, kind, lon: a.lon, lat: a.lat, zoom })
  }
  return out
}
