import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    // 1420 statt Vite-Default 5173 – dort läuft lokal bereits eine andere App
    port: 1420,
    strictPort: true,
  },
})
