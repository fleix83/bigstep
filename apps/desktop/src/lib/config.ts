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
  const apiUrl =
    localStorage.getItem(URL_KEY) ?? (import.meta.env.VITE_API_URL as string | undefined) ?? ''
  const token =
    localStorage.getItem(TOKEN_KEY) ?? (import.meta.env.VITE_API_TOKEN as string | undefined) ?? ''
  if (!apiUrl || !token) return null
  return { apiUrl: apiUrl.replace(/\/$/, ''), token }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(URL_KEY, config.apiUrl.replace(/\/$/, ''))
  localStorage.setItem(TOKEN_KEY, config.token)
}
