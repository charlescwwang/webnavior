import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createServer } from 'vite'
import { expect, it } from 'vitest'

it('loads Cubism and the favicon under a single Kiosk base prefix', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  // Exercise Vite's real HTML rewrite without starting listeners or scanning the app.
  const server = await createServer({
    configFile: false,
    root,
    base: '/kiosk/',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  })

  try {
    const source = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
    const html = await server.transformIndexHtml('/kiosk/', source)
    expect(html).toContain('src="/kiosk/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js"')
    expect(html).toContain('href="/kiosk/favicon.ico"')
    expect(html).not.toContain('/kiosk/kiosk/')
  }
  finally {
    await server.close()
  }
})
