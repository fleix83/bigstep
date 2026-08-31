import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MaplibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import { useQuery } from '@tanstack/react-query'
import type { Tour } from '@tourenbuch/shared'
import { useApi } from '../lib/api'
import {
  BASE_LAYERS,
  OVERLAY_KEYS,
  OVERLAY_LAYERS,
  wmtsTileUrl,
  type BaseKey,
  type OverlayKey,
} from '../lib/geo-layers'
import { DEFAULT_MAP_STATE, parseMapState, type MapState } from '../lib/map-state'

// MapLibre sucht seinen Worker relativ zu import.meta.url; nach Vites
// Prebundling zeigt das auf .vite/deps/, wo das Worker-File fehlt — die Karte
// hängt dann stumm (GeoJSON lädt nie, `load` feuert nie). Zusätzlich lässt
// Vites Dev-Server den Request hängen, wenn das File direkt als
// Worker-Entry angefragt wird (Sec-Fetch-Dest: worker). Darum ein
// Blob-Wrapper, der das File per ESM-Import lädt — der Weg funktioniert in
// Dev und im Prod-Build.
const absoluteWorkerUrl = new URL(maplibreWorkerUrl, window.location.href).href
setWorkerUrl(
  URL.createObjectURL(
    new Blob([`import ${JSON.stringify(absoluteWorkerUrl)}`], { type: 'text/javascript' })
  )
)

interface Props {
  /** Aktive Tour (Route wird hervorgehoben, Karte fliegt zur bbox). */
  tour: Tour | null
  /** Alle Touren, für die schwache Anzeige der übrigen Routen. */
  tours: Tour[] | undefined
  /** false, solange der Book-Reiter offen ist (Karte bleibt gemountet). */
  visible: boolean
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function lineFeature(tour: Tour): Feature | null {
  if (!tour.geometry) return null
  return { type: 'Feature', properties: { id: tour.id }, geometry: tour.geometry }
}

function buildStyle(state: MapState): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [],
  }
  for (const [key, def] of Object.entries(BASE_LAYERS)) {
    style.sources[`src-${key}`] = {
      type: 'raster',
      tiles: [wmtsTileUrl(def)],
      tileSize: 256,
      maxzoom: def.maxzoom,
      attribution: '© swisstopo',
    }
    style.layers.push({
      id: `base-${key}`,
      type: 'raster',
      source: `src-${key}`,
      layout: { visibility: state.base === key ? 'visible' : 'none' },
    })
  }
  for (const [key, def] of Object.entries(OVERLAY_LAYERS)) {
    style.sources[`src-${key}`] = {
      type: 'raster',
      tiles: [wmtsTileUrl(def)],
      tileSize: 256,
      maxzoom: def.maxzoom,
      attribution: '© swisstopo',
    }
    style.layers.push({
      id: `ovl-${key}`,
      type: 'raster',
      source: `src-${key}`,
      layout: { visibility: state.overlays[key as OverlayKey] ? 'visible' : 'none' },
    })
  }
  style.sources['other-tours'] = { type: 'geojson', data: EMPTY_FC }
  style.sources['active-tour'] = { type: 'geojson', data: EMPTY_FC }
  style.layers.push(
    {
      id: 'other-tours-line',
      type: 'line',
      source: 'other-tours',
      layout: { visibility: state.showOthers ? 'visible' : 'none' },
      paint: { 'line-color': '#6b7280', 'line-width': 2, 'line-opacity': 0.5 },
    },
    {
      id: 'active-tour-casing',
      type: 'line',
      source: 'active-tour',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 6 },
    },
    {
      id: 'active-tour-line',
      type: 'line',
      source: 'active-tour',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2563eb', 'line-width': 3.5 },
    }
  )
  return style
}

