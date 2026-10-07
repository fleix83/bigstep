import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Tour } from '@tourenbuch/shared'
import { useSharedTours, useTours, useTourMutations } from '../hooks/useTours'
import type { UploadQueueStatus } from '../hooks/useUploadQueue'
import { formatDistance, formatDuration, formatMeters } from '../lib/format'
import { StatusBadge } from './StatusBadge'

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** PWA/Mobile: Editier-Controls werden nicht gerendert (PRD F6). */
  readOnly?: boolean
  /** Neue Touren anlegen und eigene löschen (auch mobil erlaubt, wenn sonst read-only). */
  canCreate?: boolean
  /** Öffnet den GPX-Import; der Button erscheint nur mobil (Desktop: Reiter-Pille). */
  onImportGpx?: () => void
  /** Fusszeile: eingeloggter User, Einstellungen, Abmelden, Upload-Status. */
  userEmail: string
  onSignOut: () => void
  onOpenSettings: () => void
  uploadStatus: UploadQueueStatus
}

/** Wortmarke «Tourenbuch» in Handschrift mit handgezogener Unterstreichung. */
function Logo() {
  return (
    <div className="relative inline-block select-none pr-2" aria-label="Tourenbuch">
      <span className="font-logo text-[2.125rem] leading-none tracking-wide text-gray-900">
        Tourenbuch
      </span>
      <svg
        className="absolute -bottom-1 left-0.5 h-2 w-[calc(100%-0.75rem)] text-black"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M1.5 5.5 C 18 2.5, 38 7, 58 4 S 88 2, 98.5 4.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

export function TourList({
  selectedId,
  onSelect,
  readOnly = false,
  canCreate = !readOnly,
  onImportGpx,
  userEmail,
  onSignOut,
  onOpenSettings,
  uploadStatus,
}: Props) {
  const { data: tours, isLoading, error: loadError } = useTours()
  const { data: sharedTours } = useSharedTours()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [openAfterRenameId, setOpenAfterRenameId] = useState<string | null>(null)
  // Höchstens eine Zeile ist nach links gewischt; Tippen ausserhalb schliesst sie.
  const [swipedId, setSwipedId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { createTour, updateTour, deleteTour } = useTourMutations(setErrorMessage)

  // Server liefert bereits updated_at desc; Suche filtert nach Name (und Owner bei geteilten).
  const q = query.trim().toLocaleLowerCase('de')
  const matches = (t: Tour & { owner_name?: string | null }) =>
    !q ||
    t.name.toLocaleLowerCase('de').includes(q) ||
    (t.owner_name ?? '').toLocaleLowerCase('de').includes(q)
  const sorted = (tours ?? []).filter(matches)
  const sharedFiltered = (sharedTours ?? []).filter(matches)

  function handleCreate() {
    createTour.mutate(
      { name: 'Neue Tour' },
      {
        onSuccess: (tour) => {
          setEditingId(tour.id) // Name direkt inline editierbar (PRD F1)
          // Mobil verdeckt die Detailansicht die Liste: erst benennen, dann öffnen.
          if (readOnly) setOpenAfterRenameId(tour.id)
          else onSelect(tour.id)
        },
      }
    )
  }

  function handleRename(tour: Tour, name: string) {
    setEditingId(null)
    const trimmed = name.trim()
    if (trimmed && trimmed !== tour.name) {
      updateTour.mutate({ id: tour.id, data: { name: trimmed } })
    }
    if (openAfterRenameId === tour.id) {
      setOpenAfterRenameId(null)
      onSelect(tour.id)
    }
  }

  useEffect(() => {
    if (!swipedId) return
    const onDown = (e: PointerEvent) => {
      const row = (e.target as Element | null)?.closest?.('[data-swipe-id]')
      if (row?.getAttribute('data-swipe-id') !== swipedId) setSwipedId(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [swipedId])

  function handleDelete(tour: Tour) {
    setSwipedId(null)
    if (selectedId === tour.id) onSelect(null)
    deleteTour.mutate({ id: tour.id })
  }

  return (
    <aside className="flex h-full w-full flex-col bg-gray-50 md:overflow-hidden md:rounded-lg md:border md:border-gray-200 md:bg-white/95 md:shadow-xl md:backdrop-blur-md">
      <div className="border-b border-gray-200 px-3 pb-3 pt-3 md:pt-0">
        {/* Logo-Abstand unten: mobil 28px, Desktop 12px oben / 31px unten (Vorgaben). */}
        <div className="mb-7 px-1 md:mb-[31px] md:mt-3">
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <button
              className="shrink-0 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
              title="Neue Tour anlegen"
              onClick={handleCreate}
            >
              + Neu
            </button>
          )}
          {canCreate && onImportGpx && (
            <button
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 md:hidden"
              title="GPX-Datei als neue Tour importieren"
              onClick={onImportGpx}
            >
              ⤒ GPX
            </button>
          )}
          <label className="relative min-w-0 flex-1">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Touren suchen …"
              aria-label="Touren suchen"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-400"
            />
          </label>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-start justify-between gap-2 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{errorMessage}</span>
          <button className="font-bold" onClick={() => setErrorMessage(null)}>
            ×
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="p-4 text-sm text-gray-500">Lade Touren…</p>}
        {loadError && (
          <p className="p-4 text-sm text-red-600">
            Touren konnten nicht geladen werden: {loadError.message}
          </p>
        )}
        {sorted.length === 0 && !isLoading && !loadError && (
          <p className="p-4 text-sm text-gray-500">
            {q ? 'Keine Tour passt zur Suche.' : 'Noch keine Touren.'}
          </p>
        )}
        <ul>
          {sorted.map((tour) => (
            <TourListItem
              key={tour.id}
              tour={tour}
              readOnly={readOnly}
              // Frisch angelegte Tour: Name inline setzen, auch wenn sonst read-only (mobil).
              renamable={!readOnly || canCreate}
              deletable={!readOnly || canCreate}
              selected={tour.id === selectedId}
              editing={tour.id === editingId}
              onSelect={() => onSelect(tour.id)}
              onStartEdit={() => setEditingId(tour.id)}
              onRename={(name) => handleRename(tour, name)}
              onToggleStatus={() =>
                updateTour.mutate({
                  id: tour.id,
                  data: { status: tour.status === 'geplant' ? 'gemacht' : 'geplant' },
                })
              }
              swipeOpen={swipedId === tour.id}
              onSwipeOpenChange={(open) => setSwipedId(open ? tour.id : null)}
              onSwipeDelete={() => handleDelete(tour)}
            />
          ))}
        </ul>

        {sharedFiltered.length > 0 && (
          <>
            <div className="border-b border-t border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Von anderen geteilt
            </div>
            <ul>
              {sharedFiltered.map((tour) => (
                <TourListItem
                  key={tour.id}
                  tour={tour}
                  ownerName={tour.owner_name ?? undefined}
                  canWrite={tour.can_write}
                  readOnly
                  selected={tour.id === selectedId}
                  editing={false}
                  onSelect={() => onSelect(tour.id)}
                  onStartEdit={() => {}}
                  onRename={() => {}}
                  onToggleStatus={() => {}}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Fusszeile: User, Einstellungen, Abmelden (ersetzt die frühere Topbar). */}
      <div className="border-t border-gray-200 px-3 py-2">
        {uploadStatus.pending > 0 && (
          <div
            className="mb-2 inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700"
            title="Bilder werden nach R2 hochgeladen"
          >
            ☁︎ {uploadStatus.uploading ? 'lädt hoch …' : 'ausstehend:'} {uploadStatus.pending}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold uppercase text-blue-700"
            aria-hidden="true"
          >
            {userEmail.charAt(0) || '?'}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs text-gray-500" title={userEmail}>
            {userEmail}
          </span>
          <button
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            title="Einstellungen"
            aria-label="Einstellungen"
            onClick={onOpenSettings}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
          <button
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            title="Abmelden"
            aria-label="Abmelden"
            onClick={onSignOut}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}

interface ItemProps {
  tour: Tour
  /** Bei geteilten Touren: Anzeigename des Owners. */
  ownerName?: string
  /** Bei geteilten Touren: darf ich Book/Route bearbeiten? */
  canWrite?: boolean
  readOnly: boolean
  /** Inline-Umbenennen zulassen, wenn editing gesetzt ist (Default: !readOnly). */
  renamable?: boolean
  /** Löschen per Wischen nach links zulassen (Default: !readOnly). */
  deletable?: boolean
  selected: boolean
  editing: boolean
  onSelect: () => void
  onStartEdit: () => void
  onRename: (name: string) => void
  onToggleStatus: () => void
  /** Zeile ist nach links gewischt (rote Löschzone sichtbar). */
  swipeOpen?: boolean
  /** Ohne Handler kein Wischen (z. B. geteilte Touren). */
  onSwipeOpenChange?: (open: boolean) => void
  /** Tippen auf die rote Löschzone: sofort löschen. */
  onSwipeDelete?: () => void
}

/** Breite der roten Löschzone hinter einer nach links gewischten Zeile. */
const SWIPE_W = 80

function TrashIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </svg>
  )
}

function TourListItem({
  tour,
  ownerName,
  canWrite,
  readOnly,
  renamable = !readOnly,
  deletable = !readOnly,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onRename,
  onToggleStatus,
  swipeOpen = false,
  onSwipeOpenChange,
  onSwipeDelete,
}: ItemProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Wischen nach links legt die rote Löschzone frei (nur eigene Touren, nicht beim Umbenennen).
  const swipeable = deletable && !editing && onSwipeOpenChange !== undefined
  const [dragX, setDragX] = useState<number | null>(null)
  const dragXRef = useRef<number | null>(null)
  const gesture = useRef<{
    id: number
    x: number
    y: number
    base: number
    axis: 'x' | 'y' | null
  } | null>(null)
  // Nach einem Wisch feuert der Browser noch einen Klick – der soll die Tour nicht öffnen.
  const suppressClick = useRef(false)
  const offset = dragX ?? (swipeOpen ? -SWIPE_W : 0)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const setDrag = (x: number | null) => {
    dragXRef.current = x
    setDragX(x)
  }

  const endGesture = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    if (g.axis !== 'x') return
    suppressClick.current = true
    const x = dragXRef.current ?? g.base
    setDrag(null)
    onSwipeOpenChange?.(x < -SWIPE_W / 2)
  }

  return (
    <li data-swipe-id={tour.id} className="relative overflow-hidden border-b border-gray-100">
      {swipeable && (
        <button
          className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-600 text-white active:bg-red-700"
          // Wächst beim Überziehen mit, damit keine Lücke entsteht.
          style={{
            width: Math.max(SWIPE_W, -offset),
            visibility: offset < 0 ? 'visible' : 'hidden',
          }}
          title="Tour löschen"
          aria-label={`Tour «${tour.name}» löschen`}
          tabIndex={swipeOpen ? 0 : -1}
          onClick={onSwipeDelete}
        >
          <TrashIcon />
        </button>
      )}
      <div
        className={`group relative cursor-pointer px-3 py-2 touch-pan-y ${
          selected ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100 md:bg-white md:hover:bg-gray-100'
        } ${dragX === null ? 'transition-transform duration-200 ease-out' : 'select-none'}`}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        onPointerDown={(e) => {
          suppressClick.current = false
          if (!swipeable || e.button !== 0) return
          gesture.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            base: swipeOpen ? -SWIPE_W : 0,
            axis: null,
          }
        }}
        onPointerMove={(e) => {
          const g = gesture.current
          if (!g || g.id !== e.pointerId) return
          const dx = e.clientX - g.x
          const dy = e.clientY - g.y
          if (!g.axis) {
            // Richtung erst nach ein paar Pixeln festlegen; vertikal = Liste scrollen.
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
            g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
            if (g.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId)
          }
          if (g.axis !== 'x') return
          let x = g.base + dx
          // Gummiband: nach rechts kaum, über die Löschzone hinaus gedämpft.
          if (x > 0) x /= 4
          else if (x < -SWIPE_W) x = -SWIPE_W + (x + SWIPE_W) / 3
          setDrag(x)
        }}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          if (swipeOpen) onSwipeOpenChange?.(false)
          else onSelect()
        }}
      >
        <div className="flex items-center justify-between gap-2">
          {editing && renamable ? (
            <input
              ref={inputRef}
              defaultValue={tour.name}
              enterKeyHint="done"
              className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRename(e.currentTarget.value)
                if (e.key === 'Escape') onRename(tour.name)
              }}
            />
          ) : (
            <span
              className="truncate text-sm font-medium text-gray-900"
              title={readOnly ? undefined : 'Doppelklick zum Umbenennen'}
              onDoubleClick={
                readOnly
                  ? undefined
                  : (e) => {
                      e.stopPropagation()
                      onStartEdit()
                    }
              }
            >
              {tour.name}
            </span>
          )}
        </div>
        {ownerName && (
          <div className="mt-0.5 text-xs text-gray-400">
            von {ownerName}
            {canWrite && <span title="Du darfst diese Tour bearbeiten"> · ✎ bearbeitbar</span>}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          <span className="whitespace-nowrap">{formatDistance(tour.distance_m)}</span>
          <span className="whitespace-nowrap">↑ {formatMeters(tour.ascent_m)}</span>
          <span className="whitespace-nowrap">🕓 {formatDuration(tour.duration_min)}</span>
          {readOnly ? (
            <span className="ml-auto">
              <StatusBadge status={tour.status} />
            </span>
          ) : (
            <button
              className="ml-auto"
              title="Status umschalten"
              onClick={(e) => {
                e.stopPropagation()
                onToggleStatus()
              }}
            >
              <StatusBadge status={tour.status} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
