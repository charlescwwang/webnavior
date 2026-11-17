import process from 'node:process'

import { fixturePlugin } from './fixtureServer.js'

const origin = process.env.PB_LAB_ORIGIN ?? 'http://127.0.0.1:5188'
const url = new URL(origin)
if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
  throw new Error('PB_LAB_ORIGIN must be an exact HTTP(S) origin without a path.')
const base = process.env.PB_LAB_BASE ?? '/'
if (!['/', '/pb-test/'].includes(base))
  throw new Error('PB_LAB_BASE must be / or /pb-test/.')

export default {
  base,
  // The page CSP permits same-origin images; keep small SVGs as files too.
  build: { assetsInlineLimit: 0 },
  plugins: [fixturePlugin({ origin, base })],
  server: { host: process.env.PB_LAB_HOST ?? '127.0.0.1', port: 5188, strictPort: true },
  preview: { host: '127.0.0.1', port: 5198, strictPort: true, allowedHosts: [url.hostname] },
}
