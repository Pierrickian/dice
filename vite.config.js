import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rollldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})