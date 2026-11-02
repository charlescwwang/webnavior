import type { KioskActionCandidate, KioskDecisionState, KioskDecisionTrace } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'
import type { CheckoutSnapshot } from './domain/checkout-flow'
import type { MenuItem } from './domain/order-machine'
import type { SeatingContext } from './domain/seating'
import type { SemanticReplayCase as Scenario } from './experiments/semanticReplayCases'

import { errorMessageFrom } from '@moeru/std'
import { afterAll, describe, expect, it } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { createRecommendationInvitation } from '../../server/src/services/domain/kiosk-interaction-decision/contracts'
import { createChoiceRequest, readChoice } from '../../server/src/services/domain/kiosk-system-one/slm'
import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { semanticReplayCases as scenarios } from './experiments/semanticReplayCases'
import { createMenuToolRuntime } from './webmcp'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL
const variant = process.env.KIOSK_PROMPT_VARIANT ?? 'baseline'
const observations: Array<Record<string, unknown>> = []
const slmObservations: Array<Record<string, unknown>> = []

// Frozen instruction text from the reported route, without its customer state,
// dialogue, identifiers or model answers. Never read attachments during replay.
const baselineInstruction = `你是繁體中文餐飲 Kiosk 的有限語意決策器。

只判斷最後一句顧客語音，從本次提供的候選中選出最符合的一項。歷史對話、目前畫面與待答問題只用於理解語境，不代表顧客已同意任何操作。

候選描述定義本次可選的效果。不得創造候選、商品、target、參數或操作流程。target、數量、選項、合法性及執行由 Application 解析與驗證；你不執行工具，也不產生回答或釐清問題。

保留以下語意界線：

- SEARCH_MENU：找、查詢是否存在、瀏覽餐點或分類。「有水餃嗎」是查詢，不是訂購；只說「便當」等類別通常是瀏覽分類。
- SELECT_ITEM：查看或切換目前編輯對象，不加入購物車。「看水餃」「選水餃」屬於此類。
- ADD_ITEM：明確要求新增訂購。「我要水餃」「我想吃水餃」「水餃兩份」是新增；數量與客製設定是同一需求的內容，不拆成修改。
- SET_QUANTITY／SET_OPTION：修改既有對象。「改兩份」「水餃改成兩份」是修改，不是新增；「我要兩份水餃不要辣」仍是 ADD_ITEM。
- REMOVE_ITEM：明確要求移除既有購物車項目。「水餃不要了」是移除；食材排除要求不等於移除餐點。
- RECOMMEND：要求系統挑選餐點，且本次有限候選可以完整處理。查詢有哪些餐點不等於要求推薦。
- GREET：只向店員或本機打招呼。招呼加需求應選需求；對同伴打招呼或說話屬 IGNORE。
- INCOMPLETE：語句本身明顯尚未說完，例如「我要一份……」。完整需求缺少數量、選項或唯一 target，不屬於 INCOMPLETE。
- IGNORE：背景對話、對同伴說話、無關閒聊，或對已完成資訊回答單純表示了解，沒有提出服務需求。
- NEEDS_ASSISTANT：顧客確實提出需求，但需要比較、解釋、開放式推理，或本次候選不足以完整處理。餐飲需求不能因資料不足就選 IGNORE。
- MULTI_ACTION：同句要求兩個以上獨立操作，且單一候選無法完整表示。招呼不算獨立操作。

完整需求即使 target 不唯一，仍選本次提供的原意圖，由 Application 釐清；若沒有適合候選，選 NEEDS_ASSISTANT，不猜商品。

「好」「對」「不要」「這個」必須依目前有效問題、角色對話及真實 references 理解。回答操作問題只代表候選明示的效果，不代表額外操作或付款授權。

其他目前流程中的候選，依其描述與提供的狀態選擇。只能選本次實際提供的選項。`

