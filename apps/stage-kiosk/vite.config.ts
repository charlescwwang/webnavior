import { join, resolve } from 'node:path'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'
import Layouts from 'vite-plugin-vue-layouts'
import VueRouter from 'vue-router/vite'

import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/kiosk/',
  optimizeDeps: {
    exclude: [
      // stage-ui's provider registry can reference DuckDB settings helpers,
      // but the kiosk does not load them. Vite's optimizer cannot resolve the
      // package's browser worker URL imports, so preserve the stage-web rule.
      '@proj-airi/drizzle-duckdb-wasm',
      '@proj-airi/drizzle-duckdb-wasm/*',
    ],
  },
  resolve: {
    alias: {
      '@proj-airi/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
      '@proj-airi/stage-layouts': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src')),
      '@proj-airi/stage-pages': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src')),
      '@proj-airi/stage-ui': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src')),
    },
  },
  server: {
    // The customer-facing Kiosk is a distinct process from the management UI
    // (:5167) and the standalone menu service (:5168).
    port: 5169,
    strictPort: true,
    fs: { strict: false },
    allowedHosts: true,
  },
  plugins: [
    Info(),
    Yaml(),
    Vue({ ...templateCompilerOptions }),
    VueRouter({
      dts: resolve(import.meta.dirname, 'src', 'typed-router.d.ts'),
      routesFolder: [
        resolve(import.meta.dirname, 'src', 'pages'),
        {
          src: resolve(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src', 'pages'),
          exclude: base => [
            ...base,
            '**/settings/account/index.vue',
          ],
        },
      ],
      exclude: ['**/components/**'],
    }),
    Layouts({
      layoutsDirs: [resolve(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src', 'layouts')],
    }),
    Unocss(),
    VueI18n({ runtimeOnly: true, compositionOnly: true, fullInstall: true }),
    DownloadLive2DSDK(),
  ],
})
