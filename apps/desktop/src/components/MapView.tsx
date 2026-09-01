import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  GeolocateControl,
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
// `?worker&url` (statt `?url`): Vite bundelt den Worker im Prod-Build als
// eigenständiges Chunk MITSAMT seiner Abhängigkeit maplibre-gl-shared.mjs —
// mit blossem `?url` zeigte dessen relativer Import im Build ins Leere, der
// SPA-Fallback lieferte index.html (text/html) und der Karten-Worker starb.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import { useQuery } from '@tanstack/react-query'
import { lineBbox, type LineString, type Tour } from '@tourenbuch/shared'
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
import type { RouteEditor } from '../hooks/useRouteEditor'
import { MapSearch } from './MapSearch'
import { useIsMobile } from '../lib/use-read-only'
import type { LocationResult } from '../lib/geo-search'

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
  /** Import-Vorschau: gestrichelte Linie, Karte fliegt auf deren bbox. */
  preview?: LineString | null
  /** Aktiver Routen-Editor: Wegpunkt-Marker, Klick-/Drag-Interaktion. */
  editor?: RouteEditor | null
  /** Foto-Pins (Bilder mit GPS) der aktiven Tour. */
  photos?: PhotoPin[]
  onPhotoClick?: (cardId: string) => void
  /** Karten-Vollbild (Shell blendet Topbar/Sidebar/Tabs aus). */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

export interface PhotoPin {
  imageId: string
  cardId: string
  lon: number
  lat: number
  thumbUrl: string | null
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
  style.sources['import-preview'] = { type: 'geojson', data: EMPTY_FC }
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
      filter: ['!=', ['get', 'dashed'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2563eb', 'line-width': 3.5 },
    },
    {
      // Luftlinien-Segmente (Snapping aus oder Routing fehlgeschlagen).
      id: 'active-tour-dashed',
      type: 'line',
      source: 'active-tour',
      filter: ['==', ['get', 'dashed'], true],
      paint: { 'line-color': '#2563eb', 'line-width': 3, 'line-dasharray': [1.5, 1.5] },
    },
    {
      id: 'import-preview-line',
      type: 'line',
      source: 'import-preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ea580c',
        'line-width': 3.5,
        'line-dasharray': [2, 1.5],
      },
    }
  )
  return style
}

