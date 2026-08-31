import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BRouterProvider,
  StraightLineProvider,
  concatSegments,
  hikingTimeMin,
  lineBbox,
  lineDistanceM,
  type LineString,
  type LonLat,
  type RouteResult,
  type Tour,
} from '@tourenbuch/shared'
import type { FeatureCollection } from 'geojson'
import { useApi } from '../lib/api'
import { fetchElevationStats, type ElevationStats } from '../lib/elevation'

export interface EditorSegment {
  line: LonLat[]
  /** false ⇒ Routing fehlgeschlagen (Luftlinie wider Willen). */
  ok: boolean
  /** true ⇒ bewusst als Luftlinie erzeugt (Snapping war aus). */
  straight: boolean
}

interface Present {
  waypoints: LonLat[]
  segments: EditorSegment[]
}

interface History {
  past: Present[]
  present: Present
  future: Present[]
}

export interface EditorStats {
  distance_m: number
  ascent_m: number | null
  descent_m: number | null
  duration_min: number | null
}

export interface RouteEditor {
  tourId: string
  waypoints: LonLat[]
  segmentsFC: FeatureCollection
  geometry: LineString | null
  snapping: boolean
  routingBusy: boolean
  canUndo: boolean
  canRedo: boolean
  stats: EditorStats
  addWaypoint(p: LonLat): void
  moveWaypoint(index: number, p: LonLat): void
  insertOnSegment(segIdx: number, p: LonLat): void
  deleteWaypoint(index: number): void
  undo(): void
  redo(): void
  setSnapping(v: boolean): void
}

const MAX_UNDO = 30
const round5 = (n: number) => Math.round(n * 1e5) / 1e5

