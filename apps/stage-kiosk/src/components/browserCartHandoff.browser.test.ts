import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, readonly, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import en from '../../../../packages/i18n/src/locales/en/stage.yaml'
import BrowserCartHandoff from './browserCartHandoff.vue'

import { createBrowserCartSession } from '../services/browserCartSession'

function setup() {
  const records = new Map<string, string>()
  const gate = createBrowserCartSession({ getItem: key => records.get(key) ?? null, setItem: (key, value) => {
    records.set(key, value)
  } })
  const raw = { cart: { version: 'cart', subtotal: 10, lines: [{ ref: 'line', name: 'Reviewed meal', quantity: 1, unitPrice: 10 }] } }
  const state = { raw, canRetry: true }
  const context: ServiceTool = { name: 'browser_cart_get', origin: 'https://app.esgpb.com', description: '', inputSchema: { type: 'object' } }
  const recovery = { ...context, name: 'browser_recovery_context' }
  const bridge = { tools: readonly(shallowRef([context, recovery])), getDocumentId: () => 'document', execute: vi.fn(async (tool: ServiceTool) => tool.name === context.name ? state.raw : { canRetry: state.canRetry }) }
  const authorized = shallowRef(true)
  const onResumed = vi.fn()
  const serviceUrl = 'https://app.esgpb.com/order/store/test/pick_up/menu'
  const screen = render(defineComponent({ setup: () => () => h(BrowserCartHandoff, { bridge, gate, authorized: authorized.value, owner: 'new', serviceUrl, operationPending: false, onResumed }) }), { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { stage: en } } })] } })
  return { state, gate, bridge, authorized, onResumed, serviceUrl, screen }
}

it('requires visible staff review and explicit confirmation before resuming the same cart', async () => {
  const { screen, gate, serviceUrl, onResumed } = setup()
  await screen.getByRole('button', { name: 'Review current cart', exact: true }).click()
  await expect.element(screen.getByText('Reviewed meal', { exact: false })).toBeVisible()
  const resume = screen.getByRole('button', { name: 'Resume this reviewed cart', exact: true })
  await expect.element(resume).toBeDisabled()
  await screen.getByRole('switch').click()
  await resume.click()
  await expect.poll(() => onResumed.mock.calls.length).toBe(1)
  expect(gate.owns('new', serviceUrl)).toBe(true)
})

it.each(['changed', 'unknown'])('refuses stale or uncertain review (%s), keeping ownership unchanged', async (failure) => {
  const { screen, state, gate, serviceUrl, onResumed } = setup()
  await screen.getByRole('button', { name: 'Review current cart', exact: true }).click()
  await screen.getByRole('switch').click()
  if (failure === 'changed')
    state.raw.cart.version = 'changed'
  else
    state.canRetry = false
  await screen.getByRole('button', { name: 'Resume this reviewed cart', exact: true }).click()
  await expect.element(screen.getByRole('alert')).toBeVisible()
  expect(gate.owns('new', serviceUrl)).toBe(false)
  expect(onResumed).not.toHaveBeenCalled()
})

it('hides prior cart details and revokes review when local staff authorization ends', async () => {
  const { screen, authorized, bridge } = setup()
  await screen.getByRole('button', { name: 'Review current cart', exact: true }).click()
  await expect.element(screen.getByText('Reviewed meal', { exact: false })).toBeVisible()
  authorized.value = false
  await expect.element(screen.getByText('Reviewed meal', { exact: false })).not.toBeInTheDocument()
  expect(bridge.execute).toHaveBeenCalledOnce()
})
