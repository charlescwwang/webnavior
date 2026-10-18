import { BasicTextarea } from '@proj-airi/ui'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskAsrSimulationPanel from './KioskAsrSimulationPanel.vue'

function renderPanel(props: InstanceType<typeof KioskAsrSimulationPanel>['$props']) {
  return render(KioskAsrSimulationPanel, { props, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
}

describe('aSR text submission', () => {
  it('shows request waiting separately from model exchange time and identifies the measured sentence', async () => {
    const screen = renderPanel({ timing: { transcript: '我要結帳', requestDurationMs: 9100, modelDurationMs: 8880, modelCalls: 2 } })
    await expect.element(screen.getByText('計時語句：我要結帳')).toBeVisible()
    await expect.element(screen.getByText('Jev 請求等待：9.10 秒')).toBeVisible()
    await expect.element(screen.getByText('模型呼叫：2 次；合計耗時：8.88 秒')).toBeVisible()
  })
  it('does not present missing provider accounting as zero model execution time', async () => {
    const screen = renderPanel({ timing: { transcript: '我要結帳', requestDurationMs: 5000 } })
    await expect.element(screen.getByText('Jev 請求等待：5.00 秒')).toBeVisible()
    await expect.element(screen.getByText('模型呼叫次數／耗時：未取得完整資料')).toBeVisible()
  })
  it('does not submit 要3 while Enter commits the Chinese composition for 要3份', async () => {
    const onSimulate = vi.fn()
    const screen = renderPanel({ onSimulate })
    const textarea = screen.container.querySelector('textarea')!
    await screen.getByRole('textbox').fill('要3')
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    expect(onSimulate).not.toHaveBeenCalled()

    textarea.value = '要3份'
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '份' }))
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }))
    await nextTick()
    expect(onSimulate).toHaveBeenCalledOnce()
    expect(onSimulate).toHaveBeenCalledWith('要3份')
    expect(textarea.value).toBe('')
  })

  it('does not submit the IME commit Enter when compositionend precedes keydown', async () => {
    const onSimulate = vi.fn()
    const screen = renderPanel({ onSimulate })
    await screen.getByRole('textbox').fill('要3份')
    const textarea = screen.container.querySelector('textarea')!
    textarea.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }))
    expect(onSimulate).not.toHaveBeenCalled()
    expect(textarea.value).toBe('要3份')
  })

  it('ignores held Enter but accepts a subsequent deliberate submission while work continues', async () => {
    const onSimulate = vi.fn()
    const screen = renderPanel({ onSimulate, status: '正在處理上一句' })
    await screen.getByRole('textbox').fill('要3份')
    const textarea = screen.container.querySelector('textarea')!
    const heldEnter = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    textarea.dispatchEvent(heldEnter)
    expect(onSimulate).not.toHaveBeenCalled()
    expect(heldEnter.defaultPrevented).toBe(true)
    await screen.getByRole('textbox').fill('改成兩份')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }))
    await nextTick()
    expect(onSimulate).toHaveBeenCalledOnce()
    expect(onSimulate).toHaveBeenCalledWith('改成兩份')
  })

  it('submits once when Enter is followed immediately by a form submit', async () => {
    const onSimulate = vi.fn()
    const screen = renderPanel({ onSimulate })
    await screen.getByRole('textbox').fill('有賣什麼？')
    const textarea = screen.container.querySelector('textarea')!
    textarea.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }))
    screen.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(onSimulate).toHaveBeenCalledOnce()
    expect(onSimulate).toHaveBeenCalledWith('有賣什麼？')
  })

  it('submits once on a button click and permits the same sentence as a new input', async () => {
    const onSimulate = vi.fn()
    const screen = renderPanel({ onSimulate })
    await screen.getByRole('textbox').fill('再一份')
    await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
    expect(onSimulate).toHaveBeenCalledOnce()
    await screen.getByRole('textbox').fill('再一份')
    await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
    expect(onSimulate).toHaveBeenCalledTimes(2)
  })
})

describe('shared textarea Enter contract', () => {
  it('keeps Enter as composition input even if the keyboard event flag is false', async () => {
    const onSubmit = vi.fn()
    const screen = render(BasicTextarea, { props: { modelValue: '要3', onSubmit } })
    const textarea = screen.container.querySelector('textarea')!
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const enter = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true })
    textarea.dispatchEvent(enter)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(false)
  })

  it('preserves Shift+Enter for a newline', () => {
    const onSubmit = vi.fn()
    const screen = render(BasicTextarea, { props: { modelValue: '要3份', onSubmit } })
    const enter = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    screen.container.querySelector('textarea')!.dispatchEvent(enter)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(false)
  })

  it('leaves ordinary Enter unchanged when submitOnEnter is disabled', () => {
    const onSubmit = vi.fn()
    const screen = render(BasicTextarea, { props: { modelValue: '要3份', submitOnEnter: false, onSubmit } })
    const enter = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true })
    screen.container.querySelector('textarea')!.dispatchEvent(enter)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(false)
  })
})
