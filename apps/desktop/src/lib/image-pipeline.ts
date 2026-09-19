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
  /** 2560-px-Ableitung (längste Kante). */
  displayBlob: Blob
  /** 300-px-Ableitung. */
  thumbBlob: Blob
  /** Tatsächliches Ableitungsformat: 'webp' oder 'jpg' (WKWebView-Fallback). */
  ext: 'webp' | 'jpg'
}

const DISPLAY_MAX = 2560
const THUMB_MAX = 300

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

async function encodeOnce(
  bitmap: ImageBitmap,
  maxDim: number
): Promise<{ blob: Blob; ext: 'webp' | 'jpg' } | null> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9)
  )
  // Canvas sofort freigeben (mobile Browser haben enge Canvas-Speicherlimits).
  const done = () => {
    canvas.width = 0
    canvas.height = 0
  }
  if (blob && blob.type === 'image/webp') {
    done()
    return { blob, ext: 'webp' }
  }
  // WKWebView liefert kein WebP → JPEG-Fallback.
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9)
  )
  done()
  return jpeg ? { blob: jpeg, ext: 'jpg' } : null
}

/**
 * Ableitung erzeugen; schlägt das Encoding bei der Zielgrösse fehl (z. B.
 * Canvas-/Speicherlimit auf Mobilgeräten), wird stufenweise kleiner encodiert.
 */
async function encodeScaled(
  bitmap: ImageBitmap,
  maxDim: number
): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const steps = [maxDim, ...[2000, 1600, 1200].filter((d) => d < maxDim)]
  for (const dim of steps) {
    try {
      const r = await encodeOnce(bitmap, dim)
      if (r) return r
      console.warn(`[image-pipeline] Encoding bei ${dim}px fehlgeschlagen, versuche kleiner`)
    } catch (err) {
      console.warn(`[image-pipeline] Encoding bei ${dim}px: `, err)
    }
  }
  throw new Error('Bild-Encoding fehlgeschlagen (Canvas/Speicher)')
}

function isPlausibleCoord(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max
}

/**
 * GPS-Rohtag ([Grad, Minuten, Sekunden] oder bereits Dezimal) + Ref ('N'/'S'/'E'/'W')
 * → Dezimalgrad; undefined, wenn nichts Verwertbares drin ist.
 */
function dmsToDecimal(raw: unknown, ref: unknown): number | undefined {
  let value: number | undefined
  if (typeof raw === 'number') value = raw
  else if (Array.isArray(raw)) {
    const parts = raw.map((p) => (typeof p === 'number' ? p : Number(p)))
    if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return undefined
    const [d = 0, m = 0, s = 0] = parts
    value = d + m / 60 + s / 3600
  }
  if (value === undefined || !Number.isFinite(value)) return undefined
  const r = typeof ref === 'string' ? ref.trim().toUpperCase() : ''
  return r === 'S' || r === 'W' ? -Math.abs(value) : value
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
      | {
          latitude?: number
          longitude?: number
          GPSLatitude?: unknown
          GPSLatitudeRef?: unknown
          GPSLongitude?: unknown
          GPSLongitudeRef?: unknown
          DateTimeOriginal?: Date
          CreateDate?: Date
        }
      | undefined
    if (exif) {
      // 1) exifr-berechnete Dezimalkoordinaten; 2) Fallback aus den rohen
      // Grad/Minuten/Sekunden-Tags (exifr liefert bei teilweise defekten Tags NaN).
      let la = exif.latitude
      let lo = exif.longitude
      if (!isPlausibleCoord(la, 90) || !isPlausibleCoord(lo, 180)) {
        la = dmsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef)
        lo = dmsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef)
      }
      if (isPlausibleCoord(la, 90) && isPlausibleCoord(lo, 180) && !(la === 0 && lo === 0)) {
        lat = la!
        lon = lo!
      } else if (exif.GPSLatitude !== undefined || exif.latitude !== undefined) {
        console.warn('[image-pipeline] GPS-Tags vorhanden, aber nicht verwertbar:', {
          latitude: exif.latitude,
          longitude: exif.longitude,
          GPSLatitude: exif.GPSLatitude,
          GPSLongitude: exif.GPSLongitude,
        })
      }
      const dt = exif.DateTimeOriginal ?? exif.CreateDate
      if (dt instanceof Date && !Number.isNaN(dt.getTime())) taken_at = dt.toISOString()
    }
  } catch {
    // Bild ohne (lesbares) EXIF ist völlig ok.
  }

  const bitmap = await decodeToBitmap(file)
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

/**
 * Decodieren mit EXIF-Rotation. Reihenfolge:
 * 1. createImageBitmap direkt (Safari kann HEIC nativ — heic2any ist dort
 *    unnötig und speicherhungrig).
 * 2. HEIC → heic2any (libheif-wasm) → JPEG → createImageBitmap.
 * 3. Fallback über ein <img>-Element (Safari wendet die EXIF-Orientierung
 *    dort selbst an), falls createImageBitmap den Blob ablehnt.
 */
async function decodeToBitmap(file: File): Promise<ImageBitmap> {
  const errors: unknown[] = []
  const tryBitmap = async (blob: Blob): Promise<ImageBitmap | null> => {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch (err) {
      errors.push(err)
      return null
    }
  }

  const direct = await tryBitmap(file)
  if (direct) return direct

  if (isHeic(file)) {
    try {
      const { default: heic2any } = await import('heic2any')
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      const jpeg = Array.isArray(converted) ? converted[0]! : converted
      const viaHeic = await tryBitmap(jpeg)
      if (viaHeic) return viaHeic
      const viaImg = await bitmapViaImageElement(jpeg)
      if (viaImg) return viaImg
    } catch (err) {
      errors.push(err)
    }
  } else {
    const viaImg = await bitmapViaImageElement(file)
    if (viaImg) return viaImg
  }

  const last = errors[errors.length - 1]
  throw new Error(
    `Bild konnte nicht dekodiert werden (${file.type || 'unbekannter Typ'}, ${Math.round(
      file.size / 1024
    )} KB): ${last instanceof Error ? last.message : String(last ?? 'unbekannt')}`,
    { cause: last }
  )
}

/** Decodieren über <img>; das Element liefert bereits ausgerichtete Pixel. */
async function bitmapViaImageElement(blob: Blob): Promise<ImageBitmap | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('img.onerror'))
      img.src = url
    })
    if (typeof img.decode === 'function') await img.decode().catch(() => {})
    if (!img.naturalWidth || !img.naturalHeight) return null
    // Kein imageOrientation hier: das <img> ist schon gedreht, sonst doppelt.
    return await createImageBitmap(img)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
