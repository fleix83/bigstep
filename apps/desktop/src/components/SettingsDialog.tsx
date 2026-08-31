import { useState } from 'react'
import type { AppConfig } from '../lib/config'

interface Props {
  initial: AppConfig | null
  onSave: (config: AppConfig) => void
  onClose?: () => void
}

/** Erfassung von API-URL und Bearer-Token (PLAN Phase 2.3). */
export function SettingsDialog({ initial, onSave, onClose }: Props) {
  const [apiUrl, setApiUrl] = useState(initial?.apiUrl ?? 'http://localhost:8787')
  const [token, setToken] = useState(initial?.token ?? '')

  const valid = apiUrl.trim().length > 0 && token.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-96 rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Verbindung einrichten</h2>
        <label className="mb-1 block text-sm font-medium text-gray-700">API-URL</label>
        <input
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="http://localhost:8787"
        />
        <label className="mb-1 block text-sm font-medium text-gray-700">API-Token</label>
        <input
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer-Token"
        />
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
            disabled={!valid}
            onClick={() => onSave({ apiUrl: apiUrl.trim(), token: token.trim() })}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
