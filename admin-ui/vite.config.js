import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Dev: proxy API calls to the Express server
  server: {
    port: 5173,
    proxy: {
      '/admin/api': 'http://localhost:3000',
      '/auth':      'http://localhost:3000',
      '/v1':        'http://localhost:3000',
      '/forms':     'http://localhost:3000',
      '/intake':    'http://localhost:3000',
    },
  },
  // Build output goes into ../admin-ui/dist
  // Express serves this as /admin
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
