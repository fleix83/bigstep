/**
 * Speichert Text als Datei: in der Tauri-App über den nativen Save-Dialog,
 * im Browser (Dev/PWA) als Download. Gibt false zurück, wenn der Nutzer den
 * Dialog abgebrochen hat.
 */
export async function saveTextFile(
  suggestedName: string,
  content: string,
  mimeType = 'application/gpx+xml'
): Promise<boolean> {
  if ('__TAURI_INTERNALS__' in window) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'GPX', extensions: ['gpx'] }],
    })
    if (path === null) return false
    await writeTextFile(path, content)
    return true
  }

  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}
