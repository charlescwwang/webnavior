import { join, resolve } from 'node:path'
import { env } from 'node:process'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'
import Layouts from 'vite-plugin-vue-layouts'
import VueRouter from 'vue-router/vite'

import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
  // A clean release checkout has no ignored .env.production.local. Public builds
  // must explicitly inherit the existing PIN rather than silently lock operators out.
  // Process environment takes precedence over Vite's mode-specific env files.
  const settings = { ...loadEnv(mode, import.meta.dirname, 'VITE_'), ...env }
  if (command === 'build' && settings.VITE_API_SERVER_URL) {
    const hostname = new URL(settings.VITE_API_SERVER_URL).hostname
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) && !settings.VITE_KIOSK_ADMIN_PIN?.trim())
      throw new Error('Public Kiosk builds require the existing VITE_KIOSK_ADMIN_PIN. Inherit the deployment environment before building.')
  }
  return {
    base: '/kiosk/',
    // Webnavior records ordering interactions through its own API, not AIRI cloud credits/chat sync.
    define: { 'import.meta.env.VITE_AIRI_CLOUD_ENABLED': JSON.stringify('false') },
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
  }
})
