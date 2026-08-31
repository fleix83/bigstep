import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  elevationGainLoss,
  lineBbox,
  lineDistanceM,
  serializeGpx,
} from '@tourenbuch/shared'
import { ApiProvider, useApi, useApiConfig } from './lib/api'
import { saveTextFile } from './lib/save-file'
import { TourList } from './components/TourList'
import { SettingsDialog } from './components/SettingsDialog'
import { MapView } from './components/MapView'
import { ImportDialog, type ImportCandidate } from './components/ImportDialog'
import { useTours } from './hooks/useTours'
import { useRouteEditor } from './hooks/useRouteEditor'

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
  const api = useApi()
  const queryClient = useQueryClient()
  const { data: tours } = useTours()
  const selectedTour = tours?.find((t) => t.id === selectedId) ?? null
  const [editing, setEditing] = useState(false)
  const editor = useRouteEditor(selectedTour, editing && tab === 'karte')

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
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <h1 className="text-base font-semibold text-gray-900">Tourenbuch</h1>
        <button
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          title="Einstellungen"
          onClick={() => setShowSettings(true)}
        >
          ⚙︎
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <TourList selectedId={selectedId} onSelect={selectTour} />

        <main className="flex min-w-0 flex-1 flex-col">
          <nav className="flex items-center border-b border-gray-200 bg-white">
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

            {selectedTour && (
              <span className="ml-auto self-center px-4 text-sm text-gray-400">
                {selectedTour.name}
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
            />

            {/* Editor-Toolbar */}
            {tab === 'karte' && selectedTour && (
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
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-100 text-sm text-gray-500">
                Book folgt in Phase 6
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
