import type { BackgroundSpeechMode, ServiceMode } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { ConversationScript } from './conversationMatrix'

/** Synthetic service-mode gold, kept outside model prompts and production sessions. */
export const serviceModeCases: Array<{ serviceMode: ServiceMode, backgroundSpeechMode: BackgroundSpeechMode, channel?: 'main-direct', script: ConversationScript }> = [
  { serviceMode: 'kiosk', backgroundSpeechMode: 'off', script: { id: 'MODE-KIOSK', title: '原點餐選用餐方式後進入發票', source: 'service-mode-user-requirement', kind: 'functional', group: 'service-modes', provenance: 'synthetic', catalog: 'current', initial: { entry: 'ready', cart: [] }, steps: [
    { text: '我要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }] },
    { text: '內用', fulfillment: 'dine-in', sameCart: true },
    { text: '好，開始結帳', sameCart: true, phase: 'checkout_invoice', checkoutStarts: 1 },
  ] } },
  { serviceMode: 'table-service', backgroundSpeechMode: 'off', script: { id: 'MODE-TABLE', title: '隨桌點餐明確確認才送單', source: 'service-mode-user-requirement', kind: 'functional', group: 'service-modes', provenance: 'synthetic', catalog: 'current', initial: { entry: 'ready', cart: [] }, steps: [
    { text: '我要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }], forbidden: '內用還是|自取|選擇付款' },
    { text: '確認訂單，幫我送出', sameCart: true, forbidden: '內用還是|自取|選擇付款' },
  ] } },
  ...(['off', 'observe', 'enforce'] as const).map(backgroundSpeechMode => ({ serviceMode: 'kiosk' as const, backgroundSpeechMode, script: { id: `MODE-BACKGROUND-${backgroundSpeechMode.toUpperCase()}`, title: `背景政策 ${backgroundSpeechMode}`, source: 'service-mode-user-requirement', kind: 'adversarial' as const, group: 'service-modes', provenance: 'synthetic', catalog: 'current' as const, initial: { entry: 'ready' as const, cart: [] }, steps: [
    { text: '小王，你昨天看什麼電影？', sameCart: true, silentAllowed: true, ...(backgroundSpeechMode === 'enforce' ? { silentOnly: true } : {}) },
    { text: '我要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }] },
  ] } })),
]

// Same customer contract through Main directly, independent from a fortunate Jev path.
serviceModeCases.push({ serviceMode: 'table-service', backgroundSpeechMode: 'off', channel: 'main-direct', script: {
  id: 'MODE-TABLE-MAIN',
  title: 'Main 直接完成隨桌點餐與確認',
  source: 'service-mode-user-requirement',
  kind: 'functional',
  group: 'service-modes',
  provenance: 'synthetic',
  catalog: 'current',
  initial: { entry: 'ready', cart: [] },
  steps: [
    { text: '我要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }], forbidden: '內用還是|自取|選擇付款' },
    { text: '確認訂單，幫我送出', sameCart: true, forbidden: '內用還是|自取|選擇付款' },
  ],
} })
