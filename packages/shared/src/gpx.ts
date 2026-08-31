import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import type { LineString } from './types'

export class GpxParseError extends Error {}

export interface ParsedGpx {
  /** Name aus <trk><name> bzw. <metadata><name>, sonst null. */
  name: string | null
  /** Alle Trackpunkte (Segmente aneinandergehängt), [lon, lat] oder [lon, lat, ele]. */
  line: LineString
}

interface XmlPoint {
  lat?: string | number
  lon?: string | number
  ele?: string | number
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function toCoord(p: XmlPoint): number[] {
  const lon = Number(p.lon)
  const lat = Number(p.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new GpxParseError('Trackpunkt ohne gültige lat/lon-Attribute')
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new GpxParseError(`Koordinate ausserhalb des gültigen Bereichs: ${lon},${lat}`)
  }
  const ele = p.ele === undefined ? undefined : Number(p.ele)
  return ele !== undefined && Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat]
}

/**
 * Liest einen GPX-Track (1.0/1.1). Alle <trkseg> aller <trk> werden zu einer
 * Linie aneinandergehängt; hat die Datei keine Tracks, wird auf <rte>
 * (Routenpunkte) zurückgegriffen. Wirft GpxParseError bei unbrauchbarem Inhalt.
 */
export function parseGpx(xml: string): ParsedGpx {
  let doc: Record<string, unknown>
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      // Namespace-Präfixe (z. B. gpxtpx:) unangetastet lassen; wir lesen nur Kernfelder.
      removeNSPrefix: false,
      parseTagValue: false,
      parseAttributeValue: false,
    })
    doc = parser.parse(xml) as Record<string, unknown>
  } catch (e) {
    throw new GpxParseError(`XML nicht lesbar: ${e instanceof Error ? e.message : String(e)}`)
  }

  const gpx = doc.gpx as
    | {
        metadata?: { name?: string }
        trk?: unknown
        rte?: unknown
      }
    | undefined
  if (!gpx || typeof gpx !== 'object') {
    throw new GpxParseError('Kein <gpx>-Wurzelelement gefunden')
  }

  const coords: number[][] = []
  let name: string | null = null

  const tracks = asArray(gpx.trk) as { name?: string; trkseg?: unknown }[]
  for (const trk of tracks) {
    if (name === null && typeof trk.name === 'string' && trk.name.trim()) name = trk.name.trim()
    for (const seg of asArray(trk.trkseg) as { trkpt?: unknown }[]) {
      for (const pt of asArray(seg.trkpt) as XmlPoint[]) {
        coords.push(toCoord(pt))
      }
    }
  }

  if (coords.length === 0) {
    const routes = asArray(gpx.rte) as { name?: string; rtept?: unknown }[]
    for (const rte of routes) {
      if (name === null && typeof rte.name === 'string' && rte.name.trim()) name = rte.name.trim()
      for (const pt of asArray(rte.rtept) as XmlPoint[]) {
        coords.push(toCoord(pt))
      }
    }
  }

  if (name === null) {
    const metaName = gpx.metadata?.name
    if (typeof metaName === 'string' && metaName.trim()) name = metaName.trim()
  }

  if (coords.length < 2) {
    throw new GpxParseError('GPX enthält keinen Track mit mindestens zwei Punkten')
  }

  return { name, line: { type: 'LineString', coordinates: coords } }
}

/**
 * Serialisiert eine Linie als GPX 1.1 mit einem Track und einem Segment.
 * Koordinaten werden unverändert (volle Präzision) geschrieben; Höhen nur,
 * wenn der Punkt eine hat. Roundtrip parse→serialize→parse ist verlustfrei.
 */
export function serializeGpx(name: string, line: LineString): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
  })
  const trkpt = line.coordinates.map((c) => {
    // lat/lon sind Attribute, ele ist ein Kind-Element (GPX-1.1-Schema).
    const pt: Record<string, unknown> = { '@_lat': String(c[1]), '@_lon': String(c[0]) }
    if (typeof c[2] === 'number' && Number.isFinite(c[2])) pt.ele = String(c[2])
    return pt
  })
  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    gpx: {
      '@_version': '1.1',
      '@_creator': 'Tourenbuch',
      '@_xmlns': 'http://www.topografix.com/GPX/1/1',
      metadata: { name },
      trk: { name, trkseg: { trkpt } },
    },
  }
  return builder.build(doc) as string
}
