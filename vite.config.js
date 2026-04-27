import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        codeSplitting: true,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
