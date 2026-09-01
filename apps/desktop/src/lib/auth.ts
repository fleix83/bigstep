import { createAuthClient, type VanillaBetterAuthClient } from '@neondatabase/neon-js/auth'
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js'

/**
 * Neon Auth (Managed Better Auth) über den Worker-Proxy /neon-auth — damit
 * sind die Session-Cookies first-party (wichtig für Safari/iOS-PWA) und
 * Client wie API teilen sich eine Basis-URL. Im Vite-Dev (1420 → 8787) ist
 * der Proxy cross-origin, darum credentials: 'include'.
 */
export type AuthClient = VanillaBetterAuthClient

export function createAuth(apiUrl: string): AuthClient {
  // credentials: 'include' explizit — im Cross-Origin-Dev (Vite 1420 →
  // Worker 8787) gehen die Session-Cookies sonst verloren. Der Cast engt
  // nur die Rückgabe-Union (Vanilla | React | Supabase) ein.
  return createAuthClient(`${apiUrl}/neon-auth`, {
    adapter: BetterAuthVanillaAdapter({
      fetchOptions: { credentials: 'include' },
    }),
  }) as AuthClient
}

export interface SessionUser {
  id: string
  email: string
  name: string
}

/**
 * Liefert ein gültiges API-JWT (15-min-Laufzeit laut Neon-Doku); cached bis
 * kurz vor Ablauf und holt dann über den JWT-Plugin-Endpoint /token ein
 * frisches (direkt per fetch — robuster als die SDK-Methode der Beta).
 */
export function makeTokenProvider(apiUrl: string): () => Promise<string> {
  let cached = ''
  let expiresAt = 0
  return async () => {
    if (cached && Date.now() < expiresAt - 60_000) return cached
    const res = await fetch(`${apiUrl}/neon-auth/token`, { credentials: 'include' })
    const data = res.ok ? ((await res.json()) as { token?: string }) : null
    if (!data?.token) {
      throw new Error('Kein Login-Token – bitte neu anmelden')
    }
    cached = data.token
    try {
      const payload = JSON.parse(atob(cached.split('.')[1] ?? '')) as { exp?: number }
      expiresAt = (payload.exp ?? 0) * 1000
    } catch {
      expiresAt = Date.now() + 10 * 60_000
    }
    return cached
  }
}
