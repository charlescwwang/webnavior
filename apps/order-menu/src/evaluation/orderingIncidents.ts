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
    id: 'reported-20261103-background-service-clarification-loop',
    source: 'User report Nov3; read-only production ASR, reply and recovery telemetry retained privately; utterance13/15/52 correlate by utteranceId, not timestamp adjacency',
    utterances: ['判斷的話就是回答出來的東西', '它卻出現了第四個字', '我... 而且它是一個...', '資源放上去', '然後也設計掉了一個燈', '這邊雙區統統使用電子蓋', '讓他查出來的東西非常的多'],
    observed: 'Unrelated speech repeatedly received 請說明您想查詢的餐點或要做的操作，我才能接著協助。 or another service clarification. Recovery for utterance13/15/52 returned admission=uncertain, disposition=abstain, yet the program renewed SERVICE_CLARIFICATION. A valid cue bypasses ordinary Jev admission and uses Main review directly. Other recovery rounds did correctly return background/ignore. Follow-up read of the same whole session found68 assistant replies (47 service clarifications,20 verified replies,1 other) over about13minutes. Background technical speech about 電子蓋 received a menu-specific clarification. The real context projector retained21 user turns and68 assistant turns; its last12 messages contained9 assistant messages and3 user messages, including orphan clarification prompts.',
    gaps: ['IN PROGRESS: admission/history fixes and synthetic provider probes exist; final complete acceptance is still pending. Required boundary: unconfirmed service scope must remain silent; confirmed vague service requests may clarify, and valid contextual short answers must keep working.', 'The excerpt contains only the latest250 entries, not the whole session. 資源放上去 has an observed reply but no matching recovery event in this excerpt; do not assign an adjacent utterance recovery to it.', 'Ignored speech is not fully archived as conversational text, so archived response counts cannot establish the percentage of all captured speech accepted. The context is bounded to12messages/4000characters; the confirmed issue is polluted content, not proven unbounded model-token growth.', 'Existing unit expectation explicitly accepts SERVICE_CLARIFICATION for uncertain/abstain with an active cue. It proves no operation, but omits the required silence boundary. Synthetic provider scripts are linked; exploratory passes do not establish final complete acceptance.'],
    syntheticScripts: ['B01-J-L1', 'B01-J-L2', 'B02-J-L1'],
  },
  {
    id: 'reported-20261102-large-quantity-rejected',
    source: 'User report Nov2; private read-only field transcript and rejected tool receipt retained',
    utterances: ['那我要200份招牌便當、200份排骨便當'],
    observed: 'Main called order_add_item with quantity200 for the signature bento. Tool validation rejected it before execution because maximum20; subsequent clarification was rejected as unverified-reply. No bulk meal was added; ordering one pork-chop bento afterward succeeded.',
    gaps: ['User also described a 200/100-portion variant; the captured actual utterance was 200/200. User selected retaining the20 limit. New synthetic Q01 scripts separately cover explicit current-state preconditions.'],
    syntheticScripts: ['Q01-M-F1', 'Q01-J-F1', 'Q01-M-A1', 'Q01-J-A1'],
  },
  {
    id: 'reported-20261102-checkout-navigation-confirmation',
    source: 'User-confirmed Nov2 14:51–14:58 attempt; private read-only production transcript and tool receipts retained',
    utterances: ['幫我打開購物車', '我要自取', '確認', '返回上一頁', '回到訂單頁面'],
    observed: 'Open-cart returned acknowledgement without an effect. Confirmation of return-and-change-to-takeout called checkout_choose_invoice(carrier). Return requests read history/cart and remained on invoice; original meals and dine-in remained. Additional meal succeeded and is not classified as a failed addition.',
    gaps: ['Browser visuals are not in the server trace; synthetic screen-owner and browser checks are separate from the captured evidence.'],
    syntheticScripts: ['N01-M-F1', 'N01-J-F1', 'N01-M-A1', 'N01-J-A1', 'N01-M-V1', 'N01-J-V1', 'N01-M-R1', 'N01-J-R1'],
  },
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
  channel?: 'main-direct' | 'jev-main'
  initial: ConversationScript['initial'] & { checkout?: boolean, invoiceDraft?: { method: 'carrier' | 'citizen' | 'tax-id', code: string } }
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

