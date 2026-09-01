import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose'
import type { Env } from './env'
import { ApiError } from './errors'

// JWKS pro Isolate cachen; createRemoteJWKSet cached und rotiert selbst nach.
let cachedJwks: JWTVerifyGetKey | null = null
let cachedFor = ''

function jwksFor(env: Env): JWTVerifyGetKey {
  const key = env.TEST_JWKS ?? env.NEON_AUTH_URL
  if (cachedJwks && cachedFor === key) return cachedJwks
  cachedJwks = env.TEST_JWKS
    ? createLocalJWKSet(JSON.parse(env.TEST_JWKS))
    : createRemoteJWKSet(new URL(`${env.NEON_AUTH_URL}/.well-known/jwks.json`))
  cachedFor = key
  return cachedJwks
}

/**
 * Verifiziert ein Neon-Auth-JWT (Managed Better Auth, EdDSA/Ed25519) gegen
 * das JWKS und liefert die User-ID (`sub`). Issuer und Audience sind laut
 * Neon-Doku die Origin der Auth-URL.
 */
export async function verifyNeonAuthToken(env: Env, token: string): Promise<string> {
  const origin = new URL(env.NEON_AUTH_URL).origin
  try {
    const { payload } = await jwtVerify(token, jwksFor(env), {
      issuer: origin,
      audience: origin,
    })
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('sub fehlt')
    }
    return payload.sub
  } catch {
    throw new ApiError(401, 'unauthorized', 'Ungültiges oder abgelaufenes Login-Token')
  }
}
