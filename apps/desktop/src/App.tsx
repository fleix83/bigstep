import { useState } from 'react'
import { ApiProvider, useApiConfig } from './lib/api'
import { TourList } from './components/TourList'
import { SettingsDialog } from './components/SettingsDialog'
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
  const { config, updateConfig } = useApiConfig()
  const { data: tours } = useTours()
  const selectedTour = tours?.find((t) => t.id === selectedId) ?? null

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
          <nav className="flex border-b border-gray-200 bg-white">
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
            {selectedTour && (
              <span className="ml-auto self-center px-4 text-sm text-gray-400">
                {selectedTour.name}
              </span>
            )}
          </nav>

          <div className="min-h-0 flex-1">
            {tab === 'karte' ? (
              <div className="flex h-full items-center justify-center bg-gray-100 text-sm text-gray-500">
                Karte folgt in Phase 3
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-gray-100 text-sm text-gray-500">
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
    </div>
  )
}