// Nov2 live navigation failures: both direct Main and normal Jev→Main routing.
// Seeded invoice preconditions are explicit; these are not full historical replays.
for (const channel of ['main-direct', 'jev-main'] as const) {
  const key = channel === 'main-direct' ? 'M' : 'J'
  const base = {
    channel,
    source: 'reported-20261102-checkout-navigation-confirmation',
    group: 'checkout-navigation',
    provenance: 'Synthetic invoice entry with retained dine-in and one meal; actual screen owner is observed.',
    catalog: 'current' as const,
    initial: { entry: 'ready' as const, cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'dine-in' as const, checkout: true },
  }
  for (const [index, text] of ['確認', '好', '可以，就改自取'].entries()) {
    incidentConversationScripts.push({ ...base, id: `N01-${key}-F${index + 1}`, kind: 'functional', title: `結帳改自取後回答：${text}`, steps: [
      { text: '我要自取', sameCart: true, fulfillment: 'dine-in', phase: 'pending_confirmation', purpose: 'operation-confirmation' },
      { text, sameCart: true, fulfillment: 'takeout', phase: 'ordering', screen: 'cart_review', forbidden: '已選擇手機載具|付款成功' },
    ] })
  }
  incidentConversationScripts.push({ ...base, id: `N01-${key}-A1`, kind: 'adversarial', title: '取消改自取，保留內用結帳', steps: [
    { text: '我要自取', sameCart: true, phase: 'pending_confirmation', purpose: 'operation-confirmation' },
    { text: '取消，還是內用', sameCart: true, fulfillment: 'dine-in', phase: 'checkout_invoice', screen: 'checkout', forbidden: '已選擇手機載具|已設為自取' },
  ] })
  incidentConversationScripts.push({ ...base, initial: { ...base.initial, checkout: false }, id: `N01-${key}-V1`, kind: 'functional', title: '實際打開購物車', steps: [
    { text: '幫我打開購物車', sameCart: true, screen: 'cart_review' },
  ] })
  for (const [index, text] of ['回到訂單頁面', '返回上一頁'].entries()) {
    incidentConversationScripts.push({ ...base, id: `N01-${key}-R${index + 1}`, kind: 'functional', title: `發票入口：${text}`, steps: [
      { text, sameCart: true, fulfillment: 'dine-in', phase: 'ordering', screen: 'cart_review', forbidden: '請選擇手機載具' },
    ] })
  }
}

