import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'

import { defineConfig, loadEnv } from 'vite'

import { toolValidationPlugin } from './toolValidationPlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const embeddingOrigin = env.VITE_AIRI_ORIGIN ?? 'http://localhost:5169'

  return {
    plugins: [Vue(), toolValidationPlugin()],
    server: {
      allowedHosts: true,
      cors: { origin: embeddingOrigin },
      port: 5166,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
  }
})
