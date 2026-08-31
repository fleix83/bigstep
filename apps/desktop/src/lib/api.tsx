import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ApiClient } from '@tourenbuch/shared'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { SettingsDialog } from '../components/SettingsDialog'

interface ApiContextValue {
  client: ApiClient
  config: AppConfig
  updateConfig: (c: AppConfig) => void
}

const ApiContext = createContext<ApiContextValue | null>(null)

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApi ausserhalb von ApiProvider')
  return ctx.client
}

export function useApiConfig() {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApiConfig ausserhalb von ApiProvider')
  return { config: ctx.config, updateConfig: ctx.updateConfig }
}

/** Rendert die App erst, wenn API-URL + Token vorhanden sind; sonst Settings-Dialog. */
export function ApiProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(() => loadConfig())

  const value = useMemo<ApiContextValue | null>(() => {
    if (!config) return null
    return {
      client: new ApiClient({ baseUrl: config.apiUrl, token: config.token }),
      config,
      updateConfig: (c: AppConfig) => {
        saveConfig(c)
        setConfig(c)
      },
    }
  }, [config])

  if (!value) {
    return (
      <SettingsDialog
        initial={config}
        onSave={(c) => {
          saveConfig(c)
          setConfig(c)
        }}
      />
    )
  }

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}
