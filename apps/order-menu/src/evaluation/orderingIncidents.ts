import type { ConversationScript } from './conversationMatrix'

/** Sanitized reported dialogues retained as test inputs; no session IDs or model wire. */
export const orderingIncidents = {
  mealConfirmation: {
    id: '2026-11-01-meal-confirmation-quantity',
    turns: [
      { customer: '一份排骨飯', observedReply: '未找到完全相符的品名；可能相關的餐點是炸排骨便當，尚未確認是您要的餐點。' },
      { customer: '排骨便當', observedReply: '您是要點炸排骨便當嗎？' },
      { customer: '對，一份', observedReply: '你想調整價位，還是換餐點種類？' },
    ],
    expectedCart: { itemId: 'fried-pork-chop-bento', quantity: 1, total: 130 },
  },
  omittedName: {
    id: '2026-10-31-shown-meal-omitted-name',
    turns: [
      { customer: '我想吃排骨便當', observedReply: '炸排骨便當目前可以點。' },
      { customer: '那我要一份', observedReply: '推薦一項：炸排骨便當。' },
    ],
    expectedCart: { itemId: 'fried-pork-chop-bento', quantity: 1, total: 130 },
  },
  fulfillment: {
    id: '2026-10-31-fulfillment-became-recommendation',
    turns: [
      { customer: '一份排骨便當', observedReply: '已將炸排骨便當加入購物車，共 1 份。 請問要內用還是自取？' },
      { customer: '內用', observedReply: '推薦3 項：周氏蝦捲招牌便當、椒麻雞便當、泰式酸辣魚便當。' },
    ],
    expectedFulfillment: 'dine-in',
  },
  checkoutAssent: {
    id: '2026-10-31-checkout-assent-became-acknowledgement',
    turns: [
      { customer: '內用', observedReply: '已設為內用。 要進入結帳流程嗎？' },
      { customer: '好', observedReply: '好的，請繼續告訴我您的需求。' },
    ],
    expectedPhase: 'checkout_invoice',
  },
} as const

/**
 * Raw wording and screenshot provenance are retained even when prior state is missing.
 * These are incident evidence, not invented complete historical replays. Linked
 * synthetic scripts have explicit setup and are scored separately.
 */
export const reportedIncidentEvidence = [
  {
    id: 'reported-20261102-invoice-confirmation',
    source: 'user report Nov2; read-only failing session evidence saved privately',
    utterances: ['已經輸入', '輸入完成', '確認', '送出'],
    observed: 'Invoice page remained open; 已經輸入 produced generic clarification and 輸入完成 generic acknowledgement. Customer supplied /PTGRJP2 as a temporary test carrier.',
    gaps: ['Typed input itself is not recorded in dialogue; explicit synthetic invoice-draft precondition is used, not a full historical replay.'],
    syntheticScripts: ['P02-F1', 'P02-F2', 'P02-F3', 'P02-F4', 'P02-A1', 'P02-A2'],
  },
  {
    id: 'reported-20261102-phone-close-latency',
    source: 'user report 2026-11-02; private read-only production interaction trace',
    utterances: ['關閉', '關閉'],
    observed: 'Both returned 好的，請繼續告訴我您的需求。; second recovery5.1s/Main0.6s; serialized diagnostics delayed transcript/presentation. User confirmed closing phone entry to enter menu.',
    gaps: ['No exact browser submission timestamp; recorded user_text follows routing, so it is not total-turn latency.'],
    syntheticScripts: ['P01-F1', 'P01-A1', 'P01-A2'],
  },
  {
    id: 'reported-uncertain-service-request-review-invalid',
    source: 'user report: recovery e60aa1c8-813f-4417-b423-6de86bee18d2, utterance11',
    utterances: ['好'],
    observed: 'UNAVAILABLE / UNCERTAIN_SERVICE_REQUEST / review invalid; modelCalls0',
    gaps: ['Original failing utterance not saved; user recalled successive recommendation and purchase assents.'],
    syntheticScripts: ['C07-F1', 'C07-F2'],
  },
  {
    id: 'reported-clarification-loop',
    source: 'codex-clipboard-e4b2c5cd-0d46-449c-9207-d708ceba620e.png',
    utterances: ['好', '好', '好', '對', '飯', '吃飯'],
    observed: 'Every turn repeats: 請問您想點什麼餐點？',
    gaps: ['Initial question and authoritative session state absent from screenshot.'],
    syntheticScripts: ['C15-F1', 'C15-A1'],
  },
  {
    id: 'reported-identity-and-hundred-portions',
    source: 'codex-clipboard-21c93346-202c-454b-a95d-b901652be802.png',
    utterances: ['你是誰', '你知道主委是誰嗎', '我想要一百份水餃', '一百份'],
    observed: 'Identity becomes generic greeting; hundred portions asks quantity then recommends水餃.',
    gaps: ['No original cart or route traces.'],
    syntheticScripts: ['C01-F1', 'C08-F2', 'C08-A1'],
  },
  {
    id: 'reported-budget-alternatives-and-asr-wording',
    source: 'codex-clipboard-8638e8c5-dab6-402b-ac40-5105d66bed25.png',
    utterances: ['我有一百員，可以吃什麼', '我有200員，可以吃什麼', '有其他的嗎', '有其他不超過兩百元的嗎', '有其他的嗎'],
    observed: '100員 offered紅燒牛肉麵NT$150; alternatives become generic clarification, operation rejection, then same recommendation.',
    gaps: ['員 spelling is original screenshot text; no original audio or hidden query state.'],
    syntheticScripts: ['C04-F1', 'C04-A1', 'C05-F2'],
  },
  {
    id: 'live-acceptance-20261101-budget-lost-at-compiler',
    source: 'private webnavior-refactor-acceptance-20261101 budget failure; queryActions.test.ts regression',
    utterances: ['我有一百元，可以吃什麼', '有其他的嗎'],
    observed: 'SEARCH_MENU more flag compiled into unfiltered catalog read; over100 items shown.',
    gaps: [],
    syntheticScripts: ['C04-A1', 'C05-A1'],
  },
] as const

