import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Card, CardUpdate, Image } from '@tourenbuch/shared'
import { useApi } from '../lib/api'
import { processImageFile } from '../lib/image-pipeline'
import { hasDerivatives, removeDerivatives, saveDerivatives } from '../lib/image-store'

const cardsKey = (tourId: string) => ['cards', tourId] as const
const imagesKey = (tourId: string) => ['images', tourId] as const

export function useCards(tourId: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: cardsKey(tourId ?? 'none'),
    queryFn: () => api.listCards(tourId!),
    enabled: tourId !== null,
  })
}

export function useTourImages(tourId: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: imagesKey(tourId ?? 'none'),
    queryFn: () => api.listTourImages(tourId!),
    enabled: tourId !== null,
  })
}

export function useCardMutations(tourId: string | null) {
  const api = useApi()
  const queryClient = useQueryClient()
  const invalidateCards = () =>
    queryClient.invalidateQueries({ queryKey: cardsKey(tourId ?? 'none') })
  const invalidateImages = () =>
    queryClient.invalidateQueries({ queryKey: imagesKey(tourId ?? 'none') })

  const createCard = useMutation({
    mutationFn: () => api.createCard({ tour_id: tourId! }),
    onSuccess: invalidateCards,
  })

  const updateCard = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CardUpdate }) => api.updateCard(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData<Card[]>(cardsKey(tourId ?? 'none'), (old) =>
        old?.map((c) => (c.id === updated.id ? updated : c))
      )
    },
  })

  const deleteCard = useMutation({
    mutationFn: (id: string) => api.deleteCard(id),
    onSuccess: () => {
      void invalidateCards()
      void invalidateImages()
    },
  })

  const reorderCards = useMutation({
    mutationFn: (ids: string[]) => api.reorderCards(tourId!, ids),
    // Optimistisch, damit das Drag-and-drop nicht zurückspringt.
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: cardsKey(tourId ?? 'none') })
      const previous = queryClient.getQueryData<Card[]>(cardsKey(tourId ?? 'none'))
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]))
        queryClient.setQueryData<Card[]>(
          cardsKey(tourId ?? 'none'),
          ids.map((id, i) => ({ ...byId.get(id)!, position: i }))
        )
      }
      return { previous }
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(cardsKey(tourId ?? 'none'), ctx.previous)
    },
    onSuccess: (rows) => {
      queryClient.setQueryData(cardsKey(tourId ?? 'none'), rows)
    },
  })

  /**
   * Bild-Import: verarbeiten (sha, EXIF, Ableitungen), lokal speichern,
   * Metadaten anlegen. Duplikate (gleiche sha256) überspringen die
   * Verarbeitung, wenn die Ableitungen schon lokal liegen.
   */
  const addImages = useMutation({
    mutationFn: async ({ cardId, files }: { cardId: string; files: File[] }) => {
      const results: Image[] = []
      for (const file of files) {
        const processed = await processImageFile(file)
        if (!(await hasDerivatives(processed.sha256))) {
          await saveDerivatives(
            processed.sha256,
            processed.ext,
            processed.displayBlob,
            processed.thumbBlob
          )
        }
        results.push(
          await api.createImage({
            card_id: cardId,
            sha256: processed.sha256,
            ...(processed.lat !== null && processed.lon !== null
              ? { lat: processed.lat, lon: processed.lon }
              : {}),
            ...(processed.taken_at !== null ? { taken_at: processed.taken_at } : {}),
          })
        )
      }
      return results
    },
    onSuccess: invalidateImages,
  })

  const deleteImage = useMutation({
    mutationFn: async (image: Image) => {
      await api.deleteImage(image.id)
      await removeDerivatives(image.sha256).catch(() => {})
    },
    onSuccess: invalidateImages,
  })

  return { createCard, updateCard, deleteCard, reorderCards, addImages, deleteImage }
}
