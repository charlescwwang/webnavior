import type { ConversationScript } from './conversationMatrix'

/** Distinguishes open recommendation, category preference and a named unavailable product. */
export const discoveryCases: ConversationScript[] = [
  ...['不知道要吃什麼', '沒想法，幫我挑幾樣', '我要吃便當', '我想吃便當'].map((text, index): ConversationScript => ({
    id: `DISCOVERY-${index + 1}`,
    title: text,
    source: 'reported-20261105-menu-discovery',
    kind: 'functional',
    group: 'menu-discovery',
    provenance: 'synthetic',
    catalog: 'current',
    initial: { entry: 'ready', cart: [] },
    steps: [{ text, cart: [], nonempty: true, ...(index > 1 ? { category: '便當' } : {}), forbidden: '已.*加入|要幾份' }],
  })),
  { id: 'DISCOVERY-MISSING-PRODUCT', title: '指定未販售品項不替換成相近種類', source: 'reported-20261105-menu-discovery', kind: 'functional', group: 'menu-discovery', provenance: 'synthetic', catalog: 'current', initial: { entry: 'ready', cart: [] }, steps: [{ text: '我想要吃鱔魚意麵', cart: [], reply: '沒有|未提供|未販售|沒.*賣|查不到', forbidden: '您是要|您指的是|已.*加入' }] },
]
