import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/shared/src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Kommt aus .env (lokal) bzw. der Umgebung – nie hart codieren (PRD §7.4).
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
