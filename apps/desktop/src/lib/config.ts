const URL_KEY = 'tourenbuch.apiUrl'
const TOKEN_KEY = 'tourenbuch.apiToken'

export interface AppConfig {
  apiUrl: string
  token: string
}

/**
 * API-Konfiguration: localStorage (Settings-Dialog) hat Vorrang,
 * sonst Vite-Env (VITE_API_URL / VITE_API_TOKEN aus apps/desktop/.env).
 */
export function loadConfig(): AppConfig | null {
  // `||` statt `??`: leere Strings (z. B. aus .env.production) zählen als
  // «nicht gesetzt», damit der Origin-Fallback greift.
  const apiUrl =
    localStorage.getItem(URL_KEY) ||
    ((import.meta.env.VITE_API_URL as string | undefined) || '') ||
    defaultApiUrl()
  const token =
    localStorage.getItem(TOKEN_KEY) ||
    ((import.meta.env.VITE_API_TOKEN as string | undefined) || '')
  if (!apiUrl || !token) return null
  return { apiUrl: apiUrl.replace(/\/$/, ''), token }
}

/**
 * PWA-Fall: Die App wird vom selben Worker ausgeliefert wie die API
 * (Phase 7) – dann ist die eigene Origin der richtige API-Default und es
 * muss nur noch der Token eingegeben werden.
 */
export function defaultApiUrl(): string {
  return /^https?:$/.test(window.location.protocol) ? window.location.origin : ''
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(URL_KEY, config.apiUrl.replace(/\/$/, ''))
  localStorage.setItem(TOKEN_KEY, config.token)
}
