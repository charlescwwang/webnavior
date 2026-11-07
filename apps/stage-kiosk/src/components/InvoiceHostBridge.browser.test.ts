import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'
import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

// Uses the existing loopback POS simulator for catalog reads only. No model,
// production session, payment selection or order submission is involved.
describe.runIf(import.meta.env.VITE_ORDER_MENU_INVOICE_BRIDGE_TEST === 'true')('actual App invoice input over the Host bridge', () => {
  // Report: this chat, Nov2; the refreshed invoice page enabled its button while
  // voice submission repeatedly chose carrier instead of confirming the draft.
  it.each([
    { method: 'carrier', code: '/PTGRJP2', confirm: 'checkout_confirm_invoice' },
    { method: 'citizen', code: 'AB12345678901234', confirm: 'checkout_confirm_invoice' },
    { method: 'tax-id', code: '12345678', confirm: 'checkout_confirm_tax_id' },
  ])('exposes current $method input and confirms it through the real transport', async ({ method, code, confirm }) => {
    const frame = document.createElement('iframe')
    const entry = new URL('../../../order-menu/src/main.ts', import.meta.url).href
    frame.srcdoc = `<div id="app"></div><script type="module" src="${entry}"></script>`
    document.body.append(frame)
    const client = createInteractiveServiceClient()
    const execute = async (name: string, input: Record<string, unknown> = {}) => {
      const tool = client.tools.value.find(tool => tool.name === name)
      expect(tool, name).toBeDefined()
      const result = await client.execute(tool!, input)
      expect(result, `${name}: ${JSON.stringify(result)}`).not.toMatchObject({ ok: false })
      return result
    }
    try {
      await vi.waitFor(() => expect(frame.contentDocument?.body.textContent).toContain('蝦捲招牌便當'), { timeout: 10_000 })
      client.activate(window.location.origin, frame.contentWindow)
      await client.waitUntilReady()
      async function click(text: string) {
        await vi.waitFor(() => {
          const button = [...frame.contentDocument!.querySelectorAll('button')].find(button => button.textContent?.trim() === text || button.getAttribute('aria-label') === text)
          expect(button, text).toBeDefined()
          expect(button!.disabled).toBe(false)
          button!.click()
        })
      }
      await click('查看蝦捲招牌便當')
      await click('加入購物車')
      await click('查看訂單')
      await click('自取')
      await click('確認訂單，進入結帳')
      if (method === 'tax-id')
        await click('公司統一編號')
      else
        await click(method === 'carrier' ? '手機載具' : '自然人憑證')
      const input = frame.contentDocument!.querySelector<HTMLInputElement>(method === 'tax-id' ? 'input[aria-label="統一編號"]' : '#invoice-code')!
      expect(input).not.toBeNull()
      input.value = code
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.waitFor(() => {
        const button = [...frame.contentDocument!.querySelectorAll('button')].find(button => button.textContent?.includes(method === 'tax-id' ? '確認統編' : '確認發票資料'))
        expect(button?.disabled).toBe(false)
      })
      await execute('kiosk_fast_path_context', { transcript: '送出' })
      const before = parse(conversationContextSchema, await execute('kiosk_conversation_context', { includeCatalog: false }))
      expect(before).toMatchObject({ checkout: { invoiceDraftReady: true }, allowedToolNames: expect.arrayContaining([confirm]) })
      await execute('kiosk_agent_task', { action: 'BEGIN', taskId: 'invoice-bridge-test', transcript: '送出', expectedMenuRevision: before.revisions.menu, readOnly: false, constraints: { excludeIngredients: [], includeIngredients: [] } })
      const bound = await execute('kiosk_conversation_context', { includeCatalog: false })
      expect(bound).toMatchObject({ checkout: { invoiceDraftReady: true }, allowedToolNames: expect.arrayContaining([confirm]) })
      const result = await execute(confirm, { confirmedByUser: true })
      expect(result).toMatchObject({ checkout: { stage: 'payment' } })
      await execute('kiosk_agent_task', { action: 'END', taskId: 'invoice-bridge-test' })
      const after = await execute('kiosk_conversation_context', { includeCatalog: false })
      expect(after).toMatchObject({ phase: 'checkout_payment_select', paymentState: 'idle' })
    }
    finally {
      client.activate()
      frame.remove()
    }
  }, 30_000)
})
