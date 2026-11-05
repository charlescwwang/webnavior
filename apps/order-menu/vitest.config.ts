import Vue from '@vitejs/plugin-vue'

import { defineConfig } from 'vitest/config'

import { toolValidationPlugin } from './toolValidationPlugin'

export default defineConfig({
  plugins: [Vue(), toolValidationPlugin()],
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts'],
  },
})
