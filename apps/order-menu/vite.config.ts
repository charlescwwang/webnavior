import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'

import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [Vue()],
  server: {
    port: 5174,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
})
