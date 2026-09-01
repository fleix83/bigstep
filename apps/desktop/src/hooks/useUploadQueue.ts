import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '../lib/api'
import { getDerivativeBlobs } from '../lib/image-store'

export interface UploadQueueStatus {
  /** Bilder mit upload_state='pending', deren Ableitungen lokal vorliegen. */
  pending: number
  uploading: boolean
}

const POLL_MS = 30_000
const BASE_BACKOFF_MS = 5_000

/**
 * Upload-Queue (PLAN 8.3): lädt alle pending-Bilder nach R2 (display + thumb),
 * setzt danach r2_key_* und upload_state='uploaded'. Die PUTs sind
 * content-addressed und damit idempotent — ein Abbruch mittendrin lässt das
 * Bild einfach pending, der nächste Durchlauf wiederholt beide Uploads.
 * Fehler werden pro Bild mit exponentiellem Backoff erneut versucht.
 */
export function useUploadQueue(enabled: boolean): UploadQueueStatus {
  const api = useApi()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<UploadQueueStatus>({ pending: 0, uploading: false })
  const runningRef = useRef(false)
  // sha → Zeitpunkt, ab dem ein neuer Versuch erlaubt ist (+ Fehlerzähler).
  const backoffRef = useRef(new Map<string, { nextTry: number; failures: number }>())

  const runOnce = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      const pending = await api.listImages('pending')
      let localPending = 0
      let touched = false
      for (const image of pending) {
        const backoff = backoffRef.current.get(image.sha256)
        if (backoff && Date.now() < backoff.nextTry) {
          localPending++
          continue
        }
        const blobs = await getDerivativeBlobs(image.sha256)
        // Ableitungen nicht auf diesem Gerät (z. B. PWA): nichts zu tun.
        if (!blobs) continue
        localPending++
        setStatus({ pending: localPending, uploading: true })
        try {
          await api.uploadImageVariant(image.sha256, 'display', blobs.display)
          await api.uploadImageVariant(image.sha256, 'thumb', blobs.thumb)
          await api.updateImage(image.id, {
            r2_key_display: `images/${image.sha256}/display`,
            r2_key_thumb: `images/${image.sha256}/thumb`,
            upload_state: 'uploaded',
          })
          backoffRef.current.delete(image.sha256)
          localPending--
          touched = true
        } catch {
          const failures = (backoff?.failures ?? 0) + 1
          backoffRef.current.set(image.sha256, {
            failures,
            nextTry: Date.now() + BASE_BACKOFF_MS * 2 ** Math.min(failures, 6),
          })
        }
      }
      if (touched) {
        void queryClient.invalidateQueries({ queryKey: ['images'] })
      }
      setStatus({ pending: localPending, uploading: false })
    } catch {
      // Liste nicht ladbar (offline?): beim nächsten Poll erneut.
      setStatus((s) => ({ ...s, uploading: false }))
    } finally {
      runningRef.current = false
    }
  }, [api, queryClient])

  useEffect(() => {
    if (!enabled) return
    void runOnce()
    const timer = window.setInterval(() => void runOnce(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [enabled, runOnce])

  return status
}
