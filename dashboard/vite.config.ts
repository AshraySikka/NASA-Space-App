import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Allow the dashboard to import the shared corpus in ../datasets (repo root)
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
})
