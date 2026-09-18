import { useEffect, useRef, useState } from 'react'
import type { Tour } from '@tourenbuch/shared'
import { useSharedTours, useTours, useTourMutations } from '../hooks/useTours'
import type { UploadQueueStatus } from '../hooks/useUploadQueue'
import { formatDistance, formatDuration, formatMeters } from '../lib/format'
import { StatusBadge } from './StatusBadge'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** PWA/Mobile: Editier-Controls werden nicht gerendert (PRD F6). */
  readOnly?: boolean
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
        className="absolute -bottom-1 left-0.5 h-2 w-[calc(100%-0.75rem)] text-blue-600"
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
  userEmail,
  onSignOut,
  onOpenSettings,
  uploadStatus,
}: Props) {
  const { data: tours, isLoading, error: loadError } = useTours()
  const { data: sharedTours } = useSharedTours()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Tour | null>(null)
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
          onSelect(tour.id)
          setEditingId(tour.id) // Name direkt inline editierbar (PRD F1)
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
  }

  function handleDelete(tour: Tour) {
    setDeleteCandidate(null)
    if (selectedId === tour.id) onSelect(null)
    deleteTour.mutate({ id: tour.id })
  }

  return (
    <aside className="flex h-full w-full flex-col bg-gray-50 md:overflow-hidden md:rounded-lg md:border md:border-gray-200 md:bg-white/95 md:shadow-xl md:backdrop-blur-md">
      <div className="border-b border-gray-200 px-3 pb-3 pt-3 md:pt-0">
        {/* Desktop: Logo-Abstand 12px oben / 31px unten (Vorgabe). */}
        <div className="mb-3 px-1 md:mb-[31px] md:mt-3">
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              title="Neue Tour anlegen"
              onClick={handleCreate}
            >
              + Neu
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
              onDelete={() => setDeleteCandidate(tour)}
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
                  readOnly
                  selected={tour.id === selectedId}
                  editing={false}
                  onSelect={() => onSelect(tour.id)}
                  onStartEdit={() => {}}
                  onRename={() => {}}
                  onToggleStatus={() => {}}
                  onDelete={() => {}}
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

      {deleteCandidate && (
        <ConfirmDialog
          title="Tour löschen?"
          message={`«${deleteCandidate.name}» wird samt allen Cards und Bildern gelöscht.`}
          onConfirm={() => handleDelete(deleteCandidate)}
          onCancel={() => setDeleteCandidate(null)}
        />
      )}
    </aside>
  )
}

interface ItemProps {
  tour: Tour
  /** Bei geteilten Touren: Anzeigename des Owners. */
  ownerName?: string
  readOnly: boolean
  selected: boolean
  editing: boolean
  onSelect: () => void
  onStartEdit: () => void
  onRename: (name: string) => void
  onToggleStatus: () => void
  onDelete: () => void
}

function TourListItem({
  tour,
  ownerName,
  readOnly,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onRename,
  onToggleStatus,
  onDelete,
}: ItemProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  return (
    <li
      className={`group cursor-pointer border-b border-gray-100 px-3 py-2 ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-100'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        {editing && !readOnly ? (
          <input
            ref={inputRef}
            defaultValue={tour.name}
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
        {!readOnly && (
          <button
            className="hidden shrink-0 rounded px-1 text-gray-400 hover:bg-red-100 hover:text-red-600 group-hover:block"
            title="Tour löschen"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            🗑
          </button>
        )}
      </div>
      {ownerName && <div className="mt-0.5 text-xs text-gray-400">von {ownerName}</div>}
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span>{formatDistance(tour.distance_m)}</span>
        <span>↑ {formatMeters(tour.ascent_m)}</span>
        <span>🕓 {formatDuration(tour.duration_min)}</span>
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
    </li>
  )
}
