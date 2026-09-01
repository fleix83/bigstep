export interface Env {
  DATABASE_URL: string
  API_TOKEN: string
  /** R2-Bucket für Bild-Ableitungen (Phase 8). */
  R2: R2Bucket
}