// Nov2 quantity-limit incident: keep20, no truncation/splits; legal siblings may be added.
for (const channel of ['main-direct', 'jev-main'] as const) {
  const key = channel === 'main-direct' ? 'M' : 'J'
  const base = {
    channel,
    source: 'reported-20261102-large-quantity-rejected',
    group: 'quantity-limit',
    provenance: 'Synthetic existing dumplings cart; explicit counts and actual runtime cart/reply are verified.',
    catalog: 'current' as const,
    initial: { entry: 'ready' as const, cart: [{ itemId: 'dumplings', quantity: 1 }], fulfillment: 'takeout' as const },
  }
  for (const [index, text] of ['那我要200份招牌便當、200份排骨便當', '排骨便當200份，招牌便當100份', '兩百份招牌便當、一百份排骨便當'].entries()) {
    incidentConversationScripts.push({ ...base, id: `Q01-${key}-F${index + 1}`, kind: 'functional', title: `超量保留原訂單：${text}`, steps: [
      { text, sameCart: true, phase: 'ordering', reply: '20', forbidden: '已加入|已將.+加入|尚未完成|無法回覆' },
      { text: '那改成排骨便當一份', cart: [{ itemId: 'dumplings', quantity: 1 }, { itemId: 'fried-pork-chop-bento', quantity: 1 }], phase: 'ordering' },
    ] })
  }
  for (const [index, text] of ['排骨便當一份，再加200份招牌便當', '招牌便當200份，再加一份排骨便當'].entries()) {
    incidentConversationScripts.push({ ...base, id: `Q01-${key}-A${index + 1}`, kind: 'adversarial', title: `合法與超量混合：${text}`, steps: [
      { text, cart: [{ itemId: 'dumplings', quantity: 1 }, { itemId: 'fried-pork-chop-bento', quantity: 1 }], phase: 'ordering', reply: '20', forbidden: '尚未完成|無法回覆' },
    ] })
  }
  incidentConversationScripts.push({ ...base, id: `Q01-${key}-B1`, kind: 'functional', title: '20份合法，改成21份保留20份', steps: [
    { text: '排骨便當20份', cart: [{ itemId: 'dumplings', quantity: 1 }, { itemId: 'fried-pork-chop-bento', quantity: 20 }] },
    { text: '排骨便當改成21份', sameCart: true, reply: '20', forbidden: '已將.+21|尚未完成' },
  ] })
  incidentConversationScripts.push({ ...base, id: `Q01-${key}-B3`, kind: 'adversarial', title: '否定超量並改成一份仍可正常點餐', steps: [
    { text: '不要200份排骨便當，改成一份排骨便當就好', cart: [{ itemId: 'dumplings', quantity: 1 }, { itemId: 'fried-pork-chop-bento', quantity: 1 }], forbidden: '每種餐點單次最多|這次超量' },
  ] })
  incidentConversationScripts.push({ ...base, id: `Q01-${key}-B2`, kind: 'adversarial', title: '200元是預算，不是200份', steps: [
    { text: '我有200元，可以吃什麼', sameCart: true, nonempty: true, maxPrice: 200, forbidden: '每種餐點單次最多|這次超量' },
  ] })
}

// Report: reported-20261103-background-service-clarification-loop. These are
// synthetic conversation sequences, not a replay of the private full session.
for (const [index, background] of [
  ['小王，你昨天看什麼電影？', '它卻出現了第四個字', '判斷的話就是回答出來的東西', '我是在跟旁邊的人說程式的問題', '這段電子蓋的技術資料你回去再看'],
  ['小李，我們待會開會要看這筆訂單的程式紀錄', '他的資訊給得非常非常的細', '然後也設計掉了一個燈', '我不是在點餐，我在跟同事討論測試', '你先跟小王討論昨天的電影'],
].entries()) {
  incidentConversationScripts.push({
    id: `B01-J-L${index + 1}`,
    title: '連續背景插話後仍能完成點餐',
    source: 'reported-20261103-background-service-clarification-loop',
    kind: 'adversarial',
    group: 'background-admission',
    catalog: 'current',
    provenance: 'Synthetic background sequences mixed with real service requests; expected silence is human-authored, not model-judged.',
    initial: { entry: 'ready', cart: [] },
    steps: [
      { text: '我想請你幫忙，但我還沒有說清楚要做什麼', sameCart: true, reply: '什麼|哪|查詢|說明|說一次' },
      ...background.map(text => ({ text, sameCart: true, silentOnly: true })),
      { text: '我要水餃', sameCart: true, purpose: 'item-configuration' },
      { text: '小王，我剛剛說的是電影裡的水餃，不是在跟機器點餐', sameCart: true, silentOnly: true },
      { text: '兩份', cart: [{ itemId: 'dumplings', quantity: 2 }] },
      { text: '我是在跟同事說電子蓋，不是問餐點', sameCart: true, silentOnly: true },
      { text: '我要內用', sameCart: true, fulfillment: 'dine-in' },
    ],
  })
}

