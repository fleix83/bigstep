import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tour, TourUpdate } from '@tourenbuch/shared'
import { useApi } from '../lib/api'

interface Props {
  tour: Tour
  onClose: () => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Unbekannter Fehler')

/**
 * Tour teilen: 1) für alle User der App (optional mit Schreibrecht),
 * 2) für bestimmte Personen per E-Mail (Konto in der App nötig), je mit
 * Schreibrecht-Schalter. Schreibrecht = Book und Route bearbeiten; Sichtbarkeit,
 * Freigaben und Löschen bleiben beim Owner.
 */
export function ShareDialog({ tour, onClose }: Props) {
  const api = useApi()
  const queryClient = useQueryClient()
  const sharesKey = ['tours', tour.id, 'shares'] as const
  const shares = useQuery({ queryKey: sharesKey, queryFn: () => api.listTourShares(tour.id) })
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidateShares = () => queryClient.invalidateQueries({ queryKey: sharesKey })

  const updateTour = useMutation({
    mutationFn: (data: TourUpdate) => api.updateTour(tour.id, data),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['tours'] })
    },
    onError: (e) => setError(msg(e)),
  })
  const addShare = useMutation({
    mutationFn: (mail: string) => api.addTourShare(tour.id, { email: mail, can_write: true }),
    onSuccess: () => {
      setEmail('')
      setError(null)
      void invalidateShares()
    },
    onError: (e) => setError(msg(e)),
  })
  const setWrite = useMutation({
    mutationFn: ({ userId, canWrite }: { userId: string; canWrite: boolean }) =>
      api.updateTourShare(tour.id, userId, { can_write: canWrite }),
    onSuccess: () => void invalidateShares(),
    onError: (e) => setError(msg(e)),
  })
  const removeShare = useMutation({
    mutationFn: (userId: string) => api.removeTourShare(tour.id, userId),
    onSuccess: () => void invalidateShares(),
    onError: (e) => setError(msg(e)),
  })

  const isPublic = tour.visibility === 'public'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tour teilen"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900">Tour teilen</h2>
        <p className="mb-4 truncate text-sm text-gray-500">{tour.name}</p>

        {/* 1) Alle User */}
        <section className="rounded-lg border border-gray-200 p-3">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isPublic}
              disabled={updateTour.isPending}
              onChange={(e) =>
                updateTour.mutate({
                  visibility: e.target.checked ? 'public' : 'private',
                  ...(e.target.checked ? {} : { public_can_write: false }),
                })
              }
            />
            <span>
              <span className="text-sm font-medium text-gray-900">Für alle User der App</span>
              <span className="block text-xs text-gray-500">
                Erscheint bei allen unter «Von anderen geteilt», inkl. Book.
              </span>
            </span>
          </label>
          <label
            className={`mt-2 flex items-start gap-2 pl-6 ${isPublic ? 'cursor-pointer' : 'opacity-40'}`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isPublic && tour.public_can_write}
              disabled={!isPublic || updateTour.isPending}
              onChange={(e) => updateTour.mutate({ public_can_write: e.target.checked })}
            />
            <span>
              <span className="text-sm text-gray-900">Alle dürfen bearbeiten</span>
              <span className="block text-xs text-gray-500">Book (Kacheln, Bilder) und Route.</span>
            </span>
          </label>
        </section>

        {/* 2) Bestimmte Personen */}
        <section className="mt-3 rounded-lg border border-gray-200 p-3">
          <div className="text-sm font-medium text-gray-900">Bestimmte Personen</div>
          <p className="mb-2 text-xs text-gray-500">
            Per E-Mail-Adresse des Kontos in dieser App. Neue Freigaben dürfen bearbeiten.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const v = email.trim()
              if (v) addShare.mutate(v)
            }}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@beispiel.ch"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={addShare.isPending || !email.trim()}
            >
              Hinzufügen
            </button>
          </form>

          <ul className="mt-2 divide-y divide-gray-100">
            {shares.isLoading && <li className="py-2 text-xs text-gray-400">Lade …</li>}
            {shares.data?.length === 0 && (
              <li className="py-2 text-xs text-gray-400">Noch niemand.</li>
            )}
            {shares.data?.map((s) => (
              <li key={s.user_id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-900">
                    {s.name || s.email || s.user_id}
                  </div>
                  {s.name && s.email && (
                    <div className="truncate text-xs text-gray-400">{s.email}</div>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={s.can_write}
                    disabled={setWrite.isPending}
                    onChange={(e) =>
                      setWrite.mutate({ userId: s.user_id, canWrite: e.target.checked })
                    }
                  />
                  bearbeiten
                </label>
                <button
                  className="rounded px-1.5 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Freigabe entfernen"
                  aria-label="Freigabe entfernen"
                  onClick={() => removeShare.mutate(s.user_id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  )
}
