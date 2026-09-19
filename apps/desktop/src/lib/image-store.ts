/**
 * Lokale Ablage der Bild-Ableitungen (v1, vor R2 – PLAN Phase 6.4):
 * - Tauri-App: App-Data-Ordner `images/` (plugin-fs), Anzeige via asset-Protokoll.
 * - Dev-Browser/PWA: OPFS (Origin Private File System), Anzeige via Blob-URLs.
 * - Safari < 26 (iPad/iPhone): OPFS ist lesbar, aber `createWritable()` fehlt
 *   → Schreiben (und Lesen des dort Geschriebenen) über IndexedDB.
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

// --- IndexedDB-Backend (Fallback für Browser ohne schreibbares OPFS) ---------

const IDB_NAME = 'tourenbuch-images'
const IDB_STORE = 'files'

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB nicht verfügbar'))
    req.onblocked = () => reject(new Error('IndexedDB blockiert'))
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'))
  })
}

async function idbSave(name: string, blob: Blob): Promise<void> {
  const db = await idbOpen()
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    // Blob direkt ablegen (MIME-Typ bleibt erhalten).
    await idbRequest(tx.objectStore(IDB_STORE).put(blob, name))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'))
    })
  } finally {
    db.close()
  }
}

async function idbFile(name: string): Promise<Blob | null> {
  try {
    const db = await idbOpen()
    try {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const v = await idbRequest<unknown>(tx.objectStore(IDB_STORE).get(name))
      return v instanceof Blob ? v : null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

async function idbRemove(name: string): Promise<void> {
  try {
    const db = await idbOpen()
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      await idbRequest(tx.objectStore(IDB_STORE).delete(name))
    } finally {
      db.close()
    }
  } catch {
    // ignorieren
  }
}

// --- OPFS-Backend ------------------------------------------------------------

/**
 * OPFS ist nur nutzbar, wenn wir auch schreiben können. Safari bis 25 hat
 * `getDirectory()`, aber kein `createWritable()` auf Datei-Handles (nur den
 * Sync-Access-Handle im Worker) — dort fällt der Browser-Store auf IndexedDB.
 */
const opfsWritable: boolean =
  typeof navigator !== 'undefined' &&
  typeof navigator.storage?.getDirectory === 'function' &&
  typeof FileSystemFileHandle !== 'undefined' &&
  'createWritable' in FileSystemFileHandle.prototype

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

async function opfsRemove(sha: string): Promise<void> {
  const dir = await opfsDir().catch(() => null)
  if (!dir) return
  for (const ext of ['webp', 'jpg'] as const) {
    for (const kind of ['display', 'thumb'] as const) {
      await dir.removeEntry(`${sha}_${kind}.${ext}`).catch(() => {})
    }
  }
}

// --- Öffentliche API ---------------------------------------------------------

// --- Browser-Store: OPFS wenn schreibbar, sonst IndexedDB --------------------

async function browserSave(name: string, blob: Blob): Promise<void> {
  if (opfsWritable) {
    try {
      await opfsSave(name, blob)
      return
    } catch (err) {
      console.warn('[image-store] OPFS-Schreiben fehlgeschlagen, weiche auf IndexedDB aus:', err)
    }
  }
  await idbSave(name, blob)
}

/** Datei aus dem Browser-Store: OPFS (falls vorhanden) zuerst, dann IndexedDB. */
async function browserFile(name: string): Promise<Blob | null> {
  if (typeof navigator.storage?.getDirectory === 'function') {
    const f = await opfsFile(name)
    if (f) return f
  }
  return idbFile(name)
}

async function browserFind(sha: string): Promise<DerivativeUrls | null> {
  for (const ext of ['webp', 'jpg'] as const) {
    const display = await browserFile(`${sha}_display.${ext}`)
    if (display) {
      const thumb = await browserFile(`${sha}_thumb.${ext}`)
      return {
        display: URL.createObjectURL(display),
        thumb: thumb ? URL.createObjectURL(thumb) : URL.createObjectURL(display),
      }
    }
  }
  return null
}

async function browserRemove(sha: string): Promise<void> {
  if (typeof navigator.storage?.getDirectory === 'function') {
    await opfsRemove(sha).catch(() => {})
  }
  for (const ext of ['webp', 'jpg'] as const) {
    for (const kind of ['display', 'thumb'] as const) {
      await idbRemove(`${sha}_${kind}.${ext}`)
    }
  }
}

export async function saveDerivatives(
  sha: string,
  ext: 'webp' | 'jpg',
  displayBlob: Blob,
  thumbBlob: Blob
): Promise<void> {
  const save = isTauri() ? tauriSave : browserSave
  await save(`${sha}_display.${ext}`, displayBlob)
  await save(`${sha}_thumb.${ext}`, thumbBlob)
  urlCache.delete(sha)
}

/** null ⇒ Ableitungen fehlen lokal (z. B. anderes Gerät; R2-Sync ist Phase 8). */
export async function findDerivatives(sha: string): Promise<DerivativeUrls | null> {
  const cached = urlCache.get(sha)
  if (cached) return cached
  const urls = await (isTauri() ? tauriFind(sha) : browserFind(sha))
  if (urls) urlCache.set(sha, urls)
  return urls
}

export async function removeDerivatives(sha: string): Promise<void> {
  urlCache.delete(sha)
  await (isTauri() ? tauriRemove(sha) : browserRemove(sha))
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
    const display = await browserFile(`${sha}_display.${ext}`)
    if (display) {
      const thumb = await browserFile(`${sha}_thumb.${ext}`)
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
