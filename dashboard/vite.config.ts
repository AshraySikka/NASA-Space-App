import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/three') || id.includes('@react-three') || id.includes('postprocessing') ? 'three' : undefined) } },
  },
})
