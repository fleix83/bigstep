/**
 * Lokale Ablage der Bild-Ableitungen (v1, vor R2 – PLAN Phase 6.4):
 * - Tauri-App: App-Data-Ordner `images/` (plugin-fs), Anzeige via asset-Protokoll.
 * - Dev-Browser/PWA: OPFS (Origin Private File System), Anzeige via Blob-URLs.
 * Dateinamen: `${sha256}_display.{webp|jpg}` bzw. `_thumb` – Format je nach
 * Encoder (siehe image-pipeline.ts). Kein Bytea in Postgres.
 */

export interface DerivativeUrls {
  display: string
  thumb: string
}

const isTauri = () => '__TAURI_INTERNALS__' in window

// Blob-URLs pro sha cachen, sonst entstehen bei jedem Render neue Objekt-URLs.
const urlCache = new Map<string, DerivativeUrls>()

// --- Tauri-Backend -----------------------------------------------------------

async function tauriSave(name: string, blob: Blob): Promise<void> {
  const { mkdir, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  await mkdir('images', { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
  await writeFile(`images/${name}`, new Uint8Array(await blob.arrayBuffer()), {
    baseDir: BaseDirectory.AppData,
  })
}

async function tauriFind(sha: string): Promise<DerivativeUrls | null> {
  const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  for (const ext of ['webp', 'jpg'] as const) {
    if (await exists(`images/${sha}_display.${ext}`, { baseDir: BaseDirectory.AppData })) {
      const base = await appDataDir()
      return {
        display: convertFileSrc(await join(base, 'images', `${sha}_display.${ext}`)),
        thumb: convertFileSrc(await join(base, 'images', `${sha}_thumb.${ext}`)),
      }
    }
  }
  return null
}

async function tauriRemove(sha: string): Promise<void> {
  const { exists, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  for (const ext of ['webp', 'jpg'] as const) {
    for (const kind of ['display', 'thumb'] as const) {
      const p = `images/${sha}_${kind}.${ext}`
      if (await exists(p, { baseDir: BaseDirectory.AppData })) {
        await remove(p, { baseDir: BaseDirectory.AppData }).catch(() => {})
      }
    }
  }
}

// --- OPFS-Backend ------------------------------------------------------------

async function opfsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('images', { create: true })
}

async function opfsSave(name: string, blob: Blob): Promise<void> {
  const dir = await opfsDir()
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

async function opfsFile(name: string): Promise<File | null> {
  try {
    const dir = await opfsDir()
    const handle = await dir.getFileHandle(name)
    return await handle.getFile()
  } catch {
    return null
  }
}

async function opfsFind(sha: string): Promise<DerivativeUrls | null> {
  for (const ext of ['webp', 'jpg'] as const) {
    const display = await opfsFile(`${sha}_display.${ext}`)
    if (display) {
      const thumb = await opfsFile(`${sha}_thumb.${ext}`)
      return {
        display: URL.createObjectURL(display),
        thumb: thumb ? URL.createObjectURL(thumb) : URL.createObjectURL(display),
      }
    }
  }
  return null
}

async function opfsRemove(sha: string): Promise<void> {
  const dir = await opfsDir()
  for (const ext of ['webp', 'jpg'] as const) {
    for (const kind of ['display', 'thumb'] as const) {
      await dir.removeEntry(`${sha}_${kind}.${ext}`).catch(() => {})
    }
  }
}

// --- Öffentliche API ---------------------------------------------------------

export async function saveDerivatives(
  sha: string,
  ext: 'webp' | 'jpg',
  displayBlob: Blob,
  thumbBlob: Blob
): Promise<void> {
  const save = isTauri() ? tauriSave : opfsSave
  await save(`${sha}_display.${ext}`, displayBlob)
  await save(`${sha}_thumb.${ext}`, thumbBlob)
  urlCache.delete(sha)
}

/** null ⇒ Ableitungen fehlen lokal (z. B. anderes Gerät; R2-Sync ist Phase 8). */
export async function findDerivatives(sha: string): Promise<DerivativeUrls | null> {
  const cached = urlCache.get(sha)
  if (cached) return cached
  const urls = await (isTauri() ? tauriFind(sha) : opfsFind(sha))
  if (urls) urlCache.set(sha, urls)
  return urls
}

export async function removeDerivatives(sha: string): Promise<void> {
  urlCache.delete(sha)
  await (isTauri() ? tauriRemove(sha) : opfsRemove(sha))
}

/** true, wenn die Ableitungen bereits lokal existieren (Duplikat-Import). */
export async function hasDerivatives(sha: string): Promise<boolean> {
  return (await findDerivatives(sha)) !== null
}

// --- R2-Sync (Phase 8) -------------------------------------------------------

export interface DerivativeBlobs {
  display: Blob
  thumb: Blob
}

const extContentType = { webp: 'image/webp', jpg: 'image/jpeg' } as const

/** Lokale Ableitungen als Blobs (für den Upload nach R2); null wenn nicht da. */
export async function getDerivativeBlobs(sha: string): Promise<DerivativeBlobs | null> {
  if (isTauri()) {
    const { exists, readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    for (const ext of ['webp', 'jpg'] as const) {
      if (await exists(`images/${sha}_display.${ext}`, { baseDir: BaseDirectory.AppData })) {
        const type = extContentType[ext]
        const [display, thumb] = await Promise.all([
          readFile(`images/${sha}_display.${ext}`, { baseDir: BaseDirectory.AppData }),
          readFile(`images/${sha}_thumb.${ext}`, { baseDir: BaseDirectory.AppData }),
        ])
        return {
          display: new Blob([display as BlobPart], { type }),
          thumb: new Blob([thumb as BlobPart], { type }),
        }
      }
    }
    return null
  }
  for (const ext of ['webp', 'jpg'] as const) {
    const display = await opfsFile(`${sha}_display.${ext}`)
    if (display) {
      const thumb = await opfsFile(`${sha}_thumb.${ext}`)
      if (!thumb) return null
      return { display, thumb }
    }
  }
  return null
}

interface RemoteImageRef {
  sha256: string
  upload_state: string
}

interface RemoteFetcher {
  fetchImageVariant(sha256: string, variant: 'display' | 'thumb'): Promise<Blob>
}

/**
 * Anzeige-URLs für ein Bild: zuerst lokale Ableitungen, sonst — wenn das Bild
 * bereits in R2 liegt — über die authentifizierte GET-Route laden (PWA bzw.
 * Zweitgerät). Geladene Remote-Blobs landen im selben URL-Cache.
 */
export async function resolveImageUrls(
  image: RemoteImageRef,
  api: RemoteFetcher
): Promise<DerivativeUrls | null> {
  const local = await findDerivatives(image.sha256)
  if (local) return local
  if (image.upload_state !== 'uploaded') return null
  const cached = urlCache.get(image.sha256)
  if (cached) return cached
  try {
    const [display, thumb] = await Promise.all([
      api.fetchImageVariant(image.sha256, 'display'),
      api.fetchImageVariant(image.sha256, 'thumb'),
    ])
    const urls = {
      display: URL.createObjectURL(display),
      thumb: URL.createObjectURL(thumb),
    }
    urlCache.set(image.sha256, urls)
    return urls
  } catch {
    return null
  }
}
