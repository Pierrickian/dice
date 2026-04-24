import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})