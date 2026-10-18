import Vue from '@vitejs/plugin-vue'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [Vue()],
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts'],
  },
})
