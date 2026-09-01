import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiClient } from '@tourenbuch/shared'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { createAuth, makeTokenProvider, type SessionUser } from './auth'
import { SettingsDialog } from '../components/SettingsDialog'
import { LoginScreen } from '../components/LoginScreen'

interface ApiContextValue {
  client: ApiClient
  config: AppConfig
  updateConfig: (c: AppConfig) => void
  user: SessionUser
  signOut: () => Promise<void>
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

export function useAuthInfo() {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useAuthInfo ausserhalb von ApiProvider')
  return { user: ctx.user, signOut: ctx.signOut }
}

/**
 * Stufe 1: API-URL vorhanden? Sonst Settings-Dialog.
 * Stufe 2: Neon-Auth-Session vorhanden? Sonst Login/Registrierung.
 * Erst danach rendert die App; der ApiClient holt sich pro Request ein
 * frisches Neon-Auth-JWT über den Token-Provider.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(() => loadConfig())
  const [showSettings, setShowSettings] = useState(false)

  const updateConfig = (c: AppConfig) => {
    saveConfig(c)
    setConfig(c)
    setShowSettings(false)
  }

  if (!config || showSettings) {
    return <SettingsDialog initial={config} onSave={updateConfig} />
  }

  return (
    <AuthGate
      config={config}
      updateConfig={updateConfig}
      onOpenSettings={() => setShowSettings(true)}
    >
      {children}
    </AuthGate>
  )
}

function AuthGate({
  config,
  updateConfig,
  onOpenSettings,
  children,
}: {
  config: AppConfig
  updateConfig: (c: AppConfig) => void
  onOpenSettings: () => void
  children: ReactNode
}) {
  const auth = useMemo(() => createAuth(config.apiUrl), [config.apiUrl])
  const [user, setUser] = useState<SessionUser | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    setChecking(true)
    void auth
      .getSession()
      .then((result) => {
        if (!alive) return
        const u = result.data?.user
        setUser(u ? { id: u.id, email: u.email, name: u.name } : null)
      })
      .catch(() => alive && setUser(null))
      .finally(() => alive && setChecking(false))
    return () => {
      alive = false
    }
  }, [auth])

  const value = useMemo<ApiContextValue | null>(() => {
    if (!user) return null
    return {
      client: new ApiClient({
        baseUrl: config.apiUrl,
        token: makeTokenProvider(config.apiUrl),
      }),
      config,
      updateConfig,
      user,
      signOut: async () => {
        await auth.signOut().catch(() => {})
        setUser(null)
      },
    }
    // updateConfig ist stabil genug (setState-Wrapper); config/user/auth treiben den Wert.
  }, [user, auth, config, updateConfig])

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Anmeldung wird geprüft …
      </div>
    )
  }

  if (!value) {
    return (
      <LoginScreen
        auth={auth}
        onSignedIn={setUser}
        onOpenSettings={onOpenSettings}
      />
    )
  }

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}
