import { request } from 'node:http'

import { createServer } from 'vite'
import { expect, it } from 'vitest'

import { fixturePlugin } from './fixtureServer.js'

// Report: this chat, 2026-11-17 — other computers must be able to use the PB simulator.
it('accepts the configured LAN origin while keeping foreign hosts and writes isolated', async () => {
  const origin = 'http://192.168.8.52:5188'
  const server = await createServer({ configFile: false, root: new URL('.', import.meta.url).pathname, plugins: [fixturePlugin({ origin })], optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 5199, ws: false } })
  await server.listen()
  try {
    const address = server.httpServer.address()
    const target = `http://127.0.0.1:${address.port}/__lab/state`
    const send = options => new Promise((resolve, reject) => {
      const req = request(target, options, (response) => {
        let body = ''
        response.on('data', (part) => {
          body += part
        })
        response.on('end', () => resolve({ status: response.statusCode, body }))
      })
      req.on('error', reject)
      req.end(options.method === 'PUT' ? '{}' : undefined)
    })
    const initial = await send({ headers: { Host: new URL(origin).host } })
    expect(initial.status).toBe(200)
    expect(JSON.parse(initial.body).state).toBeNull()
    const foreignHost = await send({ headers: { Host: '192.168.8.99:5188' } })
    expect(foreignHost.status).toBe(403)
    const foreignWrite = await send({ method: 'PUT', headers: { Host: new URL(origin).host, Origin: 'http://192.168.8.99:5188' } })
    expect(foreignWrite.status).toBe(403)
    const sameOriginWrite = await send({ method: 'PUT', headers: { Host: new URL(origin).host, Origin: origin } })
    expect(sameOriginWrite.status).toBe(409)
  }
  finally { await server.close() }
})
