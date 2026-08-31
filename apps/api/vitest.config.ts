import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// TEST_DATABASE_URL (Neon-Branch "test") kommt aus der Root-.env.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
