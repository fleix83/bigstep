export interface Env {
  DATABASE_URL: string
  /** Basis-URL von Neon Auth (Managed Better Auth), z. B. https://…/neondb/auth */
  NEON_AUTH_URL: string
  /** Nur Tests: Inline-JWKS-JSON statt Remote-Abruf. */
  TEST_JWKS?: string
  /** R2-Bucket für Bild-Ableitungen (Phase 8). */
  R2: R2Bucket
}
