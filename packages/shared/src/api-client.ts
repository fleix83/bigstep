import { z } from 'zod'
import {
  cardSchema,
  imageSchema,
  tourSchema,
  type Card,
  type CardCreate,
  type CardUpdate,
  type Image,
  type ImageCreate,
  type ImageUpdate,
  type Tour,
  type TourCreate,
  type TourUpdate,
} from './schemas'

export interface ApiClientConfig {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

/**
 * Fetch-Wrapper für die Tourenbuch-API. Antworten werden mit den
 * Zod-Schemas validiert, Fehler als ApiRequestError geworfen.
 */
export class ApiClient {
  constructor(private config: ApiClientConfig) {}

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T> | null,
    body?: unknown
  ): Promise<T> {
    const doFetch = this.config.fetchImpl ?? fetch
    const res = await doFetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const parsed = errorBodySchema.safeParse(await res.json().catch(() => null))
      if (parsed.success) {
        throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
      }
      throw new ApiRequestError(res.status, 'http_error', `HTTP ${res.status}`)
    }
    if (schema === null) return undefined as T
    return schema.parse(await res.json())
  }

  // Tours
  listTours(sort: 'updated' | 'name' = 'updated'): Promise<Tour[]> {
    return this.request('GET', `/api/tours?sort=${sort}`, z.array(tourSchema))
  }
  createTour(data: TourCreate): Promise<Tour> {
    return this.request('POST', '/api/tours', tourSchema, data)
  }
  updateTour(id: string, data: TourUpdate): Promise<Tour> {
    return this.request('PATCH', `/api/tours/${id}`, tourSchema, data)
  }
  deleteTour(id: string): Promise<void> {
    return this.request('DELETE', `/api/tours/${id}`, null)
  }

  // Cards
  listCards(tourId: string): Promise<Card[]> {
    return this.request('GET', `/api/tours/${tourId}/cards`, z.array(cardSchema))
  }
  createCard(data: CardCreate): Promise<Card> {
    return this.request('POST', '/api/cards', cardSchema, data)
  }
  updateCard(id: string, data: CardUpdate): Promise<Card> {
    return this.request('PATCH', `/api/cards/${id}`, cardSchema, data)
  }
  deleteCard(id: string): Promise<void> {
    return this.request('DELETE', `/api/cards/${id}`, null)
  }
  reorderCards(tourId: string, ids: string[]): Promise<Card[]> {
    return this.request('POST', '/api/cards/reorder', z.array(cardSchema), {
      tour_id: tourId,
      ids,
    })
  }

  // Images
  listTourImages(tourId: string): Promise<Image[]> {
    return this.request('GET', `/api/tours/${tourId}/images`, z.array(imageSchema))
  }
  createImage(data: ImageCreate): Promise<Image> {
    return this.request('POST', '/api/images', imageSchema, data)
  }
  updateImage(id: string, data: ImageUpdate): Promise<Image> {
    return this.request('PATCH', `/api/images/${id}`, imageSchema, data)
  }
  deleteImage(id: string): Promise<void> {
    return this.request('DELETE', `/api/images/${id}`, null)
  }

  // Bild-Binärdaten (R2, Phase 8)
  listImages(state?: 'pending' | 'uploaded' | 'failed'): Promise<Image[]> {
    const suffix = state ? `?state=${state}` : ''
    return this.request('GET', `/api/images${suffix}`, z.array(imageSchema))
  }

  async uploadImageVariant(
    sha256: string,
    variant: 'display' | 'thumb',
    blob: Blob
  ): Promise<void> {
    const doFetch = this.config.fetchImpl ?? fetch
    const res = await doFetch(`${this.config.baseUrl}/api/images/${sha256}/${variant}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    })
    if (!res.ok) throw new ApiRequestError(res.status, 'upload_failed', `HTTP ${res.status}`)
  }

  async fetchImageVariant(sha256: string, variant: 'display' | 'thumb'): Promise<Blob> {
    const doFetch = this.config.fetchImpl ?? fetch
    const res = await doFetch(`${this.config.baseUrl}/api/images/${sha256}/${variant}`, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    })
    if (!res.ok) throw new ApiRequestError(res.status, 'download_failed', `HTTP ${res.status}`)
    return res.blob()
  }

  // Settings
  getSettings(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/settings', z.record(z.string(), z.unknown()))
  }
  putSetting(key: string, value: unknown): Promise<void> {
    return this.request(
      'PUT',
      `/api/settings/${encodeURIComponent(key)}`,
      null,
      { value }
    )
  }
}