incidentConversationScripts.push({
  id: 'B02-J-L1',
  title: '沒有服務追問時的背景談話與恢復點餐',
  source: 'reported-20261103-background-service-clarification-loop',
  kind: 'adversarial',
  group: 'background-admission',
  catalog: 'current',
  provenance: 'Synthetic sequence with no initial service cue; original reported snippets are diagnostic evidence, not a complete historical replay.',
  initial: { entry: 'ready', cart: [] },
  steps: [
    ...['判斷的話就是回答出來的東西', '它卻出現了第四個字', '我... 而且它是一個...', '資源放上去', '然後也設計掉了一個燈', '這邊雙區統統使用電子蓋', '讓他查出來的東西非常的多'].map(text => ({ text, sameCart: true, silentOnly: true })),
    { text: '我要排骨便當一份', cart: [{ itemId: 'fried-pork-chop-bento', quantity: 1 }] },
    { text: '小王，我們的程式裡面內用跟自取那一頁你再看一下', sameCart: true, silentOnly: true },
    { text: '內用', sameCart: true, fulfillment: 'dine-in' },
  ],
})

/** Deferred by the user on Nov3; retain frozen gold and failures without counting a pass. */
export const deferredConversationScripts = [{
  id: 'D04',
  reason: '使用者暫緩「幫我那個，那個，先不要變更」上下文挑戰；保留原金標與失敗紀錄，整條鏈不列本次阻擋項目，也不算通過。',
}] as const

/** User-confirmed current behavior; the original C15-A1 gold remains historical evidence. */
export const supersededConversationScripts = [{
  id: 'C15-A1',
  replacementId: 'B03-J-A1',
  confirmedAt: '2026-11-04',
  reason: '使用者確認：仍無法辨認目標的重複回答，保留訂單並安靜等待講明品名，不反覆追問。',
}] as const

incidentConversationScripts.push({
  id: 'B03-J-A1',
  title: '重複未明指涉保持安靜，講明品名後接續訂購',
  source: 'user-20261104-unbound-reference-wait',
  kind: 'adversarial',
  group: 'background-admission',
  catalog: 'current',
  provenance: 'User-confirmed replacement for C15-A1; the original frozen gold and failed attempts are retained separately.',
  initial: { entry: 'ready', cart: [] },
  steps: [
    { text: '我要那個', sameCart: true },
    { text: '剛才說的那個', sameCart: true, silentOnly: true },
    { text: '我明確要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }] },
  ],
})

// Report: Nov4 distinction between service reference, uncertain speech and companion talk.
incidentConversationScripts.push({
  id: 'B04-J-F1',
  title: '相同其他問句在有效菜單對話與同伴聊天中有不同對象',
  source: 'user-20261104-silence-is-not-admission',
  kind: 'adversarial',
  group: 'background-admission',
  catalog: 'current',
  provenance: 'Synthetic counterpart sequence; verifies service continuation without assuming any purchase authorization.',
  initial: { entry: 'ready', cart: [] },
  steps: [
    { text: '請推薦一百元以下的餐點', sameCart: true, nonempty: true, maxPrice: 100 },
    { text: '有其他的嗎', sameCart: true, maxPrice: 100, forbidden: '已加入|已付款' },
    { text: '小王，有其他的嗎', sameCart: true, silentOnly: true },
    { text: '資源放上去', sameCart: true, silentOnly: true },
    { text: '我要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }] },
  ],
}, {
  id: 'B04-J-A1',
  title: '沒有可用前文的其他問句不猜商品，明確點餐後可恢復',
  source: 'user-20261104-silence-is-not-admission',
  kind: 'adversarial',
  group: 'background-admission',
  catalog: 'current',
  provenance: 'Synthetic unbound-reference control; bounded clarification or uncertainty may wait without inventing a menu target.',
  initial: { entry: 'ready', cart: [] },
  steps: [
    { text: '有其他的嗎', sameCart: true, shown: 'empty', silentAllowed: true, forbidden: '已加入|已付款' },
    { text: '小王，有其他的嗎', sameCart: true, silentOnly: true },
    { text: '我要水餃一份', cart: [{ itemId: 'dumplings', quantity: 1 }] },
  ],
})
