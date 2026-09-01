import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  elevationGainLoss,
  lineBbox,
  lineDistanceM,
  serializeGpx,
} from '@tourenbuch/shared'
import { ApiProvider, useApi, useApiConfig, useAuthInfo } from './lib/api'
import { saveTextFile } from './lib/save-file'
import { TourList } from './components/TourList'
import { SettingsDialog } from './components/SettingsDialog'
import { MapView } from './components/MapView'
import { ImportDialog, type ImportCandidate } from './components/ImportDialog'
import { BookView } from './components/BookView'
import { useSharedTours, useTours } from './hooks/useTours'
import { useReadOnly } from './lib/use-read-only'
import { useRouteEditor } from './hooks/useRouteEditor'
import { useTourImages } from './hooks/useCards'
import { useUploadQueue } from './hooks/useUploadQueue'
import { resolveImageUrls } from './lib/image-store'
import type { PhotoPin } from './components/MapView'

type Tab = 'karte' | 'book'

function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`
}

export default function App() {
  return (
    <ApiProvider>
      <Shell />
    </ApiProvider>
  )
}

function Shell() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('karte')
  const [showSettings, setShowSettings] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [preview, setPreview] = useState<ImportCandidate | null>(null)
  const { config, updateConfig } = useApiConfig()
  const { user, signOut } = useAuthInfo()
  const api = useApi()
  const queryClient = useQueryClient()
  const { data: tours } = useTours()
  const { data: sharedTours } = useSharedTours()
  const selectedTour =
    tours?.find((t) => t.id === selectedId) ??
    sharedTours?.find((t) => t.id === selectedId) ??
    null
  // Fremde (geteilte) Touren sind strikt read-only, eigene editierbar.
  const isOwner = selectedTour === null || selectedTour.user_id === user.id
  const readOnly = useReadOnly()
  // Auch die mobile PWA editiert jetzt das Book — die Upload-Queue muss dort
  // ebenfalls laufen, damit frisch importierte Bilder nach R2 kommen.
  const uploadStatus = useUploadQueue(config !== null)
  const [fullscreen, setFullscreen] = useState(false)
  const [editing, setEditing] = useState(false)
  const editor = useRouteEditor(selectedTour, editing && !readOnly && isOwner && tab === 'karte')
  const [highlightCardId, setHighlightCardId] = useState<string | null>(null)

  // Foto-Pins: Bilder mit GPS der aktiven Tour, Thumb-URLs lokal auflösen.
  const { data: tourImages } = useTourImages(selectedId)
  const [photoPins, setPhotoPins] = useState<PhotoPin[]>([])
  useEffect(() => {
    let alive = true
    const withGps = (tourImages ?? []).filter(
      (i) => i.lat !== null && i.lon !== null
    )
    void Promise.all(
      withGps.map(async (i) => ({
        imageId: i.id,
        cardId: i.card_id,
        lon: i.lon!,
        lat: i.lat!,
        thumbUrl: (await resolveImageUrls(i, api))?.thumb ?? null,
      }))
    ).then((pins) => {
      if (alive) setPhotoPins(pins)
    })
    return () => {
      alive = false
    }
  }, [tourImages, api])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const selectTour = (id: string | null) => {
    setEditing(false)
    setSelectedId(id)
  }

  // Kennzahlen: im Editor live, sonst die gespeicherten Werte der Tour.
  const statsSource = editor
    ? editor.stats
    : selectedTour
      ? {
          distance_m: selectedTour.distance_m ?? 0,
          ascent_m: selectedTour.ascent_m,
          descent_m: selectedTour.descent_m,
          duration_min: selectedTour.duration_min,
        }
      : null

  const closeImport = () => {
    setShowImport(false)
    setPreview(null)
  }

  const handleImportConfirm = async (candidate: ImportCandidate, name: string) => {
    const created = await api.createTour({ name })
    const gainLoss = elevationGainLoss(candidate.line)
    await api.updateTour(created.id, {
      geometry: candidate.line,
      bbox: lineBbox(candidate.line),
      distance_m: lineDistanceM(candidate.line),
      ascent_m: gainLoss?.ascent_m ?? null,
      descent_m: gainLoss?.descent_m ?? null,
    })
    await queryClient.invalidateQueries({ queryKey: ['tours'] })
    setSelectedId(created.id)
    closeImport()
  }

  const handleExport = async () => {
    if (!selectedTour?.geometry) return
    const gpx = serializeGpx(selectedTour.name, selectedTour.geometry)
    const filename = `${selectedTour.name.replace(/[/\\:*?"<>|]/g, '_')}.gpx`
    await saveTextFile(filename, gpx)
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className={`${fullscreen ? 'hidden' : 'flex'} items-center justify-between border-b border-gray-200 bg-white px-4 py-2`}
      >
        <h1 className="text-base font-semibold text-gray-900">Tourenbuch</h1>
        {uploadStatus.pending > 0 && (
          <span
            className="ml-3 mr-auto rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700"
            title="Bilder werden nach R2 hochgeladen"
          >
            ☁︎ {uploadStatus.uploading ? 'lädt hoch …' : 'ausstehend:'} {uploadStatus.pending}
          </span>
        )}
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-gray-400 sm:inline">{user.email}</span>
          <button
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            title="Abmelden"
            onClick={() => void signOut()}
          >
            Abmelden
          </button>
          <button
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            title="Einstellungen"
            onClick={() => setShowSettings(true)}
          >
            ⚙︎
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Mobil: Liste als Startscreen, Detail erst nach Tour-Wahl (PRD F6). */}
        <div
          className={`${fullscreen ? 'hidden' : selectedId ? 'hidden md:flex' : 'flex'} min-h-0 w-full md:w-auto`}
        >
          <TourList selectedId={selectedId} onSelect={selectTour} readOnly={readOnly} />
        </div>

        <main
          className={`${fullscreen || selectedId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}
        >
          <nav
            className={`${fullscreen ? 'hidden' : 'flex'} items-center border-b border-gray-200 bg-white`}
          >
            {selectedId && (
              <button
                className="px-3 py-2 text-sm text-blue-700 md:hidden"
                onClick={() => selectTour(null)}
              >
                ‹ Touren
              </button>
            )}
            {(['karte', 'book'] as const).map((t) => (
              <button
                key={t}
                className={`px-4 py-2 text-sm font-medium ${
                  tab === t
                    ? 'border-b-2 border-blue-600 text-blue-700'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
                onClick={() => setTab(t)}
              >
                {t === 'karte' ? 'Karte' : 'Book'}
              </button>
            ))}

            {!readOnly && (
            <div className="ml-4 flex items-center gap-1 border-l border-gray-200 pl-4">
              <button
                className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                title="GPX-Datei als neue Tour importieren"
                onClick={() => setShowImport(true)}
              >
                ⤒ GPX-Import
              </button>
              <button
                className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                title={
                  selectedTour?.geometry
                    ? 'Aktive Tour als GPX exportieren'
                    : 'Erst eine Tour mit Route wählen'
                }
                disabled={!selectedTour?.geometry}
                onClick={() => void handleExport()}
              >
                ⤓ GPX-Export
              </button>
            </div>
            )}

            {selectedTour && (
              <span className="ml-auto flex min-w-0 items-center gap-2 self-center px-4">
                {isOwner && !readOnly ? (
                  <button
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                      selectedTour.visibility === 'public'
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-500 hover:bg-gray-100'
                    }`}
                    title={
                      selectedTour.visibility === 'public'
                        ? 'Für alle User sichtbar – klicken, um wieder privat zu machen'
                        : 'Tour (inkl. Book) für alle User der App sichtbar machen'
                    }
                    onClick={() => {
                      void api
                        .updateTour(selectedTour.id, {
                          visibility:
                            selectedTour.visibility === 'public' ? 'private' : 'public',
                        })
                        .then(() =>
                          queryClient.invalidateQueries({ queryKey: ['tours'] })
                        )
                    }}
                  >
                    {selectedTour.visibility === 'public' ? '🌍 Geteilt' : 'Teilen'}
                  </button>
                ) : !isOwner ? (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">
                    🌍 geteilt
                  </span>
                ) : null}
                <span className="truncate text-sm text-gray-400">{selectedTour.name}</span>
              </span>
            )}
          </nav>

          <div className="relative min-h-0 flex-1">
            {/* Karte bleibt beim Reiterwechsel gemountet, damit Position und Layer erhalten bleiben. */}
            <MapView
              tour={selectedTour}
              tours={tours}
              visible={tab === 'karte'}
              preview={preview?.line ?? null}
              editor={editor}
              photos={photoPins}
              onPhotoClick={(cardId) => {
                setFullscreen(false)
                setTab('book')
                setHighlightCardId(cardId)
              }}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((f) => !f)}
            />

            {/* Editor-Toolbar */}
            {!readOnly && isOwner && tab === 'karte' && selectedTour && (
              <div className="absolute left-14 top-2 z-10 flex items-center gap-1 rounded-lg border border-gray-200 bg-white/95 px-2 py-1.5 shadow-md">
                {!editing ? (
                  <button
                    className="rounded px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    onClick={() => setEditing(true)}
                  >
                    ✎ Route bearbeiten
                  </button>
                ) : (
                  <>
                    <button
                      className="rounded bg-blue-600 px-2 py-1 text-sm font-medium text-white hover:bg-blue-700"
                      onClick={() => setEditing(false)}
                    >
                      ✓ Fertig
                    </button>
                    <button
                      className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                      title="Rückgängig"
                      disabled={!editor?.canUndo}
                      onClick={() => editor?.undo()}
                    >
                      ↶
                    </button>
                    <button
                      className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                      title="Wiederholen"
                      disabled={!editor?.canRedo}
                      onClick={() => editor?.redo()}
                    >
                      ↷
                    </button>
                    <label
                      className="ml-1 flex cursor-pointer items-center gap-1.5 border-l border-gray-200 py-1 pl-2 pr-1 text-sm text-gray-700"
                      title="Aus: neue Segmente als Luftlinie (gestrichelt)"
                    >
                      <input
                        type="checkbox"
                        checked={editor?.snapping ?? true}
                        onChange={(e) => editor?.setSnapping(e.target.checked)}
                      />
                      Snapping
                    </label>
                    {editor?.routingBusy && (
                      <span className="px-1 text-xs text-gray-400">routet …</span>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Kennzahlen-Leiste (PRD F3) */}
            {tab === 'karte' && statsSource && (statsSource.distance_m > 0 || editing) && (
              <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-gray-200 bg-white/95 px-4 py-1.5 text-sm text-gray-800 shadow-md">
                {(statsSource.distance_m / 1000).toFixed(1)} km
                <span className="mx-2 text-gray-300">·</span>↑{' '}
                {statsSource.ascent_m ?? '–'} m
                <span className="mx-2 text-gray-300">·</span>↓{' '}
                {statsSource.descent_m ?? '–'} m
                <span className="mx-2 text-gray-300">·</span>
                {statsSource.duration_min !== null
                  ? formatDuration(statsSource.duration_min)
                  : '–'}
              </div>
            )}

            {editing && (
              <div className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded bg-gray-900/75 px-3 py-1 text-xs text-white">
                Klick: Punkt anhängen · Klick auf Linie: Punkt einfügen · Ziehen:
                verschieben · Rechtsklick: löschen
              </div>
            )}

            {tab === 'book' && (
              <div className="absolute inset-0 z-20 bg-gray-50">
                {selectedTour ? (
                  <BookView
                    tourId={selectedTour.id}
                    tourName={selectedTour.name}
                    highlightCardId={highlightCardId}
                    onHighlightDone={() => setHighlightCardId(null)}
                    // Book ist auch mobil editierbar; nur fremde Touren sind read-only.
                    readOnly={!isOwner}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-500">
                    Zuerst links eine Tour wählen.
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {showSettings && (
        <SettingsDialog
          initial={config}
          onSave={(c) => {
            updateConfig(c)
            setShowSettings(false)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showImport && (
        <ImportDialog
          onPreview={setPreview}
          onConfirm={handleImportConfirm}
          onClose={closeImport}
        />
      )}
    </div>
  )
}
