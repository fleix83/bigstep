import type { ZodType } from 'zod'
import { z } from 'zod'

/** Einheitliches Fehlerformat: { error: { code, message } } (PLAN Phase 1.4). */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 413 | 500,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function validate<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ')
    throw new ApiError(400, 'validation_error', detail)
  }
  return result.data
}

export const uuidParam = z.uuid()