/** Post-deployment regressions run separately; the accepted112 gold stays frozen. */
interface IncidentConversationScript extends ConversationScript {
  /** Typed customer input goes straight to Main, without finite Jev selection. */
  channel?: 'main-direct'
  initial: ConversationScript['initial'] & { invoiceDraft?: { method: 'carrier' | 'citizen' | 'tax-id', code: string } }
}

export const incidentConversationScripts: IncidentConversationScript[] = [
  {
    id: 'P01-F1',
    title: '關閉自願電話登記',
    source: 'user report 2026-11-02; private close-latency trace',
    kind: 'functional',
    group: 'phone-close',
    provenance: 'Recorded two 關閉 turns; user confirmed closing phone entry to reach menu.',
    catalog: 'current',
    initial: { entry: 'pending', cart: [] },
    steps: [{ text: '關閉', ready: true, sameCart: true, forbidden: '請繼續告訴我您的需求', checkoutStarts: 0 }],
  },
  {
    id: 'P01-A1',
    title: '不關閉電話登記',
    source: 'synthetic counterexample to P01-F1',
    kind: 'adversarial',
    group: 'phone-close',
    provenance: 'Synthetic negation; no historical replay claim.',
    catalog: 'current',
    initial: { entry: 'pending', cart: [] },
    steps: [{ text: '不要關閉，我要填電話', ready: false, sameCart: true, checkoutStarts: 0 }],
  },
  {
    id: 'P01-A2',
    title: '對同伴說關閉其他視窗',
    source: 'synthetic counterexample to P01-F1',
    kind: 'adversarial',
    group: 'phone-close',
    provenance: 'Synthetic recipient and target exclusion; no historical replay claim.',
    catalog: 'current',
    initial: { entry: 'pending', cart: [] },
    steps: [{ text: '小王，關閉你電腦上的視窗', ready: false, sameCart: true, silentOnly: true, checkoutStarts: 0 }],
  },
  { id: 'P02-F1', title: '發票資料確認：確認', source: 'Nov2 invoice-confirmation report', kind: 'functional', group: 'invoice-confirmation', provenance: 'Synthetic visible invoice draft; not a full historical replay.', catalog: 'current', initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: 'carrier', code: '/PTGRJP2' } }, steps: [{ text: '確認', sameCart: true, phase: 'checkout_payment_select', checkoutStarts: 0, forbidden: '請繼續告訴我您的需求|已付款|付款成功' }] },
  { id: 'P02-F2', title: '發票資料確認：送出', source: 'Nov2 invoice-confirmation report', kind: 'functional', group: 'invoice-confirmation', provenance: 'Synthetic visible invoice draft; not a full historical replay.', catalog: 'current', initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: 'carrier', code: '/PTGRJP2' } }, steps: [{ text: '送出', sameCart: true, phase: 'checkout_payment_select', checkoutStarts: 0, forbidden: '請繼續告訴我您的需求|已付款|付款成功' }] },
  { id: 'P02-F3', title: '發票資料確認：輸入完成', source: 'Nov2 invoice-confirmation report', kind: 'functional', group: 'invoice-confirmation', provenance: 'Synthetic visible invoice draft; not a full historical replay.', catalog: 'current', initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: 'carrier', code: '/PTGRJP2' } }, steps: [{ text: '輸入完成', sameCart: true, phase: 'checkout_payment_select', checkoutStarts: 0, forbidden: '請繼續告訴我您的需求|已付款|付款成功' }] },
  { id: 'P02-F4', title: '發票資料確認：已經輸入', source: 'Nov2 invoice-confirmation report', kind: 'functional', group: 'invoice-confirmation', provenance: 'Synthetic visible invoice draft; not a full historical replay.', catalog: 'current', initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: 'carrier', code: '/PTGRJP2' } }, steps: [{ text: '已經輸入', sameCart: true, phase: 'checkout_payment_select', checkoutStarts: 0, forbidden: '請繼續告訴我您的需求|已付款|付款成功' }] },
  { id: 'P02-A1', title: '不確認未填完的載具', source: 'synthetic invoice counterexample', kind: 'adversarial', group: 'invoice-confirmation', provenance: 'Synthetic invalid draft.', catalog: 'current', initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: 'carrier', code: '/PT' } }, steps: [{ text: '確認', sameCart: true, phase: 'checkout_invoice', checkoutStarts: 0, forbidden: '已確認發票資料|付款成功' }] },
  { id: 'P02-A2', title: '拒絕送出已填的載具', source: 'synthetic invoice counterexample', kind: 'adversarial', group: 'invoice-confirmation', provenance: 'Synthetic explicit negation.', catalog: 'current', initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: 'carrier', code: '/PTGRJP2' } }, steps: [{ text: '還沒輸入完，不要送出', sameCart: true, phase: 'checkout_invoice', checkoutStarts: 0, forbidden: '已確認發票資料|付款成功' }] },
]

