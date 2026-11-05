import type { ConversationScript } from './conversationMatrix'

/** Synthetic consent regressions; no customer recordings or production order writes. */
export const customizationCases: Array<{ channel?: 'main-direct', script: ConversationScript }> = []
for (const channel of ['jev-main', 'main-direct'] as const) {
  for (const modifier of ['不要辣', '不要蔥']) {
    const accept = modifier === '不要辣'
    customizationCases.push({ ...(channel === 'main-direct' ? { channel } : {}), script: {
      id: `ORIGINAL-${accept ? 'ACCEPT' : 'DECLINE'}-${channel.toUpperCase()}`,
      title: `${modifier}先確認原版，再${accept ? '接受' : '取消'}`,
      source: 'reported-20261105-unsupported-customization',
      kind: 'functional',
      group: 'unsupported-customization',
      provenance: 'synthetic',
      catalog: 'current',
      initial: { entry: 'ready', cart: [] },
      steps: [
        { text: `我要炸排骨便當兩份，${modifier}`, cart: [], purpose: 'confirm-meal', reply: '不提供客製化', forbidden: '詢問.*店員|菜單資料|成分.*不足|已.*加入' },
        { text: accept ? '好，那就原本的' : '那不要了', phase: 'ordering', ...(accept ? { cart: [{ itemId: 'fried-pork-chop-bento', quantity: 2 }] } : { cart: [] }), forbidden: '已.*客製|已.*去蔥|已.*不辣' },
        ...(!accept ? [{ text: '我要炸排骨便當一份', cart: [{ itemId: 'fried-pork-chop-bento', quantity: 1 }] }] : []),
      ],
    } })
  }
}

for (const channel of ['jev-main', 'main-direct'] as const) {
  customizationCases.push({ ...(channel === 'main-direct' ? { channel } : {}), script: {
    id: `ORIGINAL-PENDING-${channel.toUpperCase()}`,
    title: '追問份數時提出不要辣',
    source: 'reported-20261105-unsupported-customization',
    kind: 'functional',
    group: 'unsupported-customization',
    provenance: 'synthetic',
    catalog: 'current',
    initial: { entry: 'ready', cart: [] },
    steps: [
      { text: '我要炸排骨便當', cart: [], phase: 'configuration' },
      { text: '兩份，不要辣', cart: [], purpose: 'confirm-meal', reply: '不提供客製化' },
      { text: '好，原本的就好', cart: [{ itemId: 'fried-pork-chop-bento', quantity: 2 }] },
    ],
  } })
}
