import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  elevationGainLoss,
  lineBbox,
  lineDistanceM,
  nearestPointOnLine,
  serializeGpx,
} from '@tourenbuch/shared'
import { ApiProvider, useApi, useApiConfig, useAuthInfo } from './lib/api'
import { saveTextFile } from './lib/save-file'
import { TourList } from './components/TourList'
import { SettingsDialog } from './components/SettingsDialog'
import { ShareDialog } from './components/ShareDialog'
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

/** Foto-Pins werden bis zu dieser Distanz auf die Route gesetzt (GPS-Streuung). */
const PIN_SNAP_MAX_M = 250

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
  const [showShare, setShowShare] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [preview, setPreview] = useState<ImportCandidate | null>(null)
  const { config, updateConfig } = useApiConfig()
  const { user, signOut } = useAuthInfo()
  const api = useApi()
  const queryClient = useQueryClient()
  const { data: tours } = useTours()
  const { data: sharedTours } = useSharedTours()
  const selectedTour =
    tours?.find((t) => t.id === selectedId) ?? sharedTours?.find((t) => t.id === selectedId) ?? null
  // Owner darf alles; fremde Touren sind editierbar, wenn die Freigabe Schreibrecht hat.
  const isOwner = selectedTour === null || selectedTour.user_id === user.id
  const canWrite: boolean =
    isOwner || (selectedTour as { can_write?: boolean } | null)?.can_write === true
  const readOnly = useReadOnly()
  // Auch die mobile PWA editiert jetzt das Book — die Upload-Queue muss dort
  // ebenfalls laufen, damit frisch importierte Bilder nach R2 kommen.
  const uploadStatus = useUploadQueue(config !== null)
  const [fullscreen, setFullscreen] = useState(false)
  const [editing, setEditing] = useState(false)
  const editor = useRouteEditor(selectedTour, editing && !readOnly && canWrite && tab === 'karte')
  const [highlightCardId, setHighlightCardId] = useState<string | null>(null)
  // Bild ↔ Foto-Pin: Hover ist flüchtig, Klick auf einen Pin bleibt markiert.
  const [hoverImageId, setHoverImageId] = useState<string | null>(null)
  const [pinnedImageId, setPinnedImageId] = useState<string | null>(null)
  const highlightImageId = hoverImageId ?? pinnedImageId
  // «Position auf der Karte setzen»: Bild, dessen Position der nächste Kartenklick setzt.
  const [placingImageId, setPlacingImageId] = useState<string | null>(null)

  // Foto-Pins: Bilder mit GPS der aktiven Tour, Thumb-URLs lokal auflösen.
  // Liegt die GPS-Position nahe an der Route, wird der Pin auf die Route gesetzt.
  const { data: tourImages } = useTourImages(selectedId)
  const tourGeometry = selectedTour?.geometry ?? null
  const [photoPins, setPhotoPins] = useState<PhotoPin[]>([])
  useEffect(() => {
    let alive = true
    const withGps = (tourImages ?? []).filter((i) => i.lat !== null && i.lon !== null)
    void Promise.all(
      withGps.map(async (i) => {
        let lon = i.lon!
        let lat = i.lat!
        if (tourGeometry) {
          const near = nearestPointOnLine(tourGeometry, [lon, lat])
          if (near.distM <= PIN_SNAP_MAX_M) [lon, lat] = near.point
        }
        return {
          imageId: i.id,
          cardId: i.card_id,
          lon,
          lat,
          thumbUrl: (await resolveImageUrls(i, api))?.thumb ?? null,
        }
      })
    ).then((pins) => {
      if (alive) setPhotoPins(pins)
    })
    return () => {
      alive = false
    }
  }, [tourImages, api, tourGeometry])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // «Position setzen»: Esc bricht ab; Reiterwechsel ebenfalls.
  useEffect(() => {
    if (!placingImageId) return
    if (tab !== 'book') {
      setPlacingImageId(null)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlacingImageId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingImageId, tab])

  const placingImage = placingImageId
    ? ((tourImages ?? []).find((i) => i.id === placingImageId) ?? null)
    : null

  const saveImagePosition = async (imageId: string, lonLat: [number, number] | null) => {
    try {
      await api.updateImage(imageId, {
        lat: lonLat ? lonLat[1] : null,
        lon: lonLat ? lonLat[0] : null,
      })
      await queryClient.invalidateQueries({ queryKey: ['images'] })
      setPinnedImageId(lonLat ? imageId : null)
    } finally {
      setPlacingImageId(null)
    }
  }

  const selectTour = (id: string | null) => {
    setEditing(false)
    setPinnedImageId(null)
    setHoverImageId(null)
    setPlacingImageId(null)
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

  const openImport = () => {
    setFullscreen(false)
    setTab('karte')
    setShowImport(true)
  }

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
    <div className="relative flex h-full flex-col">
      {/* Sidebar: mobil als Startscreen im Fluss (Detail erst nach Tour-Wahl, PRD F6),
          auf Desktop als schwebende Karte links über der Map. */}
      <div
        className={`${fullscreen ? 'hidden' : selectedId || showImport ? 'hidden md:block' : 'block'} min-h-0 flex-1 md:absolute md:inset-y-3 md:left-3 md:z-30 md:w-72 md:flex-none`}
      >
        <TourList
          selectedId={selectedId}
          onSelect={selectTour}
          readOnly={readOnly}
          // Touren anlegen und GPX importieren geht auch mobil; nur die Routen-Bearbeitung bleibt Desktop.
          canCreate
          onImportGpx={openImport}
          userEmail={user.email}
          onSignOut={() => void signOut()}
          onOpenSettings={() => setShowSettings(true)}
          uploadStatus={uploadStatus}
        />
      </div>

      {/* Mobil während des GPX-Imports: Karte zeigen, damit die Vorschau sichtbar ist. */}
      <main
        className={`${fullscreen || selectedId || showImport ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}
      >
        {/* Reiter + Aktionen: mobil als Leiste, auf Desktop als schwebende Pille rechts der Sidebar. */}
        <nav
          className={`${fullscreen ? 'hidden' : showImport && !selectedId ? 'hidden md:flex' : 'flex'} items-center gap-0.5 border-b border-gray-200 bg-white p-1 md:absolute md:left-[19.75rem] md:top-3 md:z-30 md:max-w-[calc(100%-20.5rem)] md:rounded-lg md:border md:bg-white/95 md:shadow-md md:backdrop-blur-md`}
        >
          {selectedId && (
            <button
              className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-blue-700 md:hidden"
              onClick={() => selectTour(null)}
            >
              ‹ Touren
            </button>
          )}
          {/* Kein eigener «Karte»-Reiter: «Book» schaltet um, nochmals tippen führt zur Karte zurück. */}
          <button
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === 'book' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={tab === 'book' ? 'Zurück zur Karte' : 'Book öffnen'}
            aria-pressed={tab === 'book'}
            onClick={() => setTab(tab === 'book' ? 'karte' : 'book')}
          >
            Book
          </button>

          {!readOnly && (
            <div className="ml-2 flex shrink-0 items-center gap-0.5 whitespace-nowrap border-l border-gray-200 pl-2">
              <button
                className="rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                title="GPX-Datei als neue Tour importieren"
                onClick={openImport}
              >
                ⤒ GPX-Import
              </button>
              <button
                className="rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40"
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
            <span className="ml-2 flex min-w-0 items-center gap-2 border-l border-gray-200 pl-2 pr-1">
              {isOwner && !readOnly ? (
                <button
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                    selectedTour.visibility === 'public'
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-gray-300 text-gray-500 hover:bg-gray-100'
                  }`}
                  title="Tour teilen: für alle oder für bestimmte Personen, mit oder ohne Schreibrecht"
                  onClick={() => setShowShare(true)}
                >
                  {selectedTour.visibility === 'public' ? '🌍 Geteilt' : 'Teilen'}
                </button>
              ) : !isOwner ? (
                <span
                  className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500"
                  title={
                    canWrite ? 'Geteilte Tour – du darfst bearbeiten' : 'Geteilte Tour – nur lesen'
                  }
                >
                  {canWrite ? '✎ geteilt' : '🌍 geteilt'}
                </span>
              ) : null}
              <span className="truncate text-sm text-gray-400 md:max-w-48">
                {selectedTour.name}
              </span>
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
            onPhotoClick={(cardId, imageId) => {
              setFullscreen(false)
              setTab('book')
              // Desktop: Bild im Karussell des Panels markieren (bleibt bis zum nächsten Klick);
              // mobil: im Grid zur Kachel scrollen.
              setPinnedImageId(imageId)
              if (!window.matchMedia('(min-width: 768px)').matches) setHighlightCardId(cardId)
            }}
            onPhotoHover={setHoverImageId}
            highlightImageId={highlightImageId}
            placing={placingImageId !== null}
            onPlaceClick={(lonLat) => {
              if (placingImageId) void saveImagePosition(placingImageId, lonLat)
            }}
            onPhotoMove={
              canWrite && !readOnly ? (id, lonLat) => void saveImagePosition(id, lonLat) : undefined
            }
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((f) => !f)}
            hideControls={tab === 'book'}
            onOpenBook={
              selectedTour
                ? () => {
                    setFullscreen(false)
                    setTab('book')
                  }
                : undefined
            }
          />

          {/* Editor-Toolbar */}
          {!readOnly && canWrite && tab === 'karte' && selectedTour && (
            <div
              className={`absolute left-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-gray-200 bg-white/95 px-2 py-1.5 shadow-md ${fullscreen ? '' : 'md:left-[22.75rem] md:top-[3.875rem]'}`}
            >
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
            <div
              className={`absolute bottom-6 left-1/2 z-10 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white/95 px-4 py-1.5 text-center text-sm text-gray-800 shadow-md ${fullscreen ? '' : 'md:left-[calc(50%+0.125rem)]'}`}
            >
              {/* Mobil zwei Zeilen (Distanz · Zeit / Höhenmeter), ab md eine Zeile. */}
              <span className="block whitespace-nowrap md:inline">
                {(statsSource.distance_m / 1000).toFixed(1)} km
                <span className="mx-2 text-gray-300">·</span>
                {statsSource.duration_min !== null ? formatDuration(statsSource.duration_min) : '–'}
              </span>
              <span className="mx-2 hidden text-gray-300 md:inline">·</span>
              <span className="block whitespace-nowrap md:inline">
                ↑ {statsSource.ascent_m ?? '–'} m
                <span className="mx-2 text-gray-300">·</span>↓ {statsSource.descent_m ?? '–'} m
              </span>
            </div>
          )}

          {editing && (
            <div
              className={`absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded bg-gray-900/75 px-3 py-1 text-xs text-white ${fullscreen ? '' : 'md:left-[calc(50%+0.125rem)]'}`}
            >
              Klick: Punkt anhängen · Klick auf Linie: Punkt einfügen · Ziehen: verschieben ·
              Rechtsklick: löschen
            </div>
          )}

          {/* Book-Modus auf Desktop/Tablet: Kacheln kompakt als schwebende Spalte rechts
              auf der Karte, einzeln nach links aufklappbar. Beginnt unterhalb der
              Reiter-Pille (kein Überlappen auf schmalen Viewports wie iPad);
              Kartenoptionen/Ortssuche sind dabei ausgeblendet (hideControls). */}
          {tab === 'book' && selectedTour && !fullscreen && (
            <div className="absolute bottom-3 right-3 top-[3.875rem] z-10 hidden md:block">
              <BookView
                variant="panel"
                tourId={selectedTour.id}
                tourName={selectedTour.name}
                highlightCardId={highlightCardId}
                onHighlightDone={() => setHighlightCardId(null)}
                readOnly={!canWrite}
                highlightImageId={highlightImageId}
                onImageHover={setHoverImageId}
                placingImageId={placingImageId}
                onSetPosition={(id) => setPlacingImageId((cur) => (cur === id ? null : id))}
              />
            </div>
          )}

          {/* Hinweisleiste im «Position setzen»-Modus */}
          {placingImageId && (
            <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-blue-200 bg-white/95 px-4 py-2 text-sm text-gray-800 shadow-lg backdrop-blur md:left-[calc(50%+0.125rem)]">
              <span className="text-lg" aria-hidden="true">
                📍
              </span>
              <span>
                Auf die Karte klicken, um die Position
                {placingImage?.caption ? ` von «${placingImage.caption}»` : ' des Bildes'} zu
                setzen.
              </span>
              {placingImage?.lat !== null && placingImage?.lat !== undefined && (
                <button
                  className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => void saveImagePosition(placingImageId, null)}
                >
                  Position entfernen
                </button>
              )}
              <button
                className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                onClick={() => setPlacingImageId(null)}
              >
                Abbrechen (Esc)
              </button>
            </div>
          )}

          {/* Book-Modus mobil: Grid als Overlay über der Karte (Desktop nutzt das Panel). */}
          {tab === 'book' && (
            <div className="absolute inset-0 z-20 bg-gray-100 md:hidden">
              {selectedTour ? (
                <BookView
                  tourId={selectedTour.id}
                  tourName={selectedTour.name}
                  highlightCardId={highlightCardId}
                  onHighlightDone={() => setHighlightCardId(null)}
                  // Book ist auch mobil editierbar; fremde Touren nur mit Schreibrecht.
                  readOnly={!canWrite}
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

      {showShare && selectedTour && isOwner && (
        <ShareDialog tour={selectedTour} onClose={() => setShowShare(false)} />
      )}

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