/** Segmente aus gespeicherter Tour rekonstruieren (keine Routing-Requests). */
function buildInitial(tour: Tour): Present {
  const geom = tour.geometry
  const wps = tour.waypoints ?? null
  if (!geom || geom.coordinates.length < 2) {
    return { waypoints: wps ?? [], segments: [] }
  }
  const coords = geom.coordinates.map((c): LonLat => [c[0]!, c[1]!])
  if (!wps || wps.length < 2) {
    // Importierte Tour ohne Wegpunkte: Anfang/Ende als Wegpunkte, eine Linie.
    return {
      waypoints: [coords[0]!, coords[coords.length - 1]!],
      segments: [{ line: coords, ok: true, straight: false }],
    }
  }
  // Geometrie an den Wegpunkten splitten: je Wegpunkt den nächstgelegenen
  // Geometrie-Index (monoton aufsteigend) suchen.
  const idx: number[] = []
  let from = 0
  for (const wp of wps) {
    let best = from
    let bestD = Infinity
    for (let i = from; i < coords.length; i++) {
      const dx = coords[i]![0] - wp[0]
      const dy = coords[i]![1] - wp[1]
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    idx.push(best)
    from = best
  }
  const segments: EditorSegment[] = []
  for (let i = 0; i < wps.length - 1; i++) {
    const slice = coords.slice(idx[i]!, idx[i + 1]! + 1)
    segments.push({
      line: slice.length >= 2 ? slice : [wps[i]!, wps[i + 1]!],
      ok: true,
      straight: false,
    })
  }
  return { waypoints: [...wps], segments }
}

export function useRouteEditor(tour: Tour | null, enabled: boolean): RouteEditor | null {
  const api = useApi()
  const queryClient = useQueryClient()

  const [history, setHistory] = useState<History | null>(null)
  const historyRef = useRef(history)
  historyRef.current = history
  const initializedFor = useRef<string | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const [snapping, setSnappingState] = useState(true)
  const snappingRef = useRef(snapping)
  snappingRef.current = snapping
  const [busyCount, setBusyCount] = useState(0)

  const [elevation, setElevation] = useState<ElevationStats | null>(null)
  const elevationForRef = useRef<string | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: Infinity,
    retry: 1,
  })

  // Snapping-Voreinstellung aus den Settings (einmal pro Mount).
  const snappingInitDone = useRef(false)
  useEffect(() => {
    if (snappingInitDone.current || !settingsQuery.isSuccess) return
    snappingInitDone.current = true
    const routing = settingsQuery.data?.routing as { snapping?: boolean } | undefined
    if (typeof routing?.snapping === 'boolean') setSnappingState(routing.snapping)
  }, [settingsQuery.isSuccess, settingsQuery.data])

  // Editor-Lebenszyklus: initialisieren beim Aktivieren bzw. Tourwechsel.
  useEffect(() => {
    if (!enabled || !tour) {
      setHistory(null)
      initializedFor.current = null
      return
    }
    if (initializedFor.current === tour.id) return
    initializedFor.current = tour.id
    const present = buildInitial(tour)
    setHistory({ past: [], present, future: [] })
    setElevation(
      tour.ascent_m !== null && tour.descent_m !== null
        ? { ascent_m: tour.ascent_m, descent_m: tour.descent_m }
        : null
    )
    // Für die gespeicherte Geometrie keinen profile.json-Aufruf auslösen.
    elevationForRef.current = JSON.stringify(
      concatSegments(present.segments).map((p) => [p[0], p[1]])
    )
    // Kein PATCH beim Editor-Start, solange nichts geändert wurde.
    lastSavedRef.current = JSON.stringify({
      waypoints: tour.waypoints,
      geometry: tour.geometry,
      bbox: tour.bbox,
      distance_m: tour.distance_m,
      ascent_m: tour.ascent_m,
      descent_m: tour.descent_m,
      duration_min: tour.duration_min,
    })
  }, [enabled, tour])

  const providerRef = useRef(new BRouterProvider())
  const straightRef = useRef(new StraightLineProvider())
  const cacheRef = useRef(new Map<string, RouteResult>())

  const routeSegment = useCallback(async (a: LonLat, b: LonLat): Promise<EditorSegment> => {
    if (!snappingRef.current) {
      const r = await straightRef.current.route(a, b)
      return { line: r.line, ok: true, straight: true }
    }
    const key = `${round5(a[0])},${round5(a[1])}|${round5(b[0])},${round5(b[1])}`
    const cached = cacheRef.current.get(key)
    if (cached) return { line: cached.line, ok: cached.ok, straight: false }
    const r = await providerRef.current.route(a, b)
    // Fehlversuche nicht cachen, damit ein späterer Versuch neu routet.
    if (r.ok) cacheRef.current.set(key, r)
    return { line: r.line, ok: r.ok, straight: false }
  }, [])

  // Mutationen serialisieren: schnelle Klicks dürfen sich nicht überholen.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const enqueue = useCallback(
    (fn: (present: Present) => Promise<Present | null>) => {
      queueRef.current = queueRef.current
        .then(async () => {
          const h = historyRef.current
          if (!h) return
          setBusyCount((c) => c + 1)
          try {
            const next = await fn(h.present)
            if (next) {
              setHistory((cur) => {
                if (!cur) return cur
                return {
                  past: [...cur.past.slice(-(MAX_UNDO - 1)), cur.present],
                  present: next,
                  future: [],
                }
              })
            }
          } finally {
            setBusyCount((c) => c - 1)
          }
        })
        .catch(() => {})
    },
    []
  )

  const addWaypoint = useCallback(
    (p: LonLat) => {
      enqueue(async (cur) => {
        const waypoints = [...cur.waypoints, p]
        const segments = [...cur.segments]
        const prev = cur.waypoints[cur.waypoints.length - 1]
        if (prev) segments.push(await routeSegment(prev, p))
        return { waypoints, segments }
      })
    },
    [enqueue, routeSegment]
  )

  const moveWaypoint = useCallback(
    (index: number, p: LonLat) => {
      enqueue(async (cur) => {
        if (index < 0 || index >= cur.waypoints.length) return null
        const waypoints = [...cur.waypoints]
        waypoints[index] = p
        const segments = [...cur.segments]
        if (index > 0) segments[index - 1] = await routeSegment(waypoints[index - 1]!, p)
        if (index < waypoints.length - 1)
          segments[index] = await routeSegment(p, waypoints[index + 1]!)
        return { waypoints, segments }
      })
    },
    [enqueue, routeSegment]
  )

  const insertOnSegment = useCallback(
    (segIdx: number, p: LonLat) => {
      enqueue(async (cur) => {
        if (segIdx < 0 || segIdx >= cur.segments.length) return null
        const waypoints = [...cur.waypoints]
        waypoints.splice(segIdx + 1, 0, p)
        const segments = [...cur.segments]
        segments.splice(
          segIdx,
          1,
          await routeSegment(waypoints[segIdx]!, p),
          await routeSegment(p, waypoints[segIdx + 2]!)
        )
        return { waypoints, segments }
      })
    },
    [enqueue, routeSegment]
  )

  const deleteWaypoint = useCallback(
    (index: number) => {
      enqueue(async (cur) => {
        const n = cur.waypoints.length
        if (index < 0 || index >= n) return null
        const waypoints = cur.waypoints.filter((_, i) => i !== index)
        let segments = [...cur.segments]
        if (n <= 1) {
          segments = []
        } else if (index === 0) {
          segments = segments.slice(1)
        } else if (index === n - 1) {
          segments = segments.slice(0, -1)
        } else {
          const joined = await routeSegment(cur.waypoints[index - 1]!, cur.waypoints[index + 1]!)
          segments.splice(index - 1, 2, joined)
        }
        return { waypoints, segments }
      })
    },
    [enqueue, routeSegment]
  )

  const undo = useCallback(() => {
    queueRef.current = queueRef.current.then(() => {
      setHistory((cur) => {
        if (!cur || cur.past.length === 0) return cur
        return {
          past: cur.past.slice(0, -1),
          present: cur.past[cur.past.length - 1]!,
          future: [cur.present, ...cur.future],
        }
      })
    })
  }, [])

  const redo = useCallback(() => {
    queueRef.current = queueRef.current.then(() => {
      setHistory((cur) => {
        if (!cur || cur.future.length === 0) return cur
        return {
          past: [...cur.past, cur.present],
          present: cur.future[0]!,
          future: cur.future.slice(1),
        }
      })
    })
  }, [])

  const setSnapping = useCallback(
    (v: boolean) => {
      setSnappingState(v)
      api.putSetting('routing', { snapping: v }).catch(() => {})
    },
    [api]
  )

  const present = history?.present ?? null

  const geometry = useMemo((): LineString | null => {
    if (!present || present.segments.length === 0) return null
    const merged = concatSegments(present.segments)
    if (merged.length < 2) return null
    return { type: 'LineString', coordinates: merged.map((p) => [p[0], p[1]]) }
  }, [present])

  // Höhenmeter: 500 ms nach der letzten Geometrie-Änderung (PRD §7.1).
  useEffect(() => {
    if (!enabledRef.current || !present || !geometry) return
    const key = JSON.stringify(geometry.coordinates)
    if (elevationForRef.current === key) return
    const timer = window.setTimeout(async () => {
      const stats = await fetchElevationStats(geometry)
      if (stats) {
        elevationForRef.current = key
        setElevation(stats)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [present, geometry])

  const stats = useMemo((): EditorStats => {
    const distance = geometry ? lineDistanceM(geometry) : 0
    const duration =
      distance > 0
        ? hikingTimeMin(distance, elevation?.ascent_m ?? 0, elevation?.descent_m ?? 0)
        : null
    return {
      distance_m: distance,
      ascent_m: elevation?.ascent_m ?? null,
      descent_m: elevation?.descent_m ?? null,
      duration_min: duration,
    }
  }, [geometry, elevation])

  // Debounced speichern; feuert auch, wenn Höhen nachträglich eintreffen.
  const tourIdRef = useRef(tour?.id)
  tourIdRef.current = tour?.id
  const lastSavedRef = useRef('')
  useEffect(() => {
    if (!enabledRef.current || !present || !tourIdRef.current) return
    const id = tourIdRef.current
    const payload = {
      waypoints: present.waypoints.length > 0 ? present.waypoints : null,
      geometry,
      bbox: geometry ? lineBbox(geometry) : null,
      distance_m: geometry ? stats.distance_m : null,
      ascent_m: stats.ascent_m,
      descent_m: stats.descent_m,
      duration_min: stats.duration_min,
    }
    const json = JSON.stringify(payload)
    if (json === lastSavedRef.current) return
    const timer = window.setTimeout(() => {
      void api
        .updateTour(id, payload)
        .then((updated) => {
          lastSavedRef.current = json
          queryClient.setQueryData<Tour[]>(['tours'], (old) =>
            old?.map((t) => (t.id === updated.id ? updated : t))
          )
        })
        .catch(() => {
          // Nächste Änderung versucht es erneut; der Editor-State bleibt führend.
        })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [present, geometry, stats, api, queryClient])

  const segmentsFC = useMemo((): FeatureCollection => {
    if (!present) return { type: 'FeatureCollection', features: [] }
    return {
      type: 'FeatureCollection',
      features: present.segments.map((seg, i) => ({
        type: 'Feature',
        properties: { segIdx: i, dashed: seg.straight || !seg.ok },
        geometry: { type: 'LineString', coordinates: seg.line.map((p) => [p[0], p[1]]) },
      })),
    }
  }, [present])

  if (!enabled || !tour || !history) return null

  return {
    tourId: tour.id,
    waypoints: history.present.waypoints,
    segmentsFC,
    geometry,
    snapping,
    routingBusy: busyCount > 0,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    stats,
    addWaypoint,
    moveWaypoint,
    insertOnSegment,
    deleteWaypoint,
    undo,
    redo,
    setSnapping,
  }
}
