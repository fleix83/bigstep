import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '@tourenbuch/shared/db'
import type { Env } from './env'

export function getDb(env: Env) {
  return drizzle(neon(env.DATABASE_URL), { schema })
}

export type Db = ReturnType<typeof getDb>