const invoiceKinds = [
  { key: 'C', method: 'carrier', code: '/PTGRJP2', invalid: '/PT' },
  { key: 'N', method: 'citizen', code: 'AB12345678901234', invalid: 'AB123' },
  { key: 'T', method: 'tax-id', code: '12345678', invalid: '123' },
] as const
const confirmationPhrases = ['確認', '送出', '輸入完成', '已經輸入', '好了，繼續', '資料沒問題', '就用這個']
const nonConfirmationPhrases = ['還沒輸入完，不要送出', '先不要送出', '我要先修改資料', '請問送出會怎樣？']

// Synthetic cross-product coverage; changing the wording never changes domain
// authorization. These extend the incident runner, not the frozen112 gold.
for (const kind of invoiceKinds) {
  for (const [index, text] of confirmationPhrases.entries()) {
    incidentConversationScripts.push({
      id: `I03-${kind.key}-P${index + 1}`,
      title: `${kind.method}確認語意：${text}`,
      source: 'Nov2 requested three invoice kinds and semantic equivalents',
      kind: 'functional',
      group: 'invoice-kind-confirmation',
      provenance: 'Synthetic valid visible draft; no historical replay claim.',
      catalog: 'current',
      initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: kind.method, code: kind.code } },
      steps: [{ text, sameCart: true, phase: 'checkout_payment_select', checkoutStarts: 0, forbidden: '請繼續告訴我您的需求|已付款|付款成功' }],
    })
  }
  for (const [index, text] of [...nonConfirmationPhrases, '確認'].entries()) {
    incidentConversationScripts.push({
      id: `I03-${kind.key}-A${index + 1}`,
      title: `${kind.method}不送出：${text}`,
      source: 'Nov2 requested invoice refusal, incomplete input and modification coverage',
      kind: 'adversarial',
      group: 'invoice-kind-confirmation',
      provenance: 'Synthetic visible draft; last case has invalid input.',
      catalog: 'current',
      initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: kind.method, code: index === nonConfirmationPhrases.length ? kind.invalid : kind.code } },
      steps: [{ text, sameCart: true, phase: kind.method === 'tax-id' ? 'checkout_tax_id' : 'checkout_invoice', checkoutStarts: 0, forbidden: '已確認發票資料|已確認統編|付款成功' }],
    })
  }
}

// Report: this chat, Nov2 after deployment. These replay the observed wording
// through direct Main; the original client snapshot/value remains unknown.
for (const kind of invoiceKinds) {
  const ready = kind.method === 'carrier' ? '載具填好了' : kind.method === 'citizen' ? '自然人憑證填好了' : '統編填好了'
  for (const [index, text] of [ready, '已經填寫完成', '送出', '確認送出', '先不要送出', '我要先修改資料'].entries()) {
    const confirms = index < 4
    incidentConversationScripts.push({
      id: `I04-${kind.key}-${confirms ? 'P' : 'A'}${confirms ? index + 1 : index - 3}`,
      channel: 'main-direct',
      title: `${kind.method}文字直接交給Main：${text}`,
      source: 'Nov2 user confirmed refreshed Kiosk and enabled invoice button; submission repeatedly chose carrier',
      kind: confirms ? 'functional' : 'adversarial',
      group: 'invoice-direct-main',
      provenance: 'Synthetic valid invoice draft; reproduces direct-Main channel and wording, not the unknown original client snapshot.',
      catalog: 'current',
      initial: { entry: 'ready', cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout', invoiceDraft: { method: kind.method, code: kind.code } },
      steps: [{ text, sameCart: true, phase: confirms ? 'checkout_payment_select' : kind.method === 'tax-id' ? 'checkout_tax_id' : 'checkout_invoice', checkoutStarts: 0, forbidden: confirms ? '已付款|付款成功' : '已確認發票資料|已確認統編|付款成功' }],
    })
  }
}
