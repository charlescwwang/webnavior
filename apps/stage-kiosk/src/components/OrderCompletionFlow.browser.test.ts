import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import CustomerSessionCompletion from '../../../../packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionCompletion.vue'

import { createScenarioRegistry } from '../services/scenario-registry'

// This integration uses only the loopback test Bridge and its payment simulator.
// Opt in with VITE_ORDER_MENU_COMPLETION_TEST=true and both menu URLs configured.
describe.runIf(import.meta.env.VITE_ORDER_MENU_COMPLETION_TEST === 'true')('paid order completion', () => {
  it.each([
    { invoice: 'carrier' },
    { invoice: 'donation' },
  ] as const)('shows both reward and table-binding QR after automatic payment with invoice $invoice', async ({ invoice }) => {
    const completed = shallowRef(false)
    const orderContinuationUrl = shallowRef<string>()
    const registry = createScenarioRegistry()
    registry.setServices([{
      id: 'restaurant-ordering',
      title: 'Test menu',
      description: 'Synthetic payment integration',
      enabled: true,
      serviceUrl: window.location.origin,
    }])
    const stop = registry.on('completed', (message) => {
      completed.value = true
      orderContinuationUrl.value = message.orderContinuationUrl
    })
    const entryUrl = new URL('../../../order-menu/src/main.ts', import.meta.url).href
    const screen = render(defineComponent({
      setup: () => () => h('div', [
        h('iframe', { title: 'Test menu', srcdoc: `<div id="app"></div><script type="module" src="${entryUrl}"></script>` }),
        completed.value
          ? h(CustomerSessionCompletion, { orderContinuationUrl: orderContinuationUrl.value, settings: {
              enabled: true,
              surveyUrl: 'https://reward.example/test',
              displayDurationSeconds: 300,
              title: '測試獎勵頁',
              description: '付款完成立即顯示',
              dismissLabel: '結束測試',
            } })
          : null,
      ]),
    }), { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: {} })] } })
    const frame = screen.container.querySelector('iframe')!
    registry.attachActiveFrame(frame.contentWindow)
    const content = () => frame.contentDocument!
    async function click(label: string) {
      await vi.waitFor(() => {
        const button = [...content().querySelectorAll('button')].find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label)
        expect(button).toBeDefined()
        expect(button!.disabled).toBe(false)
        button!.click()
      })
    }
    async function input(value: string) {
      await vi.waitFor(() => expect(content().querySelector('input'), `${entryUrl}: ${content().body.textContent}`).not.toBeNull(), { timeout: 10_000 })
      const element = content().querySelector('input')!
      element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    try {
      // Standalone Menu has no entry page; Kiosk owns optional phone UI.
      await click('查看周氏蝦捲招牌便當')
      await click('加入購物車')
      await click('查看訂單')
      await click('內用')
      await click('確認訂單，進入結帳')
      if (invoice === 'donation') {
        await click('略過，捐贈發票')
        await vi.waitFor(() => expect(content().body.textContent).toContain('LINE Pay'))
        expect(content().querySelector('#invoice-code')).toBeNull()
      }
      else {
        await input('/ABC1234')
        await click('確認發票資料，選擇付款方式')
      }
      await click('LINE Pay')
      expect(completed.value).toBe(false)
      await vi.waitFor(() => expect(content().querySelector('img[alt="測試專用付款 QR Code，無法實際付款"]')).not.toBeNull())
      // ROOT CAUSE: deferring the iframe completion event until QR acknowledgement
      // also deferred the host-owned reward. Acceptance must notify the host now.
      await vi.waitFor(() => expect(completed.value).toBe(true), { timeout: 15_000 })
      await expect.element(screen.getByRole('heading', { name: '測試獎勵頁' })).toBeVisible()
      await expect.element(screen.getByRole('img', { name: 'stage.customer-session.completion.order-qr-alt' })).toBeVisible()
      expect(orderContinuationUrl.value).toContain('http://localhost:5166/?continuation=')
      await expect.element(screen.getByRole('link')).toHaveAttribute('href', orderContinuationUrl.value!)
    }
    finally {
      stop()
      screen.unmount()
    }
  })
})
