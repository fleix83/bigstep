import { BASE_KEYS, OVERLAY_KEYS, type BaseKey, type OverlayKey } from './geo-layers'

/** In `settings.map_state` persistierter Kartenzustand (PRD F2). */
export interface MapState {
  center: [number, number]
  zoom: number
  base: BaseKey
  overlays: Record<OverlayKey, boolean>
  showOthers: boolean
}

export const DEFAULT_MAP_STATE: MapState = {
  center: [8.2275, 46.8182], // Schweiz-Mitte
  zoom: 7,
  base: 'karte',
  overlays: { wanderwege: false, haltestellen: false, wildruhezonen: false },
  showOthers: false,
}

/** Defensive Wiederherstellung: unbekannte/kaputte Werte fallen auf Defaults zurück. */
export function parseMapState(raw: unknown): MapState {
  const state = structuredClone(DEFAULT_MAP_STATE)
  if (typeof raw !== 'object' || raw === null) return state
  const r = raw as Record<string, unknown>

  if (
    Array.isArray(r.center) &&
    r.center.length === 2 &&
    r.center.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    state.center = [r.center[0] as number, r.center[1] as number]
  }
  if (typeof r.zoom === 'number' && r.zoom >= 0 && r.zoom <= 22) state.zoom = r.zoom
  if (typeof r.base === 'string' && (BASE_KEYS as string[]).includes(r.base)) {
    state.base = r.base as BaseKey
  }
  if (typeof r.overlays === 'object' && r.overlays !== null) {
    for (const key of OVERLAY_KEYS) {
      const v = (r.overlays as Record<string, unknown>)[key]
      if (typeof v === 'boolean') state.overlays[key] = v
    }
  }
  if (typeof r.showOthers === 'boolean') state.showOthers = r.showOthers
  return state
}
