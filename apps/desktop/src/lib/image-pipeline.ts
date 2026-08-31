/**
 * Bild-Pipeline (PLAN Phase 6.3) – Entscheidung und Begründung:
 *
 * Die Verarbeitung läuft im WEBVIEW (Canvas + exifr), nicht in Rust, weil
 * (a) derselbe Code in Tauri-Webview, Dev-Browser und späterer PWA läuft,
 * (b) keine nativen Encoder-/EXIF-Abhängigkeiten in den Rust-Build wandern,
 * (c) Chromium WebP-Encoding nativ mitbringt. Einschränkung: WKWebView
 * (Tauri auf macOS) encodiert kein WebP – dann entstehen JPEG-Ableitungen
 * (gleiche Namenskonvention, Endung .jpg); im CHANGELOG dokumentiert.
 * HEIC wird vor der Verarbeitung mit heic2any (libheif-wasm, lazy geladen)
 * nach JPEG konvertiert.
 */
import exifr from 'exifr'

export interface ProcessedImage {
  sha256: string
  lat: number | null
  lon: number | null
  taken_at: string | null
  /** 2000-px-Ableitung (längste Kante). */
  displayBlob: Blob
  /** 300-px-Ableitung. */
  thumbBlob: Blob
  /** Tatsächliches Ableitungsformat: 'webp' oder 'jpg' (WKWebView-Fallback). */
  ext: 'webp' | 'jpg'
}

const DISPLAY_MAX = 2000
const THUMB_MAX = 300

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isHeic(file: File): boolean {
  return (
    /image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name)
  )
}

async function encodeScaled(
  bitmap: ImageBitmap,
  maxDim: number
): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.82)
  )
  if (blob && blob.type === 'image/webp') return { blob, ext: 'webp' }
  // WKWebView liefert kein WebP → JPEG-Fallback.
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  )
  if (!jpeg) throw new Error('Bild-Encoding fehlgeschlagen')
  return { blob: jpeg, ext: 'jpg' }
}

/** Verarbeitet ein Originalbild zu sha256 + EXIF-Metadaten + Ableitungen. */
export async function processImageFile(file: File): Promise<ProcessedImage> {
  const originalBuf = await file.arrayBuffer()
  // Identität = SHA-256 des ORIGINALS (nicht der Ableitung), PRD F4.
  const sha256 = await sha256Hex(originalBuf)

  // EXIF vor einer allfälligen HEIC-Konvertierung lesen (exifr kann HEIC-EXIF).
  let lat: number | null = null
  let lon: number | null = null
  let taken_at: string | null = null
  try {
    // Kein `pick`: das würde auch die GPS-Tags wegfiltern, die `gps: true`
    // eigentlich liefern soll.
    const exif = (await exifr.parse(file, { gps: true })) as
      | { latitude?: number; longitude?: number; DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined
    if (exif) {
      if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
        lat = exif.latitude
        lon = exif.longitude
      }
      const dt = exif.DateTimeOriginal ?? exif.CreateDate
      if (dt instanceof Date && !Number.isNaN(dt.getTime())) taken_at = dt.toISOString()
    }
  } catch {
    // Bild ohne (lesbares) EXIF ist völlig ok.
  }

  let decodable: Blob = file
  if (isHeic(file)) {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    decodable = Array.isArray(converted) ? converted[0]! : converted
  }

  // imageOrientation: EXIF-Rotation direkt beim Decodieren anwenden.
  const bitmap = await createImageBitmap(decodable, { imageOrientation: 'from-image' })
  try {
    const display = await encodeScaled(bitmap, DISPLAY_MAX)
    const thumb = await encodeScaled(bitmap, THUMB_MAX)
    return {
      sha256,
      lat,
      lon,
      taken_at,
      displayBlob: display.blob,
      thumbBlob: thumb.blob,
      ext: display.ext,
    }
  } finally {
    bitmap.close()
  }
}