// Experimental only: neither policy persistence nor production routing reads it.
const proposedInstruction = `只判斷最後一句顧客向店員要求的效果，只選本次提供的候選。歷史提供指代與答案語境，不延續成新的訂購授權；待答問題不是流程鎖。
品名、別名、分類命中只辨識談論對象，不證明顧客要求訂購。數量也可能出現在價格、份量等資訊問題中。
SEARCH_MENU：詢問販售、價格、餐點資訊或瀏覽分類，不新增訂購。「有水餃嗎」是查詢；想吃分類但沒有數量也是瀏覽。
ADD_ITEM：明確要求新增訂購，不是詢問資訊。「我要水餃」「水餃兩份」是新增；分类加數量可建立待選品項訂購。新增需求的數量與選項仍屬同一需求。
SELECT_ITEM：只查看或選取編輯對象，不新增。SET_QUANTITY／SET_OPTION：改既有對象。REMOVE_ITEM：移除既有餐點；食材排除不是移除餐點。
RECOMMEND：請系統挑選餐點；查有哪些不等於請推薦。「好」「對」「不要」「這個」依有效問題與真實 references 理解，同意、拒絕及回答值是不同效果。
GREET：只向店員問好；招呼加需求選需求。IGNORE：對同伴說話、背景話語，或對已完成資訊單純附和。INCOMPLETE：語句明顯未說完；完整需求缺數量、選項或唯一商品不是未說完。
MULTI_ACTION：同句要求多個獨立操作，單一候選無法完整表示。NEEDS_ASSISTANT：需要解釋、比較、開放推理或候選不足；餐飲需求不因資料不足而忽略。
其他流程依候選效果選擇。不發明商品、值、target、工具或流程；解析、釐清、合法性與執行由 Application 處理。`

const descriptions = {
  baseline: {
    'intent:search-menu': '查詢餐點、分類、成分／飲食條件，回答有哪些或有沒有。只說想吃某分類而未指定數量，是瀏覽分類，即使分類只有一道菜也不等於訂購。泛問販售內容或看全部每次最多展示三項推薦；指定品名、分類及食材條件仍精確查詢，不新增訂單。',
    'intent:add-item': '新增本句明確指定品名／店家別名或有效上下文承接的餐點；分類加明確份數可建立待選品項訂購。只說想吃某分類但沒有數量是瀏覽，不因分類只剩一項就訂購。品項歧義由程式釐清，不自行挑選。',
  },
  proposal: {
    'intent:search-menu': '詢問販售、餐點資訊或瀏覽菜單，不新增訂購。品名查詢與食材／飲食條件由程式解析。想吃分類但未指定數量是瀏覽；泛問或看全部每次最多展示三項推薦。',
    'intent:add-item': '顧客明確要求新增訂購，才建立餐點項目；詢問販售、價格或份量不是訂購。品名／別名是對象證據，不是訂購授權。分類加明確訂購數量可建立待選品項；歧義由程式釐清，不自行挑選。',
  },
}

// Ordinary product names with entirely synthetic prices/data; no customer or
// merchant catalog is loaded. No gateway can submit an order or take payment.
const menu: MenuItem[] = [
  { id: 'noodle', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵', price: 100 },
  { id: 'bento', name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', price: 90 },
  { id: 'chicken', name: '椒麻雞便當', category: '便當', price: 95 },
  { id: 'dumplings', name: '水餃', category: '點心', price: 60 },
  { id: 'tea', name: '紅茶', category: '飲料', price: 20 },
].map(item => ({ ...item, description: '人工測試餐點', imageUrl: '', recommendationTags: [], optionGroups: [] }))

async function prepare(scenario: Scenario) {
  let checkout: CheckoutSnapshot | undefined
  let revision = 0
  let seating: SeatingContext = { revision: 0, ready: false, choices: [] }
  const update = (next: CheckoutSnapshot) => {
    checkout = next
    revision++
    return next
  }
  const runtime = createMenuToolRuntime({
    menu,
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
    onMenuRequested: () => {},
    onMenuScroll: () => ({ status: 'MOVED', position: 100 }),
    ...(scenario.setup === 'party'
      ? { seating: {
          context: () => seating,
          refresh: async () => {},
          release: async () => {},
          reset: async () => {},
          reserve: async () => {},
          setPartySize: async (partySize: number) => { seating = { ...seating, partySize, revision: seating.revision + 1 } },
        } }
      : {}),
    checkout: {
      snapshot: () => checkout,
      revision: () => revision,
      paymentStatus: () => undefined,
      assertCanRestart: () => {},
      restart: () => { checkout = undefined },
      start: () => update(beginCheckout()),
      skipMembership: () => update(skipMembership(checkout!)),
      chooseInvoice: method => update(chooseInvoiceMethod(checkout!, method)),
      requestTaxId: () => update(requestTaxId(checkout!)),
      setTaxId: taxId => update(setTaxIdDraft(checkout!, taxId)),
      confirmInvoice: () => { throw new Error('Unexpected invoice confirmation in this fixture') },
      confirmTaxId: () => update(confirmTaxId(checkout!)),
      cancel: () => { checkout = undefined },
      selectPayment: async () => { throw new Error('Synthetic replay cannot initiate payment') },
    },
  })
  const messages: Array<{ role: 'assistant' | 'user', content: string }> = []
  if (scenario.setup !== 'empty' && scenario.setup !== 'invitation') {
    for (const [itemId, content] of [['bento', '便當一份'], ['dumplings', '再一份水餃']]) {
      const receipt = await runtime.invoke('order_add_item', { itemId }) as { customerMessage: string, pendingCustomerChoice: { questionId: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice.questionId })
      messages.push({ role: 'user', content }, { role: 'assistant', content: receipt.customerMessage })
    }
    if (scenario.setup === 'checkout' || scenario.setup === 'party') {
      const mode = scenario.setup === 'party' ? 'dine-in' : 'takeout'
      const receipt = await runtime.invoke('order_set_fulfillment', { mode }) as { customerMessage: string, pendingCustomerChoice: { questionId: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice.questionId })
      messages.push({ role: 'user', content: mode === 'dine-in' ? '內用' : '自取' }, { role: 'assistant', content: receipt.customerMessage })
    }
    if (scenario.setup === 'party') {
      await runtime.invoke('kiosk_fast_path_context', { transcript: '有麵嗎？' })
      const receipt = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu' }) as { customerMessage: string }
      await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage })
      messages.push({ role: 'user', content: '有麵嗎？' }, { role: 'assistant', content: receipt.customerMessage })
    }
  }
  const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript: scenario.transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
  if (scenario.setup === 'invitation') {
    snapshot.waitingFor = createRecommendationInvitation('SYNTHETIC_INVITATION', Date.now())
    messages.push({ role: 'assistant', content: snapshot.waitingFor.question })
  }
  return { messages, runtime, snapshot }
}