export function MapView({
  tour,
  tours,
  visible,
  preview = null,
  editor = null,
  photos = [],
  onPhotoClick,
  fullscreen = false,
  onToggleFullscreen,
}: Props) {
  const isMobile = useIsMobile()
  // Layer-Panel: auf dem Smartphone eingeklappt starten («möglichst viel Karte»).
  const [panelOpen, setPanelOpen] = useState(!isMobile)
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

  // Klick-Handler wird einmal registriert und liest den Editor über die Ref.
  const editorRef = useRef(editor)
  editorRef.current = editor

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
    // Standort-Button unten rechts (v. a. mobile PWA): GPS-Position mit
    // Puck und Genauigkeitskreis; braucht Secure Context (https/localhost).
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      'bottom-right'
    )
    // `style.load` feuert, sobald Quellen/Layer bereit sind — `load` würde
    // zusätzlich auf sämtliche initialen Kacheln warten.
    map.on('style.load', () => setReady(true))
    map.on('moveend', () => scheduleSaveRef.current())
    map.on('click', (e) => {
      const ed = editorRef.current
      if (!ed) return
      const p: [number, number] = [
        Math.round(e.lngLat.lng * 1e6) / 1e6,
        Math.round(e.lngLat.lat * 1e6) / 1e6,
      ]
      // Klick auf ein bestehendes Segment fügt dort einen Wegpunkt ein,
      // Klick auf freie Karte hängt einen Wegpunkt an.
      const hits = map.queryRenderedFeatures(
        [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ],
        { layers: ['active-tour-line', 'active-tour-dashed'] }
      )
      const segIdx = hits.find((f) => typeof f.properties?.segIdx === 'number')?.properties
        ?.segIdx as number | undefined
      if (segIdx !== undefined) ed.insertOnSegment(segIdx, p)
      else ed.addWaypoint(p)
    })
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

  // Aktive Route zeichnen: im Editor die Segmente (mit dashed-Markierung),
  // sonst die gespeicherte Geometrie der Tour.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('active-tour') as GeoJSONSource | undefined
    if (editor) {
      src?.setData(editor.segmentsFC)
      return
    }
    const feature = tour ? lineFeature(tour) : null
    src?.setData(feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_FC)
  }, [tour, editor, ready])

  // Wegpunkt-Marker im Editor: Drag verschiebt, Rechtsklick löscht.
  const markersRef = useRef<Marker[]>([])
  useEffect(() => {
    const map = mapRef.current
    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    if (!map || !ready || !editor) return
    editor.waypoints.forEach((wp, i) => {
      const el = document.createElement('div')
      const color =
        i === 0 ? '#16a34a' : i === editor.waypoints.length - 1 ? '#dc2626' : '#2563eb'
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:grab`
      el.title = 'Ziehen zum Verschieben, Rechtsklick zum Löschen'
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        editorRef.current?.deleteWaypoint(i)
      })
      const marker = new Marker({ element: el, draggable: true })
        .setLngLat([wp[0], wp[1]])
        .addTo(map)
      marker.on('dragend', () => {
        const ll = marker.getLngLat()
        editorRef.current?.moveWaypoint(i, [
          Math.round(ll.lng * 1e6) / 1e6,
          Math.round(ll.lat * 1e6) / 1e6,
        ])
      })
      markersRef.current.push(marker)
    })
    return () => {
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
    }
  }, [editor, ready])

  // Foto-Pins: Bilder mit GPS als Marker; Klick öffnet die zugehörige Card.
  const photoMarkersRef = useRef<Marker[]>([])
  const onPhotoClickRef = useRef(onPhotoClick)
  onPhotoClickRef.current = onPhotoClick
  useEffect(() => {
    const map = mapRef.current
    for (const m of photoMarkersRef.current) m.remove()
    photoMarkersRef.current = []
    if (!map || !ready || photos.length === 0) return
    for (const pin of photos) {
      const el = document.createElement('div')
      el.style.cssText =
        'width:30px;height:30px;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer;overflow:hidden;background:#e5e7eb;display:flex;align-items:center;justify-content:center'
      if (pin.thumbUrl) {
        const img = document.createElement('img')
        img.src = pin.thumbUrl
        img.style.cssText = 'width:100%;height:100%;object-fit:cover'
        el.appendChild(img)
      } else {
        el.textContent = '📷'
      }
      el.title = 'Card öffnen'
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onPhotoClickRef.current?.(pin.cardId)
      })
      const marker = new Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pin.lon, pin.lat])
        .addTo(map)
      photoMarkersRef.current.push(marker)
    }
    return () => {
      for (const m of photoMarkersRef.current) m.remove()
      photoMarkersRef.current = []
    }
  }, [photos, ready])

  // Ortssuche: Treffer anfliegen und mit einem Pin markieren.
  const searchMarkerRef = useRef<Marker | null>(null)
  const handleSearchPick = (r: LocationResult) => {
    const map = mapRef.current
    if (!map) return
    searchMarkerRef.current?.remove()
    const el = document.createElement('div')
    el.textContent = '📍'
    el.style.cssText = 'font-size:26px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))'
    searchMarkerRef.current = new Marker({ element: el, anchor: 'bottom' })
      .setLngLat([r.lon, r.lat])
      .addTo(map)
    map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), r.zoom), duration: 1200 })
  }

  // Fadenkreuz-Cursor im Editor-Modus.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = editor ? 'crosshair' : ''
  }, [editor])

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

  // Import-Vorschau zeichnen und dorthin fliegen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('import-preview') as GeoJSONSource | undefined
    src?.setData(
      preview
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: preview }],
          }
        : EMPTY_FC
    )
    if (preview) {
      const [minLon, minLat, maxLon, maxLat] = lineBbox(preview)
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 48, duration: 600, maxZoom: 15 }
      )
    }
  }, [preview, ready])

  // Tourwechsel → Karte auf die gespeicherte bbox fliegen (PRD F5).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !tour?.bbox) return
    // Während des Editierens ändert sich die bbox durch jedes Auto-Save;
    // die Kamera soll dem Nutzer dann nicht dazwischenfunken.
    if (editorRef.current) return
    const [minLon, minLat, maxLon, maxLat] = tour.bbox
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 48, duration: 600, maxZoom: 15 }
    )
  }, [tour?.id, tour?.bbox, ready])

  // Nach Reiter- oder Vollbild-Wechsel hat sich die Containergrösse geändert.
  useEffect(() => {
    if (visible) mapRef.current?.resize()
  }, [visible, fullscreen])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Ortssuche: mittig auf Desktop, volle Breite auf dem Smartphone. */}
      <div className="absolute left-12 right-24 top-2 z-10 md:left-1/2 md:right-auto md:w-80 md:-translate-x-1/2">
        <MapSearch onPick={handleSearchPick} />
      </div>

      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-2">
        <div className="flex gap-1">
          <button
            className="rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1.5 text-sm shadow-md hover:bg-gray-50"
            title={panelOpen ? 'Kartenoptionen ausblenden' : 'Kartenoptionen einblenden'}
            onClick={() => setPanelOpen((o) => !o)}
          >
            ▤
          </button>
          {onToggleFullscreen && (
            <button
              className="rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1.5 text-sm shadow-md hover:bg-gray-50"
              title={fullscreen ? 'Vollbild verlassen' : 'Karte im Vollbild'}
              onClick={onToggleFullscreen}
            >
              {fullscreen ? '✕' : '⛶'}
            </button>
          )}
        </div>

      {ui && panelOpen && (
        <div className="w-48 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-md">
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
      </div>

      {tour && !tour.geometry && !editor && (
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-md bg-gray-900/80 px-3 py-1.5 text-sm text-white shadow">
          Noch keine Route
        </div>
      )}
    </div>
  )
}
