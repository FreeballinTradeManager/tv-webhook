import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../app/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Local dev points at LIVE Railway API by default so we see real data
      // without needing to boot the backend locally. To use a local backend,
      // set VITE_API_URL=http://localhost:8000 and restart Vite.
      '/api': {
        target: process.env.VITE_API_URL || 'https://tv-webhook-production-218f.up.railway.app',
        changeOrigin: true,
        secure: true,
      },
      '/ws': {
        target: (process.env.VITE_API_URL || 'https://tv-webhook-production-218f.up.railway.app').replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
