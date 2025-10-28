import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/static/',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: '../backend/static',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/frontend.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  },
})
