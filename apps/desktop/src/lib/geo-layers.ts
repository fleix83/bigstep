/**
 * swisstopo-WMTS-Layer (WebMercator, EPSG:3857).
 *
 * IDs, Bildformate und Max-Zoom am 2026-08-31 verifiziert gegen
 * https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml
 * (TileMatrixSet «3857_19» ⇒ Kacheln bis Zoom 19, «3857_18» bis 18 usw.;
 * darüber skaliert MapLibre die Kacheln hoch).
 *
 * Schneehöhe (SLF, PRD F2 Overlay 3): weder im geoadmin-WMTS noch im
 * geoadmin-WMS noch im öffentlichen SLF-WMTS (map.slf.ch) als Kachel-Layer
 * vorhanden — Feature vorerst gestrichen, siehe CHANGELOG.
 */

export interface WmtsLayerDef {
  /** geoadmin-Layer-ID */
  id: string
  /** Beschriftung im Layer-Panel */
  label: string
  /** Bildformat laut GetCapabilities */
  ext: 'jpeg' | 'png'
  /** Höchste vom Dienst ausgelieferte Zoomstufe */
  maxzoom: number
}

export const BASE_LAYERS = {
  karte: {
    id: 'ch.swisstopo.pixelkarte-farbe',
    label: 'Landeskarte',
    ext: 'jpeg',
    maxzoom: 19,
  },
  luftbild: {
    id: 'ch.swisstopo.swissimage',
    label: 'Luftbild',
    ext: 'jpeg',
    maxzoom: 20,
  },
} as const satisfies Record<string, WmtsLayerDef>

export const OVERLAY_LAYERS = {
  wanderwege: {
    id: 'ch.swisstopo.swisstlm3d-wanderwege',
    label: 'Wanderwege',
    ext: 'png',
    maxzoom: 18,
  },
  haltestellen: {
    id: 'ch.bav.haltestellen-oev',
    label: 'ÖV-Haltestellen',
    ext: 'png',
    maxzoom: 18,
  },
  wildruhezonen: {
    id: 'ch.bafu.wrz-wildruhezonen_portal',
    label: 'Wildruhezonen',
    ext: 'png',
    maxzoom: 18,
  },
} as const satisfies Record<string, WmtsLayerDef>

export type BaseKey = keyof typeof BASE_LAYERS
export type OverlayKey = keyof typeof OVERLAY_LAYERS

export const BASE_KEYS = Object.keys(BASE_LAYERS) as BaseKey[]
export const OVERLAY_KEYS = Object.keys(OVERLAY_LAYERS) as OverlayKey[]

export function wmtsTileUrl(def: WmtsLayerDef): string {
  return `https://wmts.geo.admin.ch/1.0.0/${def.id}/default/current/3857/{z}/{x}/{y}.${def.ext}`
}
