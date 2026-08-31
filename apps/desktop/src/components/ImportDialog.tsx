import { useRef, useState } from 'react'
import {
  GpxParseError,
  elevationGainLoss,
  lineBbox,
  lineDistanceM,
  parseGpx,
  type ParsedGpx,
} from '@tourenbuch/shared'

export interface ImportCandidate extends ParsedGpx {
  /** Vorschlag für den Tour-Namen (Trackname oder Dateiname ohne .gpx). */
  suggestedName: string
}

interface Props {
  /** Wird bei jeder erfolgreich geparsten Datei gerufen (steuert die Karten-Vorschau). */
  onPreview: (candidate: ImportCandidate | null) => void
  /** Übernehmen: Tour anlegen. */
  onConfirm: (candidate: ImportCandidate, name: string) => Promise<void>
  onClose: () => void
}

export function ImportDialog({ onPreview, onConfirm, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const parsed = parseGpx(await file.text())
      const suggestedName = parsed.name ?? file.name.replace(/\.gpx$/i, '')
      const next = { ...parsed, suggestedName }
      setCandidate(next)
      setName(suggestedName)
      onPreview(next)
    } catch (e) {
      setCandidate(null)
      onPreview(null)
      setError(
        e instanceof GpxParseError
          ? e.message
          : 'Datei konnte nicht gelesen werden'
      )
    }
  }

  const stats = candidate
    ? {
        points: candidate.line.coordinates.length,
        km: (lineDistanceM(candidate.line) / 1000).toFixed(1),
        gainLoss: elevationGainLoss(candidate.line),
        bbox: lineBbox(candidate.line),
      }
    : null

  return (
    // Kein Backdrop: Die Karten-Vorschau soll während des Imports sichtbar
    // und bedienbar bleiben (Plan Phase 4: «Vorschau auf Karte»).
    <div className="pointer-events-none fixed inset-x-0 top-24 z-30 flex justify-center">
      <div className="pointer-events-auto w-96 rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
        <h2 className="mb-3 text-base font-semibold text-gray-900">GPX importieren</h2>

        <input
          ref={fileRef}
          type="file"
          accept=".gpx,application/gpx+xml"
          className="mb-3 block w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />

        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {candidate && stats && (
          <div className="mb-3 space-y-2">
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">Tour-Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <p className="text-sm text-gray-600">
              {stats.points} Punkte · {stats.km} km
              {stats.gainLoss
                ? ` · ↑ ${stats.gainLoss.ascent_m} m · ↓ ${stats.gainLoss.descent_m} m`
                : ' · keine Höhendaten'}
            </p>
            <p className="text-xs text-gray-400">Vorschau auf der Karte (gestrichelt).</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            Abbrechen
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!candidate || !name.trim() || busy}
            onClick={async () => {
              if (!candidate) return
              setBusy(true)
              try {
                await onConfirm(candidate, name.trim())
              } catch {
                setError('Import fehlgeschlagen – läuft die API?')
                setBusy(false)
              }
            }}
          >
            {busy ? 'Importiere …' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </div>
  )
}
