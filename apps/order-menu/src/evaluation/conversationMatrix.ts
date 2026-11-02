/** Frozen synthetic dialogue gold. Never include assessment fields in provider input. */
export interface ExpectedLine { itemId: string, quantity: number, options?: Record<string, string> }
/** Expected facts after one customer turn; omitted fields are deliberately unconstrained. */
export interface MatrixStep {
  text: string
  sameCart?: boolean
  cart?: ExpectedLine[]
  shown?: 'all' | 'empty'
  shownIds?: string[]
  minPrice?: number
  maxPrice?: number
  category?: string
  nonempty?: boolean
  novel?: boolean
  excludedIngredients?: string[]
  notSpicy?: boolean
  reply?: string
  forbidden?: string
  purpose?: string
  phase?: string
  fulfillment?: 'dine-in' | 'takeout'
  ready?: boolean
  checkoutStarts?: number
  silentAllowed?: boolean
  silentOnly?: boolean
  allowFailure?: boolean
  retry?: boolean
  fault?: 'before-decision' | 'read-timeout' | 'invalid-decision' | 'lost-write-receipt' | 'stale-intent'
}
/** Case provenance distinguishes captured scripts, expanded probes, and reconstructed plans. */
export interface ConversationScript {
  id: string
  title: string
  source: string
  kind: 'functional' | 'adversarial' | 'fault' | 'diagnostic'
  group: string
  provenance: string
  evidenceGap?: string
  catalog: 'current' | 'spice' | 'sauce' | 'both' | 'unknown-composition'
  initial: { entry: 'ready' | 'pending', cart: ExpectedLine[], fulfillment?: 'dine-in' | 'takeout' }
  steps: MatrixStep[]
}

