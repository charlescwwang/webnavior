import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'

import { defineConfig } from 'vite'

/** Isolated static entry: no Kiosk router, enrollment, models, Session or API code. */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/audioCheck'),
  base: './',
  plugins: [Vue(), Unocss({ configFile: resolve(import.meta.dirname, '../../uno.config.ts') })],
  build: { outDir: resolve(import.meta.dirname, 'dist-audio-check'), emptyOutDir: true },
})
