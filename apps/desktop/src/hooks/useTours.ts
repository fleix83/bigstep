import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tour, TourCreate, TourUpdate } from '@tourenbuch/shared'
import { useApi } from '../lib/api'

/**
 * Ein Cache-Key für alle Touren (Server liefert updated_at desc);
 * alphabetische Sortierung passiert clientseitig. So bleiben
 * Optimistic Updates auf genau einen Cache beschränkt.
 */
const KEY = ['tours'] as const

export function useTours() {
  const api = useApi()
  return useQuery({ queryKey: KEY, queryFn: () => api.listTours('updated') })
}

interface OptimisticContext {
  previous: Tour[] | undefined
}

function useOptimisticTourMutation<TVars>(
  mutationFn: (vars: TVars) => Promise<unknown>,
  applyOptimistic: (tours: Tour[], vars: TVars) => Tour[],
  onErrorMessage: (message: string) => void
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars): Promise<OptimisticContext> => {
      await queryClient.cancelQueries({ queryKey: KEY })
      const previous = queryClient.getQueryData<Tour[]>(KEY)
      queryClient.setQueryData<Tour[]>(KEY, (old) => applyOptimistic(old ?? [], vars))
      return { previous }
    },
    onError: (err, _vars, context) => {
      // Rollback auf den Stand vor dem Optimistic Update
      if (context?.previous !== undefined) queryClient.setQueryData(KEY, context.previous)
      onErrorMessage(err instanceof Error ? err.message : 'Unbekannter Fehler')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useTourMutations(onError: (message: string) => void) {
  const api = useApi()
  const queryClient = useQueryClient()

  const createTour = useMutation({
    mutationFn: (data: TourCreate) => api.createTour(data),
    onSuccess: (tour) => {
      queryClient.setQueryData<Tour[]>(KEY, (old) => [tour, ...(old ?? [])])
    },
    onError: (err) => onError(err instanceof Error ? err.message : 'Unbekannter Fehler'),
  })

  const updateTour = useOptimisticTourMutation<{ id: string; data: TourUpdate }>(
    ({ id, data }) => api.updateTour(id, data),
    (tours, { id, data }) =>
      tours.map((t) =>
        t.id === id ? { ...t, ...data, updated_at: new Date().toISOString() } : t
      ),
    onError
  )

  const deleteTour = useOptimisticTourMutation<{ id: string }>(
    ({ id }) => api.deleteTour(id),
    (tours, { id }) => tours.filter((t) => t.id !== id),
    onError
  )

  return { createTour, updateTour, deleteTour }
}