// Baseline positions: 20 original chains + 8 expanded existing probes + 4
// reconstructed planned sessions. Earlier prose incorrectly called all32 complete.
export const conversationScripts: ConversationScript[] = [
  {
    id: 'D01',
    title: '原連續對話 D01',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '阿明，你昨天看什麼電影？',
        sameCart: true,
        silentAllowed: true,
        silentOnly: true,
      },
      {
        text: '我要水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '我的水餃總共要兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D02',
    title: '原連續對話 D02',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '小陳，先把你的外套拿走。',
        sameCart: true,
        silentAllowed: true,
        silentOnly: true,
      },
      {
        text: '我要看全部的菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '先不要加任何餐點，請問能用什麼付款？',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D03',
    title: '原連續對話 D03',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我想請你幫忙，那個，我還沒說清楚。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
      },
      {
        text: '我現在說清楚：我要水餃一份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '再幫我把水餃總數改成兩份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D04',
    title: '原連續對話 D04',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '幫我那個，那個，先不要變更。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
      },
      {
        text: '我要問的是目前提供哪些付款方式，不要開始付款。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '請顯示全部菜單。',
        sameCart: true,
        shown: 'all',
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D05',
    title: '原連續對話 D05',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有水果嗎？',
        sameCart: true,
        shown: 'empty',
        reply: '沒有|查無|查不到|找不到|未找到',
      },
      {
        text: '現在換個問題：你們提供哪些付款方式？',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '我要水餃一份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D06',
    title: '原連續對話 D06',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '顯示全部菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '這台機器有收到我現在說的話嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
      },
      {
        text: '我要水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D07',
    title: '原連續對話 D07',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'diagnostic',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我剛才已略過，不需要再填手機。',
        sameCart: true,
      },
      {
        text: '請問目前有哪些付款方式？',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '我要看全部菜單',
        sameCart: true,
        shown: 'all',
      },
    ],
    group: 'development',
    evidenceGap: '原劇本聲稱已略過電話，缺少權威入口前態；保留診斷，不算完成。',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D08',
    title: '原連續對話 D08',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '請說明目前可用的付款方式。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '謝謝，我先看看。',
        sameCart: true,
        silentAllowed: true,
        silentOnly: true,
      },
      {
        text: '我要水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D09',
    title: '原連續對話 D09',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有水果嗎？',
        sameCart: true,
        shown: 'empty',
        reply: '沒有|查無|查不到|找不到|未找到',
      },
      {
        text: '我想問，那個，我還沒說清楚。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
        fault: 'before-decision',
      },
      {
        text: '我想問，那個，我還沒說清楚。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
        retry: true,
      },
      {
        text: '我現在要問付款方式。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D10',
    title: '原連續對話 D10',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '顯示全部菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '你有收到我現在說的話嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
        fault: 'before-decision',
      },
      {
        text: '你有收到我現在說的話嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
        retry: true,
      },
      {
        text: '我要水餃一份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D11',
    title: '原連續對話 D11',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃一份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '先不要結帳，只告訴我能用什麼付款。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '水餃改成總共兩份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'D12',
    title: '原連續對話 D12',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '請顯示全部菜單。',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '我先不點餐，只確認你有收到我的話嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
      },
      {
        text: '現在我要水餃一份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'development',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H01',
    title: '原連續對話 H01',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '阿芳，你的雨傘放在椅子上。',
        sameCart: true,
        silentAllowed: true,
        silentOnly: true,
      },
      {
        text: '給我一份水餃',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '總數改為兩份水餃',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H02',
    title: '原連續對話 H02',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '點餐機，請幫我，我還不知道怎麼說那個。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
      },
      {
        text: '我想知道可以怎麼付款，先不付錢。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '幫我加一份水餃。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H03',
    title: '原連續對話 H03',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '你們有賣蘋果嗎？',
        sameCart: true,
        shown: 'empty',
        reply: '沒有|查無|查不到|找不到|未找到',
      },
      {
        text: '先不談餐點，請問支援哪些付款方法？',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '現在秀出完整菜單給我。',
        sameCart: true,
        shown: 'all',
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H04',
    title: '原連續對話 H04',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我想看所有餐點。',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '我正在測試聲音，這句話有收到嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
      },
      {
        text: '給我水餃一份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H05',
    title: '原連續對話 H05',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'diagnostic',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '電話我已經選擇略過了，不要再問。',
        sameCart: true,
      },
      {
        text: '能用哪些方式付費？只是問問。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
      {
        text: '列出整份菜單。',
        sameCart: true,
        shown: 'all',
      },
    ],
    group: 'reserved',
    evidenceGap: '原劇本聲稱已略過電話，缺少權威入口前態；保留診斷，不算完成。',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H06',
    title: '原連續對話 H06',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有香蕉可以點嗎？',
        sameCart: true,
        shown: 'empty',
        reply: '沒有|查無|查不到|找不到|未找到',
      },
      {
        text: '機器請幫忙，我的意思，我還沒講清楚。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
        fault: 'before-decision',
      },
      {
        text: '機器請幫忙，我的意思，我還沒講清楚。',
        sameCart: true,
        reply: '請|什麼|哪|說明|清楚',
        forbidden: '水果|刷卡|目前沒有符合條件',
        retry: true,
      },
      {
        text: '我只要問你支援的付款方式。',
        sameCart: true,
        reply: 'LINE Pay|街口',
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H07',
    title: '原連續對話 H07',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我想看你們全部的餐點。',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '現在測試語音，這裡有接收到我的話嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
        fault: 'before-decision',
      },
      {
        text: '現在測試語音，這裡有接收到我的話嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
        retry: true,
      },
      {
        text: '我現在決定要一份水餃。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'H08',
    title: '原連續對話 H08',
    source: 'apps/server/tests/experiments/kioskConversationCases.ts',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '一份水餃幫我加入訂單。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '不要動訂單，我只想確認這句話有收到嗎？',
        sameCart: true,
        reply: '收到|聽|接收',
        forbidden: '請問要內用|推薦一項',
      },
      {
        text: '我的水餃最後總共需要兩份。',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    group: 'reserved',
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
  },
  {
    id: 'M01',
    title: 'multi-add',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵跟水餃各一份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '幫我核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M02',
    title: 'single-ambiguous',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要一份便當',
        sameCart: true,
      },
      {
        text: '對',
        sameCart: true,
      },
      {
        text: '炸排骨便當一份',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M03',
    title: 'alternative-inquiry',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵或水餃，你推薦哪個？先不要加',
        sameCart: true,
      },
      {
        text: '各是多少錢',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M04',
    title: 'replacement',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [
        {
          itemId: 'beef-noodle-soup',
          quantity: 1,
        },
      ],
    },
    steps: [
      {
        text: '牛肉麵不要了，改水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '幫我核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M05',
    title: 'mixed-query-add',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵一份幫我加，水餃一份多少錢？',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
        ],
      },
      {
        text: '先不要結帳，看看訂單',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M06',
    title: 'quantity-correction',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [
        {
          itemId: 'dumplings',
          quantity: 3,
        },
      ],
    },
    steps: [
      {
        text: '剛才的水餃總共只要兩份，請幫我改好',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '幫我核對份數',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M07',
    title: 'fulfillment-correction',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [
        {
          itemId: 'dumplings',
          quantity: 1,
        },
      ],
      fulfillment: 'takeout',
    },
    steps: [
      {
        text: '等等我要改成內用',
        sameCart: true,
        fulfillment: 'dine-in',
      },
      {
        text: '先不要結帳',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M08',
    title: 'whole-menu',
    source: 'apps/server/tests/experiments/kioskProviderReplay.test.ts#configured-multi-demand',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要看你們全部的菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '水餃一份多少錢',
        sameCart: true,
      },
    ],
    provenance: 'expanded-existing-probe',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M09',
    title: 'planned-multi-quantity',
    source: 'docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md#C-Main',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵兩份，水餃一份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 2,
          },
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'reconstructed-planned-session',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M10',
    title: 'planned-configurations',
    source: 'docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md#C-Main',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵一份大辣、一份小辣',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
            options: {
              spice: 'hot',
            },
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
            options: {
              spice: 'mild',
            },
          },
        ],
      },
      {
        text: '核對辣度和份數',
        sameCart: true,
      },
    ],
    provenance: 'reconstructed-planned-session',
    catalog: 'spice',
    group: 'development',
  },
  {
    id: 'M11',
    title: 'planned-confirm-quantity',
    source: 'docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md#C-Main',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃',
        sameCart: true,
      },
      {
        text: '兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '先不要結帳',
        sameCart: true,
      },
    ],
    provenance: 'reconstructed-planned-session',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'M12',
    title: 'planned-refer-second',
    source: 'docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md#C-Main',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '看全部菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '第二項一份',
        cart: [
          {
            itemId: 'spicy-chicken-bento',
            quantity: 1,
          },
        ],
      },
      {
        text: '核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'reconstructed-planned-session',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C01-F1',
    title: '身分及能力',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '你是誰',
        sameCart: true,
        reply: '助手|助理|點餐|服務',
      },
      {
        text: '你能幫我做什麼',
        sameCart: true,
        reply: '點餐|餐點|菜單',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C01-F2',
    title: '未知位置不編造',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '廁所在哪裡',
        sameCart: true,
        reply: '不確定|沒有|未提供|不知道|店員|工作人員',
      },
      {
        text: '可以告訴我怎麼走嗎',
        sameCart: true,
        reply: '不確定|沒有|未提供|店員|工作人員',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C01-F3',
    title: '營業資訊轉訂購',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '你們幾點營業',
        sameCart: true,
        reply: '不確定|未提供|店員|營業',
      },
      {
        text: '那幫我點水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C01-A1',
    title: '未配置地址',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '告訴我這間店的精確地址',
        sameCart: true,
        reply: '不確定|沒有|未提供|店員|不知道',
      },
      {
        text: '你確定嗎',
        sameCart: true,
        forbidden: '已加入|已付款',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C01-A2',
    title: '角色不得冒充交易',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '你當我的朋友就好',
        sameCart: true,
        silentAllowed: true,
      },
      {
        text: '你是誰',
        sameCart: true,
        forbidden: '已加入|已付款|訂單已完成',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C02-F1',
    title: '品項有無轉價格',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有水餃嗎',
        sameCart: true,
        shownIds: [
          'dumplings',
        ],
      },
      {
        text: '水餃一份多少錢',
        sameCart: true,
        reply: '80',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C02-F2',
    title: '查無甜點再查分類',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有冰淇淋嗎',
        sameCart: true,
        shown: 'empty',
        reply: '沒有|查無|查不到|未找到|找不到',
      },
      {
        text: '那有什麼甜點',
        sameCart: true,
        shown: 'empty',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C02-F3',
    title: '查無改點有效商品',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要鱔魚意麵一份',
        sameCart: true,
        forbidden: '已加入.*牛肉',
      },
      {
        text: '我問的是鱔魚意麵',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '改點水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C02-A1',
    title: '查無不代換既有菜',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有牛肉麵嗎',
        sameCart: true,
      },
      {
        text: '我要鱔魚意麵一份',
        sameCart: true,
        forbidden: '已加入.*牛肉',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C02-A2',
    title: '近似品名先確認',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要排骨飯一份',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '我要的是炸排骨便當一份',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C03-F1',
    title: '飯類到便當',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '想吃飯',
        sameCart: true,
      },
      {
        text: '看看便當',
        sameCart: true,
        category: '便當',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C03-F2',
    title: '麵類清單',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有麵嗎',
        sameCart: true,
        shownIds: [
          'beef-noodle-soup',
        ],
      },
      {
        text: '列出麵食選擇',
        sameCart: true,
        category: '麵食',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C03-F3',
    title: '全部到點心再全部',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '看全部菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '看點心',
        sameCart: true,
        category: '點心',
      },
      {
        text: '再回全部菜單',
        sameCart: true,
        shown: 'all',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C03-A1',
    title: '查詢帶數量不購買',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '兩份水餃多少錢',
        sameCart: true,
        reply: '160|80',
      },
      {
        text: '先只問價錢，不要加入訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C03-A2',
    title: '唯一分類不購買',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '麵食有哪些',
        sameCart: true,
        shownIds: [
          'beef-noodle-soup',
        ],
      },
      {
        text: '好',
        sameCart: true,
        forbidden: '已加入',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C04-F1',
    title: '百元改兩百',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我有一百元，可以吃什麼',
        sameCart: true,
        maxPrice: 100,
        nonempty: true,
      },
      {
        text: '改成兩百元以內',
        sameCart: true,
        maxPrice: 200,
        nonempty: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C04-F2',
    title: '預算縮小',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '不超過兩百元的餐點',
        sameCart: true,
        maxPrice: 200,
        nonempty: true,
      },
      {
        text: '改成一百五十元以下',
        sameCart: true,
        maxPrice: 150,
        nonempty: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C04-F3',
    title: '價格區間再便宜',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '一百到一百五十元的餐點',
        sameCart: true,
        minPrice: 100,
        maxPrice: 150,
        nonempty: true,
      },
      {
        text: '有更便宜的嗎',
        sameCart: true,
        maxPrice: 150,
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C04-A1',
    title: '不可超百元推薦',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '一百元以內可以吃什麼',
        sameCart: true,
        maxPrice: 100,
        nonempty: true,
      },
      {
        text: '還有其他一百元以內的嗎',
        sameCart: true,
        maxPrice: 100,
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C04-A2',
    title: '整單預算不得承諾單價方案',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '兩個人總預算一百元，幫我選餐',
        sameCart: true,
        forbidden: '推薦.*牛肉麵|已加入',
      },
      {
        text: '那水餃一份多少錢',
        sameCart: true,
        reply: '80',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C05-F1',
    title: '推薦連續換批',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '推薦餐點，先不要點',
        sameCart: true,
        nonempty: true,
      },
      {
        text: '有其他的嗎',
        sameCart: true,
        novel: true,
      },
      {
        text: '再換其他的',
        sameCart: true,
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C05-F2',
    title: '換批保留預算',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '推薦兩百元以下餐點',
        sameCart: true,
        maxPrice: 200,
        nonempty: true,
      },
      {
        text: '有其他不超過兩百元的嗎',
        sameCart: true,
        maxPrice: 200,
        novel: true,
      },
      {
        text: '有其他的嗎',
        sameCart: true,
        maxPrice: 200,
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C05-F3',
    title: '分類加預算換分類',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '一百五十元以下的便當',
        sameCart: true,
        maxPrice: 150,
        category: '便當',
        nonempty: true,
      },
      {
        text: '換麵食，一樣一百五十元以下',
        sameCart: true,
        maxPrice: 150,
        category: '麵食',
        nonempty: true,
      },
      {
        text: '其他麵食呢',
        sameCart: true,
        maxPrice: 150,
        category: '麵食',
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C05-A1',
    title: '唯一推薦耗盡',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '推薦一百元以內餐點',
        sameCart: true,
        maxPrice: 100,
        nonempty: true,
      },
      {
        text: '其他的',
        sameCart: true,
        maxPrice: 100,
        novel: true,
        reply: '沒有|找不到|調整|條件',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C05-A2',
    title: '飲食限制不能丟失',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '不要含牛肉，一百五十元以下的',
        sameCart: true,
        excludedIngredients: [
          'beef',
        ],
        maxPrice: 150,
      },
      {
        text: '其他的呢',
        sameCart: true,
        excludedIngredients: [
          'beef',
        ],
        maxPrice: 150,
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C06-F1',
    title: '價位加不辣',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '兩百以下不要辣的餐點',
        sameCart: true,
        maxPrice: 200,
        notSpicy: true,
      },
      {
        text: '有其他的嗎',
        sameCart: true,
        maxPrice: 200,
        notSpicy: true,
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C06-F2',
    title: '比較再明確訂購',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃和牛肉麵哪個便宜',
        sameCart: true,
        reply: '水餃|80',
      },
      {
        text: '便宜的水餃兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C06-F3',
    title: '成分查詢接續',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '哪些餐點沒有牛肉',
        sameCart: true,
        excludedIngredients: [
          'beef',
        ],
      },
      {
        text: '還有別的嗎',
        sameCart: true,
        excludedIngredients: [
          'beef',
        ],
        novel: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C06-A1',
    title: '未知過敏成分不得保證',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '保證完全不含花生的餐點有哪些',
        sameCart: true,
        forbidden: '保證.*(?:沒有|不含)|全部.*不含花生',
      },
      {
        text: '那我先問店員',
        sameCart: true,
      },
    ],
    catalog: 'unknown-composition',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C06-A2',
    title: '複合條件必須全滿足',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '一百元以下，而且完全不含豬肉',
        sameCart: true,
        maxPrice: 100,
        excludedIngredients: [
          'pork',
        ],
        shown: 'empty',
      },
      {
        text: '確定有符合的嗎',
        sameCart: true,
        maxPrice: 100,
        excludedIngredients: [
          'pork',
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C07-F1',
    title: '推薦同意仍不購買',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '不知道吃什麼，請推薦',
        sameCart: true,
      },
      {
        text: '好',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '先只看菜單',
        sameCart: true,
        shown: 'all',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C07-F2',
    title: '點餐同意與份數',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃',
        sameCart: true,
      },
      {
        text: '好',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C07-F3',
    title: '拒絕後新需求',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃',
        sameCart: true,
      },
      {
        text: '先不要',
        sameCart: true,
      },
      {
        text: '我要炸排骨便當一份',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C07-A1',
    title: '多品項裸肯定不選',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵或水餃哪個好，先別點',
        sameCart: true,
      },
      {
        text: '好',
        sameCart: true,
        forbidden: '已加入',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C07-A2',
    title: '被取代問題不吃好',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃',
        sameCart: true,
      },
      {
        text: '先不點了，你是誰',
        sameCart: true,
      },
      {
        text: '好',
        sameCart: true,
        forbidden: '已加入',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C08-F1',
    title: '份數改總數',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '水餃總共改三份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 3,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C08-F2',
    title: '百份改合法兩份',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要一百份水餃',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '那改兩份水餃',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C08-F3',
    title: '無份數補兩份',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃',
        sameCart: true,
        purpose: 'item-configuration',
      },
      {
        text: '兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C08-A1',
    title: '百份不得截成一份',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一百份',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '確認一下，不要直接加',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C08-A2',
    title: '顆數價格不是份數',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃每份十顆八十元對嗎',
        sameCart: true,
        reply: '10|十|80',
      },
      {
        text: '有其他點心嗎',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C09-F1',
    title: '必填辣度與份數',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要牛肉麵',
        sameCart: true,
      },
      {
        text: '小辣',
        sameCart: true,
      },
      {
        text: '一份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
            options: {
              spice: 'mild',
            },
          },
        ],
      },
    ],
    catalog: 'spice',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C09-F2',
    title: '兩份各自辣度',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵一份小辣、一份大辣',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
            options: {
              spice: 'mild',
            },
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
            options: {
              spice: 'hot',
            },
          },
        ],
      },
      {
        text: '核對兩份辣度',
        sameCart: true,
      },
    ],
    catalog: 'spice',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C09-F3',
    title: '客製插入價格',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃兩份',
        sameCart: true,
        purpose: 'item-configuration',
      },
      {
        text: '水餃一份多少錢',
        sameCart: true,
        reply: '80',
      },
      {
        text: '芝麻醬',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
            options: {
              sauce: 'sesame',
            },
          },
        ],
      },
    ],
    catalog: 'sauce',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C09-A1',
    title: '缺規格不得入車',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵兩份',
        sameCart: true,
        purpose: 'item-configuration',
      },
      {
        text: '先等一下',
        sameCart: true,
        reply: '好|等|稍|保留',
        forbidden: '已加入|價位|種類|推薦',
      },
    ],
    catalog: 'spice',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C09-A2',
    title: '規格不串到新菜',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵兩份',
        sameCart: true,
      },
      {
        text: '小辣',
        cart: [{ itemId: 'beef-noodle-soup', quantity: 2, options: { spice: 'mild' } }],
      },
      {
        text: '先不要牛肉麵，改水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    catalog: 'spice',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C10-F1',
    title: '兩品項明確各一',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵一碗，加水餃一份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '看看訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C10-F2',
    title: '草稿交錯恢復',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要牛肉麵',
        sameCart: true,
      },
      {
        text: '先加水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '牛肉麵也要兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C10-F3',
    title: '各自配置兩品項',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵小辣一份，水餃芝麻醬兩份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
            options: {
              spice: 'mild',
            },
          },
          {
            itemId: 'dumplings',
            quantity: 2,
            options: {
              sauce: 'sesame',
            },
          },
        ],
      },
      {
        text: '核對兩個品項',
        sameCart: true,
      },
    ],
    catalog: 'both',
    provenance: 'synthetic-explicit-preconditions',
    group: 'development',
  },
  {
    id: 'C10-A1',
    title: '不能漏第二項',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃兩份，炸排骨便當一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
      {
        text: '核對全部訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C10-A2',
    title: '數量不得合併',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份，牛肉麵兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 2,
          },
        ],
      },
      {
        text: '核對各自份數',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C11-F1',
    title: '展示排序第二項',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '顯示全部菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '第二項一份',
        cart: [
          {
            itemId: 'spicy-chicken-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C11-F2',
    title: '唯一品項省略',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '有水餃嗎',
        sameCart: true,
        shownIds: [
          'dumplings',
        ],
      },
      {
        text: '那我要三份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 3,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C11-F3',
    title: '指明Cart其中一行',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '再加牛肉麵一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
        ],
      },
      {
        text: '把水餃總數改三份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 3,
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C11-A1',
    title: '多候選好不得挑第一',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '便當有哪些',
        sameCart: true,
        category: '便當',
      },
      {
        text: '好',
        sameCart: true,
        forbidden: '已加入',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C11-A2',
    title: '新查詢不授權舊指代',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '那個兩份',
        sameCart: true,
        reply: '請|哪|指|說',
        forbidden: '已加入|炸排骨便當|購物車目前沒有餐點',
      },
      {
        text: '水餃多少錢',
        sameCart: true,
        reply: '80',
      },
      {
        text: '先不要加任何餐',
        sameCart: true,
        reply: '好|保留|先',
        forbidden: '已加入|推薦|價位|種類',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C12-F1',
    title: '總數不是新增',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '水餃總共兩份就好',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C12-F2',
    title: '追加不是設定總數',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '再加兩份水餃',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 3,
          },
        ],
      },
      {
        text: '核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C12-F3',
    title: '換餐保留其他行',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '炸排骨便當一份，水餃一份',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '排骨便當不要了，換牛肉麵一份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '核對訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C12-A1',
    title: '重申總數不能追加',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '是總共兩份，不是再加兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C12-A2',
    title: '替換不得殘留舊餐',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '牛肉麵一份',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
        ],
      },
      {
        text: '牛肉麵換水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C13-F1',
    title: '取消單項核對',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份，牛肉麵一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
        ],
      },
      {
        text: '取消水餃',
        cart: [
          {
            itemId: 'beef-noodle-soup',
            quantity: 1,
          },
        ],
      },
      {
        text: '看目前訂單',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C13-F2',
    title: '取消草稿新點餐',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要牛肉麵',
        sameCart: true,
      },
      {
        text: '先不要了',
        sameCart: true,
      },
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C13-F3',
    title: '取消再加購',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '取消水餃',
        cart: [],
      },
      {
        text: '改點炸排骨便當一份',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C13-A1',
    title: '取消不清整單',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份，排骨便當一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
      {
        text: '只取消水餃，便當留著',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C13-A2',
    title: '否定餐點不改用餐方式',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '內用',
        sameCart: true,
        fulfillment: 'dine-in',
      },
      {
        text: '不要牛肉麵，先這樣',
        sameCart: true,
        phase: 'ordering',
        checkoutStarts: 0,
        reply: '好|保留|先|沒有|未',
        fulfillment: 'dine-in',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C14-F1',
    title: '入口略過再點餐',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'pending',
      cart: [],
    },
    steps: [
      {
        text: '略過手機登記，直接點餐',
        sameCart: true,
        ready: true,
      },
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C14-F2',
    title: '用餐改口後續點餐',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '自取',
        sameCart: true,
        fulfillment: 'takeout',
      },
      {
        text: '更正，我要內用',
        sameCart: true,
        fulfillment: 'dine-in',
      },
      {
        text: '再加水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
        fulfillment: 'dine-in',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C14-F3',
    title: '拒絕結帳後加購',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '內用',
        sameCart: true,
        fulfillment: 'dine-in',
      },
      {
        text: '先不要結帳',
        sameCart: true,
        checkoutStarts: 0,
      },
      {
        text: '再加水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
        checkoutStarts: 0,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C14-A1',
    title: '未授權不略過電話',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'pending',
      cart: [],
    },
    steps: [
      {
        text: '好',
        sameCart: true,
        silentAllowed: true,
        ready: false,
      },
      {
        text: '我想看看菜單',
        sameCart: true,
        ready: false,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C14-A2',
    title: '未知寫入不重放',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
        fault: 'lost-write-receipt',
      },
      {
        text: '先核對購物車，不要再加',
        sameCart: true,
        checkoutStarts: 0,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C15-F1',
    title: '釐清不用無限循環',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '請幫忙，我還沒說清楚',
        sameCart: true,
      },
      {
        text: '好',
        sameCart: true,
      },
      {
        text: '飯',
        sameCart: true,
      },
      {
        text: '吃飯',
        sameCart: true,
        forbidden: '剛才沒有理解清楚',
      },
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C15-F2',
    title: '份數中插入廁所',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要水餃',
        sameCart: true,
      },
      {
        text: '廁所在哪裡',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '水餃兩份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C15-F3',
    title: '資訊題轉購買',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份多少錢',
        sameCart: true,
        reply: '80',
      },
      {
        text: '我要一份水餃',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
      {
        text: '內用',
        sameCart: true,
        fulfillment: 'dine-in',
      },
      {
        text: '好',
        sameCart: true,
        phase: 'checkout_invoice',
        checkoutStarts: 1,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C15-A1',
    title: '含糊重問後能明確完成',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要那個',
        sameCart: true,
      },
      {
        text: '剛才說的那個',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '我明確要水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C15-A2',
    title: '唯讀主題不可阻擋新單',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'adversarial',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '先不要訂，只看一百元以下',
        sameCart: true,
        maxPrice: 100,
      },
      {
        text: '現在要炸排骨便當一份',
        cart: [
          {
            itemId: 'fried-pork-chop-bento',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C16-F1',
    title: '同伴轉本機',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '阿明，你昨天電影好看嗎',
        sameCart: true,
        silentAllowed: true,
      },
      {
        text: '點餐機，水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C16-F2',
    title: '讀取失敗恢復',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '請顯示全部菜單',
        sameCart: true,
        fault: 'read-timeout',
        allowFailure: true,
      },
      {
        text: '再顯示全部菜單',
        sameCart: true,
        shown: 'all',
      },
      {
        text: '我要水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C16-F3',
    title: '操作拒絕合法更正',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'functional',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '我要一百份水餃',
        sameCart: true,
        forbidden: '已加入',
      },
      {
        text: '更正，只要兩份水餃',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 2,
          },
        ],
      },
      {
        text: '核對份數',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C16-A1',
    title: 'schema錯誤是技術故障',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份多少錢',
        sameCart: true,
        fault: 'invalid-decision',
        allowFailure: true,
      },
      {
        text: '重新問水餃價格',
        sameCart: true,
        reply: '80',
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
  {
    id: 'C16-A2',
    title: '舊任務不重播寫入',
    source: 'docs/plans/2026-10-28-kiosk-conversation-repair.md#核心驗收',
    kind: 'fault',
    initial: {
      entry: 'ready',
      cart: [],
    },
    steps: [
      {
        text: '水餃一份',
        cart: [
          {
            itemId: 'dumplings',
            quantity: 1,
          },
        ],

      },
      {
        text: '先別再加，核對原來的一份',
        fault: 'stale-intent',
        sameCart: true,
      },
    ],
    provenance: 'synthetic-explicit-preconditions',
    catalog: 'current',
    group: 'development',
  },
]

export const smokeScriptIds = ['C01-F1', 'C02-F1', 'C03-F1', 'C04-F1', 'C05-F2', 'C07-F2', 'C08-F1', 'C09-F1', 'C10-F1', 'C12-F1', 'C14-F2', 'C15-F2']

export const highRiskScriptIds = ['C04-F1', 'C04-F2', 'C05-F1', 'C05-F2', 'C07-F1', 'C07-F2', 'C07-A2', 'C08-F1', 'C08-F2', 'C08-A1', 'C09-F1', 'C09-F3', 'C10-F1', 'C10-F2', 'C10-F3', 'C11-F1', 'C11-F2', 'C11-A1', 'C12-F1', 'C12-F2', 'C12-F3', 'C14-F2', 'C15-F2', 'C15-F3']
