import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'

import OrderSummaryBar from '../../../order-menu/src/components/OrderSummaryBar.vue'

const lines = [{ id: 'line1', name: '水餃', quantity: 2 }]

describe('cart summary activation', () => {
  it('opens once from the summary text, dish preview, or orange action area', async () => {
    const open = vi.fn()
    const registerControl = vi.fn()
    const screen = render(OrderSummaryBar, { props: { itemCount: 2, lines, total: '$120', onOpen: open, onRegisterControl: registerControl } })
    await screen.getByText('購物車', { exact: true }).click()
    expect(open).toHaveBeenCalledTimes(1)
    await screen.getByText('水餃', { exact: true }).click()
    expect(open).toHaveBeenCalledTimes(2)
    await screen.getByText('查看訂單', { exact: true }).click()
    expect(open).toHaveBeenCalledTimes(3)
    const footer = screen.container.querySelector('footer')!
    const button = footer.querySelector('button')!
    expect(registerControl).toHaveBeenCalledWith('order:view', button)
    expect(footer.querySelectorAll('button')).toHaveLength(1)
    const footerRect = footer.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    expect(buttonRect.width).toBeCloseTo(footerRect.width, 0)
    expect(buttonRect.height).toBeCloseTo(footerRect.height - 1, 0)
  })

  it('supports native Enter and Space activation without duplicate emits', async () => {
    const open = vi.fn()
    const screen = render(OrderSummaryBar, { props: { itemCount: 2, lines, total: '$120', onOpen: open } })
    const button = screen.getByRole('button', { name: '查看訂單', exact: true })
    await button.element().focus()
    await userEvent.keyboard('{Enter}')
    expect(open).toHaveBeenCalledTimes(1)
    await userEvent.keyboard(' ')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('keeps the entire empty cart disabled', async () => {
    const open = vi.fn()
    const screen = render(OrderSummaryBar, { props: { itemCount: 0, lines: [], total: '$0', onOpen: open } })
    await expect.element(screen.getByRole('button', { name: '查看訂單', exact: true })).toBeDisabled()
    screen.container.querySelector('strong')!.click()
    expect(open).not.toHaveBeenCalled()
  })
})
