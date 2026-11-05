import { expect, it } from 'vitest'

import { decideInteraction } from '.'

// Report: this chat, 2026-10-21: 「哈哈哈 好啊好啊」 showed the generic unclear-meaning error.
it('marks uncertain social greeting classification as silent rather than a failed service request', async () => {
  const result = await decideInteraction({ transcript: '哈哈哈 好啊好啊', candidates: [{ id: 'intent:recommend', description: '推薦餐點' }], decisionState: { phase: 'ordering', references: [], interactionState: { screen: 'menu', matchingCartLines: 0 } }, conversation: { messages: [{ role: 'user', content: '你今天怎麼會來這裡？' }, { role: 'assistant', content: '您好，我是 Navi，是這台 Kiosk 的智慧點餐服務員。請問您今天想吃點什麼呢？' }] }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async () => ({ answers: { recipient: { choice: 'KIOSK', confidence: 0.9992 }, route: { choice: 'GREET', confidence: 0.7487 }, greeting: { choice: 'IGNORE', confidence: 0.5559 } } }) })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_GREETING' })
  expect(result).not.toHaveProperty('actionId')
})
