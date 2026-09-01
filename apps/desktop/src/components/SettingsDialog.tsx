import { useState } from 'react'
import { defaultApiUrl, type AppConfig } from '../lib/config'

interface Props {
  initial: AppConfig | null
  onSave: (config: AppConfig) => void
  onClose?: () => void
}

/** Verbindungseinstellung: nur noch die API-URL (Login läuft über Neon Auth). */
export function SettingsDialog({ initial, onSave, onClose }: Props) {
  const [apiUrl, setApiUrl] = useState(
    initial?.apiUrl ?? (defaultApiUrl() || 'http://localhost:8787')
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-96 rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Verbindung einrichten</h2>
        <label className="mb-1 block text-sm font-medium text-gray-700">API-URL</label>
        <input
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="https://tourenbuch-api.topos-ch.workers.dev"
        />
        <p className="mb-4 text-xs text-gray-500">
          Anmeldung und Konten laufen über Neon Auth – nach dem Speichern erscheint der
          Login.
        </p>
        <div className="flex justify-end gap-2">
          {onClose && (
            <button
              className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
              onClick={onClose}
            >
              Abbrechen
            </button>
          )}
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={apiUrl.trim().length === 0}
            onClick={() => onSave({ apiUrl: apiUrl.trim() })}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
