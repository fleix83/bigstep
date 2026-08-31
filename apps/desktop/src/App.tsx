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

type Tab = 'karte' | 'book'

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
        <TourList selectedId={selectedId} onSelect={setSelectedId} />

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
            />
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