describe('synthetic replay fixture contracts', () => {
  it.each(scenarios)('$id has a legal expected effect before contacting Jev', async (scenario) => {
    const { snapshot, runtime } = await prepare(scenario)
    if (scenario.expected.startsWith('intent:'))
      expect(snapshot.candidates.map(candidate => candidate.id)).toContain(scenario.expected)
    if (scenario.setup === 'party')
      expect(snapshot.waitingFor?.purpose).toBe('party-size')
    if (scenario.setup === 'checkout')
      expect(snapshot.waitingFor?.purpose).toBe('checkout-entry')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: scenario.setup === 'empty' || scenario.setup === 'invitation' ? 0 : 2 } })
  })
})

describe.skipIf(process.env.KIOSK_SLM_MENU !== '1')('staged SLM and real isolated Menu effects', () => {
  afterAll(() => {
    for (const observation of slmObservations)
      process.stdout.write(`${JSON.stringify({ semanticSlmSummaryRow: true, ...observation })}\n`)
  })

  it.each(scenarios)('$id [$partition]', async (scenario) => {
    const baseURL = process.env.KIOSK_SLM_URL ?? 'http://127.0.0.1:12434/engines/v1'
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
      throw new Error('SLM Menu replay requires a local endpoint')
    const { snapshot, messages, runtime } = await prepare(scenario)
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: { itemCount: number } }
    let requests = 0
    const started = Date.now()
    const decision = await decideInteraction({ routing: 'staged', candidates: snapshot.candidates, decisionState: snapshot, transcript: scenario.transcript, conversation: { messages }, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke: async (state, questions) => {
      const key = Object.keys(questions)[0]!
      const request = createChoiceRequest(process.env.KIOSK_SLM_MODEL ?? 'huggingface.co/unsloth/qwen3.5-4b-gguf:latest', state, questions[key]!)
      requests++
      const response = await fetch(`${baseURL.replace(/\/+$/u, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(35_000) })
      if (!response.ok)
        throw new Error(`SLM HTTP ${response.status}`)
      return { selectionMode: 'unscored', answers: { [key]: { choice: readChoice(await response.json(), request) } } }
    } })
    const actual = decision.kind === 'FAST_ACTION' ? decision.actionId : decision.kind
    let receipt: unknown
    let executionError: string | undefined
    try {
      if (decision.kind === 'FAST_ACTION')
        receipt = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId })
    }
    catch (error) {
      // A domain refusal is evidence too. Retain the selected route and final
      // cart before failing this case; do not drop it from the complete report.
      executionError = errorMessageFrom(error) ?? 'EXECUTION_REJECTED'
    }
    const after = await runtime.invoke('cart_get', { display: false }) as { cart: { itemCount: number } }
    slmObservations.push({ id: scenario.id, expected: scenario.expected, actual, reason: decision.reason, requests, elapsedMs: Date.now() - started, cartBefore: before.cart.itemCount, cartAfter: after.cart.itemCount, receipt, executionError })
    // Keep strict original intent gold, including cases now safely handed to
    // Main. A handoff is not a demonstrated completion of that customer task.
    expect(actual).toBe(scenario.expected)
    expect(executionError).toBeUndefined()
    if (['intent:search-menu', 'intent:select-item', 'intent:view-cart', 'IGNORE', 'INCOMPLETE'].includes(scenario.expected))
      expect(after.cart.itemCount).toBe(before.cart.itemCount)
  }, 180_000)
})

describe.skipIf(!replayUrl)('synthetic semantic prompt comparison', () => {
  afterAll(() => {
    // A single complete report retains passing-case metrics as well as errors;
    // reporters may otherwise hide console output belonging to passing tests.
    for (const result of observations)
      process.stdout.write(`${JSON.stringify({ semanticSummaryRow: true, ...result })}\n`)
  })
  it.each(scenarios)('$id [$partition]', async (scenario) => {
    expect(['baseline', 'candidate', 'instruction', 'proposal']).toContain(variant)
    const { snapshot, messages, runtime } = await prepare(scenario)
    const changes = variant === 'candidate' || variant === 'proposal' ? descriptions.proposal : descriptions.baseline
    const candidates = snapshot.candidates.map(candidate => ({ ...candidate, description: changes[candidate.id as keyof typeof changes] ?? candidate.description }))
    const calls: Array<{ durationMs: number, model?: string, questions: string[] }> = []
    const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const started = performance.now()
      const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, questions }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      const payload = await response.json() as { answers?: Record<string, unknown>, model?: string }
      calls.push({ durationMs: Math.round(performance.now() - started), model: payload.model, questions: Object.keys(questions) })
      return payload
    }
    const started = performance.now()
    const result = await decideInteraction({ candidates, decisionState: snapshot, conversation: { messages }, transcript: scenario.transcript, includeTrace: true, invoke, policy: { decisionInstruction: variant === 'instruction' || variant === 'proposal' ? proposedInstruction : baselineInstruction, storeInstruction: '' } })
    const actual = result.kind === 'FAST_ACTION' ? result.actionId : result.kind
    const trace = result.trace as KioskDecisionTrace | undefined
    const route = trace?.rawAnswer as { choice?: string, confidence?: number } | undefined
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: { itemCount: number } }
    // Execute only inside this isolated, gateway-free runtime. This detects a
    // confidently wrong read→add decision that passes domain authorization.
    if (result.kind === 'FAST_ACTION')
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: result.actionId, ...(result.ingredientFilters ? { ingredientFilters: result.ingredientFilters } : {}) })
    const after = await runtime.invoke('cart_get', { display: false }) as { cart: { itemCount: number } }
    const afterState = await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
    const observation = { semanticReplay: true, variant, id: scenario.id, partition: scenario.partition, expected: scenario.expected, actual, reason: result.reason, route: route ? { choice: route.choice, confidence: route.confidence } : undefined, relation: trace?.questionRelation, filterRequirement: trace?.filterRequirement, filterPresence: trace?.filterPresence, ingredientAnswers: trace?.ingredientAnswers, phaseBefore: snapshot.phase, phaseAfter: afterState.phase, cartBefore: before.cart.itemCount, cartAfter: after.cart.itemCount, modelCalls: result.modelCalls, modelQuestions: result.modelQuestions, durationMs: Math.round(performance.now() - started), calls }
    observations.push(observation)
    console.info(JSON.stringify(observation))
    expect(before.cart.itemCount).toBe(scenario.setup === 'empty' || scenario.setup === 'invitation' ? 0 : 2)
    expect(actual).toBe(scenario.expected)
    if (['intent:search-menu', 'intent:select-item', 'intent:view-cart', 'IGNORE', 'INCOMPLETE'].includes(scenario.expected)) {
      expect(after.cart.itemCount).toBe(before.cart.itemCount)
      expect(afterState.phase).toBe(snapshot.phase)
    }
  }, 120_000)
})
