import { useEffect, useRef, useState } from 'react'
import type { Tour } from '@tourenbuch/shared'
import { useSharedTours, useTours, useTourMutations } from '../hooks/useTours'
import { formatDistance, formatDuration, formatMeters } from '../lib/format'
import { StatusBadge } from './StatusBadge'
import { ConfirmDialog } from './ConfirmDialog'

type SortMode = 'updated' | 'name'

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** PWA/Mobile: Editier-Controls werden nicht gerendert (PRD F6). */
  readOnly?: boolean
}

export function TourList({ selectedId, onSelect, readOnly = false }: Props) {
  const { data: tours, isLoading, error: loadError } = useTours()
  const { data: sharedTours } = useSharedTours()
  const [sortMode, setSortMode] = useState<SortMode>('updated')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Tour | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { createTour, updateTour, deleteTour } = useTourMutations(setErrorMessage)

  const sorted =
    sortMode === 'name'
      ? [...(tours ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'))
      : (tours ?? []) // Server liefert bereits updated_at desc

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
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-gray-200 bg-gray-50 md:w-72">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 p-3">
        {readOnly ? (
          <span className="flex-1 px-1 text-sm font-semibold text-gray-700">Touren</span>
        ) : (
          <button
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleCreate}
          >
            + Neue Tour
          </button>
        )}
        <button
          className="rounded border border-gray-300 px-2 py-2 text-xs text-gray-600 hover:bg-gray-100"
          title={sortMode === 'updated' ? 'Alphabetisch sortieren' : 'Nach Änderung sortieren'}
          onClick={() => setSortMode(sortMode === 'updated' ? 'name' : 'updated')}
        >
          {sortMode === 'updated' ? 'A–Z' : '🕓'}
        </button>
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
          <p className="p-4 text-sm text-gray-500">Noch keine Touren.</p>
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

        {sharedTours && sharedTours.length > 0 && (
          <>
            <div className="border-b border-t border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Von anderen geteilt
            </div>
            <ul>
              {sharedTours.map((tour) => (
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
