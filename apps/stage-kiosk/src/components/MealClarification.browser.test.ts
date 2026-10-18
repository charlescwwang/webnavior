import type { MenuItem } from '../../../order-menu/src/domain/order-machine'
import type { PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import MealConfirmation from '../../../order-menu/src/components/mealConfirmation.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

describe('meal confirmation touch controls', () => {
  it.each([{ answer: '是', next: '請問泰式酸辣魚便當要幾份？' }, { answer: '不是', next: '請問水餃要幾份？' }])('continues $answer through the same real runtime as voice', async ({ answer, next }) => {
    // Browser-local POS declarations exercise real rendering/runtime behavior
    // without importing the Node-only simulator or replacing Web Platform APIs.
    const menu: MenuItem[] = [
      { id: 'dumplings', name: '水餃', description: 'Test dumplings', category: '點心', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] },
      { id: 'fish', name: '泰式酸辣魚便當', description: 'Test fish bento', category: '便當', price: 130, imageUrl: '', recommendationTags: [], optionGroups: [] },
    ]
    const question = shallowRef<PresentedQuestion>()
    const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onClarificationChange: value => question.value = value })
    const screen = render(defineComponent({
      setup: () => () => question.value ? h(MealConfirmation, { question: question.value, locked: false, onAnswer: (candidateId: string) => runtime.invokeManual('kiosk_fast_path_execute', { candidateId }) }) : null,
    }))
    await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '酸辣魚便當' }) as { clarificationOffer: { id: string } }
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer.id })
    await expect.element(screen.getByText('您是要點泰式酸辣魚便當嗎？')).toBeVisible()
    await screen.getByRole('button', { name: answer, exact: true }).click()
    await vi.waitFor(() => expect(question.value).toBeUndefined())
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { question: next } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
})