export function MapView({ tour, tours, visible }: Props) {
  const api = useApi()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const [ready, setReady] = useState(false)

  // Zustand der Bedienelemente; null bis die Settings geladen sind.
  const [ui, setUi] = useState<Pick<MapState, 'base' | 'overlays' | 'showOthers'> | null>(null)
  // Spiegel für Callbacks (moveend), die nicht bei jedem Render neu binden sollen.
  const stateRef = useRef<MapState>(DEFAULT_MAP_STATE)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: Infinity,
    retry: 1,
  })
  const settingsDone = settingsQuery.isSuccess || settingsQuery.isError

  const saveTimer = useRef<number | undefined>(undefined)
  const lastSaved = useRef('')
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const map = mapRef.current
      if (!map) return
      const c = map.getCenter()
      const next: MapState = {
        ...stateRef.current,
        center: [Math.round(c.lng * 1e5) / 1e5, Math.round(c.lat * 1e5) / 1e5],
        zoom: Math.round(map.getZoom() * 100) / 100,
      }
      stateRef.current = next
      const json = JSON.stringify(next)
      if (json === lastSaved.current) return
      api
        .putSetting('map_state', next)
        .then(() => {
          lastSaved.current = json
        })
        .catch(() => {
          // Persistenz ist Komfort; ein Fehlschlag soll die Bedienung nicht
          // stören. lastSaved bleibt unverändert, damit die nächste Änderung
          // einen neuen Versuch auslöst.
        })
    }, 1000)
  }, [api])

  // Settings einmalig in den Startzustand übersetzen.
  useEffect(() => {
    if (!settingsDone || ui) return
    const state = parseMapState(settingsQuery.data?.map_state)
    stateRef.current = state
    setUi({ base: state.base, overlays: state.overlays, showOthers: state.showOthers })
  }, [settingsDone, settingsQuery.data, ui])

  // moveend-Handler soll die Karte nicht an die scheduleSave-Identität binden.
  const scheduleSaveRef = useRef(scheduleSave)
  scheduleSaveRef.current = scheduleSave

  // Karte GENAU EINMAL erzeugen, sobald der Startzustand steht. Wichtig:
  // keine Abhängigkeit auf `ui` selbst — sonst wird die Karte bei jedem
  // Toggle abgerissen und neu aufgebaut.
  const uiInitialized = ui !== null
  useEffect(() => {
    if (!uiInitialized || mapRef.current || !containerRef.current) return
    const map = new MaplibreMap({
      container: containerRef.current,
      style: buildStyle(stateRef.current),
      center: stateRef.current.center,
      zoom: stateRef.current.zoom,
      attributionControl: false,
    })
    // Attribution «© swisstopo» dauerhaft sichtbar (PRD F2, Pflicht).
    map.addControl(
      new AttributionControl({ compact: false, customAttribution: '© swisstopo' })
    )
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    // `style.load` feuert, sobald Quellen/Layer bereit sind — `load` würde
    // zusätzlich auf sämtliche initialen Kacheln warten.
    map.on('style.load', () => setReady(true))
    map.on('moveend', () => scheduleSaveRef.current())
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [uiInitialized])

  // Bedienelemente → Layer-Sichtbarkeit. Style-Mutationen sind nur erlaubt,
  // wenn der Style fertig geladen ist — sonst einmalig auf `idle` verschieben
  // (eine geworfene Exception würde sonst die ganze React-App abräumen).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ui) return
    stateRef.current = { ...stateRef.current, ...ui }
    const apply = () => {
      for (const key of Object.keys(BASE_LAYERS) as BaseKey[]) {
        map.setLayoutProperty(`base-${key}`, 'visibility', ui.base === key ? 'visible' : 'none')
      }
      for (const key of OVERLAY_KEYS) {
        map.setLayoutProperty(`ovl-${key}`, 'visibility', ui.overlays[key] ? 'visible' : 'none')
      }
      map.setLayoutProperty('other-tours-line', 'visibility', ui.showOthers ? 'visible' : 'none')
    }
    scheduleSave()
    if (map.isStyleLoaded()) {
      apply()
      return
    }
    map.once('idle', apply)
    return () => {
      map.off('idle', apply)
    }
  }, [ui, scheduleSave])

  // Aktive Route zeichnen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('active-tour') as GeoJSONSource | undefined
    const feature = tour ? lineFeature(tour) : null
    src?.setData(feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_FC)
  }, [tour, ready])

  // Übrige Touren schwach anzeigen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('other-tours') as GeoJSONSource | undefined
    const features = (tours ?? [])
      .filter((t) => t.id !== tour?.id)
      .map(lineFeature)
      .filter((f): f is Feature => f !== null)
    src?.setData({ type: 'FeatureCollection', features })
  }, [tours, tour?.id, ready])

  // Tourwechsel → Karte auf die gespeicherte bbox fliegen (PRD F5).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !tour?.bbox) return
    const [minLon, minLat, maxLon, maxLat] = tour.bbox
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 48, duration: 600, maxZoom: 15 }
    )
  }, [tour?.id, tour?.bbox, ready])

  // Nach Reiterwechsel hat sich die Containergrösse ggf. geändert.
  useEffect(() => {
    if (visible) mapRef.current?.resize()
  }, [visible])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {ui && (
        <div className="absolute right-2 top-2 z-10 w-48 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-md">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Basiskarte
          </div>
          {(Object.entries(BASE_LAYERS) as [BaseKey, (typeof BASE_LAYERS)[BaseKey]][]).map(
            ([key, def]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                <input
                  type="radio"
                  name="base"
                  checked={ui.base === key}
                  onChange={() => setUi({ ...ui, base: key })}
                />
                {def.label}
              </label>
            )
          )}

          <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Overlays
          </div>
          {OVERLAY_KEYS.map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={ui.overlays[key]}
                onChange={(e) =>
                  setUi({ ...ui, overlays: { ...ui.overlays, [key]: e.target.checked } })
                }
              />
              {OVERLAY_LAYERS[key].label}
            </label>
          ))}

          <div className="mt-3 border-t border-gray-100 pt-2">
            <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={ui.showOthers}
                onChange={(e) => setUi({ ...ui, showOthers: e.target.checked })}
              />
              Andere Touren
            </label>
          </div>
        </div>
      )}

      {tour && !tour.geometry && (
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-md bg-gray-900/80 px-3 py-1.5 text-sm text-white shadow">
          Noch keine Route
        </div>
      )}
    </div>
  )
}
