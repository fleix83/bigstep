const URL_KEY = 'tourenbuch.apiUrl'
const LEGACY_TOKEN_KEY = 'tourenbuch.apiToken'

export interface AppConfig {
  apiUrl: string
}

/**
 * API-Basis-URL: localStorage (Settings-Dialog) → Vite-Env → eigene Origin
 * (PWA wird vom selben Worker ausgeliefert wie die API). Authentifizierung
 * läuft seit dem Neon-Auth-Umbau über Login-Session + JWT, nicht mehr über
 * einen statischen Token.
 */
export function loadConfig(): AppConfig | null {
  // Altlast aus der statischen-Token-Ära entfernen.
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  const apiUrl =
    localStorage.getItem(URL_KEY) ||
    ((import.meta.env.VITE_API_URL as string | undefined) || '') ||
    defaultApiUrl()
  if (!apiUrl) return null
  return { apiUrl: apiUrl.replace(/\/$/, '') }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(URL_KEY, config.apiUrl.replace(/\/$/, ''))
}

export function defaultApiUrl(): string {
  return /^https?:$/.test(window.location.protocol) ? window.location.origin : ''
}
