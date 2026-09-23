import process from 'node:process'

import { serve } from '@hono/node-server'

import { createPosBridgeApp } from '../app'
import { createHttpPosGateway } from '../gateway/http'
import { createPosSimulator } from '../simulator'

function portFromEnvironment(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback
}

const host = '127.0.0.1'
const bridgePort = portFromEnvironment('ORDER_MENU_SERVER_PORT', 5170)
const simulatorPort = portFromEnvironment('ORDER_MENU_POS_SIMULATOR_PORT', 5171)
const simulator = createPosSimulator()
const simulatorServer = serve({ fetch: simulator.app.fetch, hostname: host, port: simulatorPort })
const bridge = createPosBridgeApp({
  allowedOrigin: process.env.ORDER_MENU_ALLOWED_ORIGIN ?? 'http://localhost:5166',
  gateway: createHttpPosGateway({
    baseUrl: process.env.ORDER_MENU_POS_UPSTREAM_URL ?? `http://${host}:${simulatorPort}`,
    timeoutMs: portFromEnvironment('ORDER_MENU_POS_TIMEOUT_MS', 3_000),
  }),
})
const bridgeServer = serve({ fetch: bridge.fetch, hostname: host, port: bridgePort })

process.stdout.write(`POS simulator: http://${host}:${simulatorPort}\n`)
process.stdout.write(`POS Bridge: http://${host}:${bridgePort}\n`)

function close() {
  simulatorServer.close()
  bridgeServer.close()
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
