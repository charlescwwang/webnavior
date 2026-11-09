import type { SystemOneQuestion } from '../kiosk-system-one'
import type { KioskInteractionDecision } from './contracts'
import type { DecisionInput, KioskActionCandidate, KioskDecisionTrace } from './index'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'

import { normalizeTranscript } from './context'
import { decisionQuestionBudget } from './contracts'
import { defaultDecisionInstruction, serviceDomainInstruction } from './prompt'

/** First gate concerns service admission only, never a tool or item selection. */
export const admissionQuestion: SystemOneQuestion = {
  type: 'choice',
  instructions: `${serviceDomainInstruction}只判斷最後一句是否向本機／店員提出服務互動。先前在點餐或剛問過問題，不表示之後每句都在回答本機；必須是本句的服務請求，或能承接有效問題的回答。背景敘述不因緊接問句就變成含糊求助。無法確認對象選UNCERTAIN。有效問題與近期對話只幫助理解省略回答，不授權操作；沒有匹配品名不等於背景。`,
  criteria: {
    SERVICE: '向本機提出問題或要求（包含須由助手說明無法協助的職責外問題），或回答有效服務問題；對本機操作的暫停／拒絕也是服務指示，含招呼仍選此項。',
    GREET: '只向本機問好，沒有其他需求；好、嗯、謝謝等附和不是問好。',
    BACKGROUND: '對同伴說話、沒有向本機提出需求的背景聊天或附和；暫停／拒絕本機操作不是背景。',
    UNCERTAIN: '不能確認是否向本機提出服務需求；不猜操作。',
  },
}

const purposeQuestion = {
  type: 'choice',
  instructions: '服務入場已通過，但不代表任何操作已獲授權。依完整原句只選需求形態，不選商品。多品項、換餐、取消又更正用餐方式或多個獨立效果，交 HANDOFF，不能只處理第一項。新增同一餐點的份數與規格仍是同一項。此處區分的是工具需求，不是句子是否為問句；單純請系統挑選推薦、沿用現有條件再選其他餐點、或重新展示推薦，都屬SINGLE。參考目前展示與既有條件理解承接語，不把沒有新增條件的推薦當成比較／解釋餐點。QUERY僅用於本句另有需完整保留的偏好修改、條件、比較或說明需求。',
  criteria: {
    SINGLE: '明確單一操作或簡單查詢：查已知品名／分類、全菜單；請系統推薦、沿用條件換其他推薦、重顯推薦；加點、修改、內外帶或畫面導航。推薦即使以問句表達，沒有新增條件仍屬此項。',
    ANSWER: '只回答目前有效問題的有限選項；沒有提出其他需求。',
    QUERY: '本句新增或修改食物偏好、排除、飲食／價格條件，或明確要求比較／解釋餐點，需要保留完整需求。單純推薦、沿用既有條件換批或重顯推薦不屬此項。',
    HANDOFF: '多項獨立需求、換餐、核對漏單、詢問本機／店家資訊、流程提問，或有限操作無法完整處理。',
    INCOMPLETE: '向本機的語句明顯還沒說完；完整需求缺份數、品名匹配或必填規格不是此項。',
    UNCERTAIN: '確定有服務需求，但還不能確定意思；先釐清，不猜。',
  },
} satisfies SystemOneQuestion

const families: Record<string, { description: string, accepts: (id: string) => boolean }> = {
  MENU: { description: '查餐點／分類／全菜單、推薦、重新展示；停止看目前推薦並返回全部菜單／主畫面，或移動菜單位置；不改訂單。', accepts: id => /^intent:(?:search-(?:all-)?menu|recommend(?:-more)?|show-recommendations|return-menu|scroll-menu:)/u.test(id) },
  ITEM: { description: '查看或設定單一道餐點、加點、改既有份數或規格、移除有對象的已點餐點；停止看推薦不屬此項。', accepts: id => /^intent:(?:select-item|add-item|set-quantity|set-option|remove-item)$/u.test(id) },
  CART: { description: '查看購物車、清空整單或開始結帳。', accepts: id => /^intent:(?:view-cart|clear-cart|start-checkout)$/u.test(id) },
  SERVICE: { description: '選內用／外帶、用餐人數、選桌或略過自願電話登記。', accepts: id => /^intent:(?:set-fulfillment:|set-party-size$|reserve-tables:|skip-customer-entry$)/u.test(id) },
  CHECKOUT: { description: '目前結帳畫面的會員、發票、統編、付款方式或取消結帳。選方式不代表付款成功。', accepts: id => /^intent:(?:skip-membership|choose-invoice:|request-tax-id|set-tax-id|confirm-tax-id|confirm-invoice|select-payment:|cancel-checkout)/u.test(id) },
}

// Descriptions name one semantic distinction. Execution details and revisions
// remain in the browser; model-facing text does not repeat the safety protocol.
const descriptions: Record<string, string> = {
  'intent:search-menu': '查詢品名、分類或販售內容；已有瀏覽條件時找其他仍沿用條件，不解除限制。不訂購。',
  'intent:search-all-menu': '明確要求完整／全部菜單，解除原瀏覽條件；只問其他不選，不訂購。',
  'intent:select-item': '只查看或切換目前編輯的餐點，不新增。',
  'intent:add-item': '新增訂購一款餐點；本次份數與規格屬同一新增需求。',
  'intent:set-quantity': '修改既有餐點數量，不新增品項。',
  'intent:set-option': '修改既有餐點客製選項。',
  'intent:remove-item': '只取消既有特定餐點，不是換餐。',
  'intent:recommend': '請本機挑選一批推薦餐點。',
  'intent:recommend-more': '換其他推薦，排除剛展示的一批。',
  'intent:show-recommendations': '重新顯示原本那批推薦。',
  'intent:return-menu': '返回全部菜單／主畫面；目前僅展示推薦時，不想繼續看推薦也是此項。保留訂單，不刪除已點餐點。',
  'intent:scroll-menu:up': '看目前菜單上方、較前段的內容。',
  'intent:scroll-menu:down': '看目前菜單下方、較後段的內容。',
  'intent:view-cart': '查看或核對購物車；已有餐點後表示點完、結束選餐，先核對訂單再問下一步，不修改、不付款或送單。',
  'intent:clear-cart': '明確取消整張訂單、清空購物車。',
  'intent:start-checkout': '明確要求開始結帳。',
  'intent:set-fulfillment:dine-in': '明確選擇或改為內用。',
  'intent:set-fulfillment:takeout': '明確選擇或改為外帶／自取。',
  'intent:skip-customer-entry': '略過自願電話登記，不留電話／會員，開始點餐。',
}

/**
 * Bounded semantic tree shared by Jev and label-only SLM. Each question has at
 * most six choices. Only a legal leaf may reach browser resolution; admission,
 * family labels and incomplete groups cannot authorize any operation.
 */
export async function decideStagedInteraction(input: DecisionInput): Promise<KioskInteractionDecision> {
  const transcript = normalizeTranscript(input.transcript)
  if (!transcript.normalized)
    return { kind: 'IGNORE' }
  const exchanges: NonNullable<KioskDecisionTrace['exchanges']> = []
  let calls = 0
  let admitted = false
  const backgroundMode = input.backgroundSpeechMode ?? 'off'
  let observedCalls = 0
  let backgroundObservation: { mode: string, choice?: string, failed?: boolean } = { mode: backgroundMode }
  let confidence: number | undefined
  let weakChoice = false
  let invalidChoice = false
  const live = input.decisionState?.waitingFor
  const question = live
  const state = JSON.stringify({
    customerUtterance: transcript.normalized,
    serviceMode: input.decisionState?.serviceMode,
    phase: input.decisionState?.phase,
    screen: input.decisionState?.interactionState?.screen,
    interactionState: input.decisionState?.interactionState,
    fulfillmentModes: input.decisionState?.fulfillmentModes,
    constraints: input.decisionState?.constraints,
    priceAmounts: input.decisionState?.priceEvidence?.amounts,
    waitingFor: question ? { questionId: question.questionId, requestId: question.requestId, purpose: question.purpose, question: question.question } : null,
    serviceClarification: input.decisionState?.serviceClarification,
    recentDialogue: input.conversation?.messages.slice(-4) ?? [],
    references: input.decisionState?.references ?? [],
    clarificationOffer: input.decisionState?.clarificationOffer,
    retainedRequests: input.decisionState?.retainedRequests,
    intentRecovery: input.decisionState?.intentRecovery,
    productResolution: input.decisionState?.productResolution,
    catalogEvidence: input.decisionState?.catalogEvidence,
    activeRequest: input.decisionState?.activeRequest,
    incompleteSpeech: input.decisionState?.incompleteSpeech,
    ...(input.review ? { review: input.review } : {}),
  })
  // Admission needs dialogue, not the available order operations. Keeping the
  // catalog/tool state out avoids making unrelated speech look like a task.
  const admissionState = JSON.stringify({
    customerUtterance: transcript.normalized,
    phase: input.decisionState?.phase,
    waitingFor: question ? { purpose: question.purpose, question: question.question } : null,
    serviceClarification: input.decisionState?.serviceClarification
      ? { question: input.decisionState.serviceClarification.question, sourceUtterance: input.decisionState.serviceClarification.sourceUtterance }
      : null,
    recentDialogue: input.conversation?.messages.slice(-4) ?? [],
  })
  const finish = (result: KioskInteractionDecision): KioskInteractionDecision => ({
    ...result,
    ...(question && ['recommendation-invitation', 'menu-return-invitation'].includes(question.purpose) && !result.answeredQuestionId
      && (result.kind === 'FAST_ACTION' || (result.kind === 'NEEDS_ASSISTANT' && ['NEW_REQUEST', 'MENU_QUERY', 'UNCERTAIN_FILTER'].includes(result.reason ?? '')))
      ? { supersededQuestionId: question.questionId }
      : {}),
    ...(confidence === undefined ? {} : { confidence }),
    ...(input.includeTrace ? { modelCalls: calls, modelQuestions: calls, trace: { backgroundObservation, rawTranscript: transcript.raw, transcript: transcript.normalized, candidateIntents: input.candidates, decisionState: state, exchanges } } : {}),
  })
  const handoff = (reason: KioskInteractionDecision['reason'] = 'UNCERTAIN_OPERATION') => finish({ kind: 'NEEDS_ASSISTANT', reason })
  const menuHandoff = () => handoff(input.decisionState?.priceEvidence ? 'UNCERTAIN_FILTER' : 'MENU_QUERY')
  async function choose(key: string, choice: SystemOneQuestion) {
    weakChoice = false
    if (calls - observedCalls >= Math.min(input.maxQuestions ?? decisionQuestionBudget, decisionQuestionBudget))
      throw new Error('Decision question budget exhausted')
    const questionState = key === 'admission' ? admissionState : state
    const startedAt = performance.now()
    calls++
    try {
      const response = await input.invoke(questionState, { [key]: choice })
      exchanges.push({ index: calls, state: questionState, questions: { [key]: choice }, answers: response.answers, durationMs: performance.now() - startedAt, status: 'answered' })
      const answer = response.answers?.[key] as { choice?: unknown, confidence?: unknown } | undefined
      if (!answer || typeof answer.choice !== 'string' || !Object.hasOwn(choice.criteria ?? {}, answer.choice)) {
        invalidChoice = true
        throw new Error('Invalid decision choice')
      }
      if (response.selectionMode === 'unscored') {
        // Strict SLM output validates a label, not a probability. Never fill a
        // synthetic confidence or borrow Jev's thresholds for this provider.
        if (answer.confidence !== undefined) {
          invalidChoice = true
          throw new Error('Unscored decision returned a confidence')
        }
      }
      else {
        if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
          invalidChoice = true
          throw new Error('Invalid scored decision confidence')
        }
        if (answer.confidence < 0.6) {
          weakChoice = true
          return undefined
        }
        confidence = Math.min(confidence ?? 1, answer.confidence)
      }
      return answer.choice
    }
    catch (error) {
      const exchange = exchanges.at(-1)
      if (exchange?.index === calls)
        exchange.status = 'failed'
      else
        exchanges.push({ index: calls, state: questionState, questions: { [key]: choice }, durationMs: performance.now() - startedAt, status: 'failed' })
      throw error
    }
  }
  async function completeMenuNavigation(candidate: KioskActionCandidate, answeredQuestionId?: string) {
    // Safe display is not proof of correct purpose: ordering every member of a
    // set must not collapse into merely displaying that set. Reuse a bounded
    // semantic check without treating navigation as order-mutation consent.
    const coverage = await choose('readCoverage', { type: 'choice', instructions: `核對本句完整需求是否僅由這個唯讀畫面效果完成：${descriptions[candidate.id] ?? candidate.description}。訂購集合中每款餐點不等於顯示集合，取消已點餐點也不等於離開畫面；如有這些其他目的須交接完整需求。`, criteria: { COMPLETE: '整句只要求這個瀏覽／返回效果，沒有未處理的購買、刪除或其他需求。', HANDOFF: '這個展示效果不能完成整句；還要求訂購、修改，或是另一個目的。', UNCERTAIN: '不能確認這個展示效果足夠。' } })
    return coverage === 'COMPLETE' ? finish({ kind: 'FAST_ACTION', actionId: candidate.id, ...(answeredQuestionId ? { answeredQuestionId } : {}) }) : handoff('NEW_REQUEST')
  }
  async function leaf(eligible: readonly KioskActionCandidate[], answeredQuestionId?: string): Promise<KioskInteractionDecision> {
    // Do not prune to the first N entries: a missing correct option is not a
    // model error. Large or unfamiliar groups go to Main with the whole request.
    if (!eligible.length || eligible.length > 5)
      return handoff()
    const selected = await choose('operation', {
      type: 'choice',
      instructions: '只選完整符合本句的單一效果。查詢不是訂購，新增餐點的份數不是修改舊餐點。不能因為出現品名或待答問題就推成同意；多項需求、換餐、不確定或缺少正確選項選 HANDOFF。目前有效問題正在問份數時，合法份數回答選對應份數候選，不因省略品名交接；候選仍保留同一道與既有規格。點餐單位說明候選可完整處理非份數的數量回答：保留同一道需求並追問份數，不需提供換算結果、不代表新增。',
      criteria: { ...Object.fromEntries(eligible.map(candidate => [candidate.id, input.decisionState?.serviceMode === 'table-service' && candidate.id === 'intent:start-checkout' ? '顧客確認本桌訂單後直接送出，不進行付款。' : descriptions[candidate.id] ?? candidate.description])), HANDOFF: '以上沒有一項能完整處理，或意思還不清楚；保留原句交接。' },
    })
    const candidate = eligible.find(candidate => candidate.id === selected)
    if (!candidate)
      return handoff()
    if (['intent:return-menu', 'intent:search-all-menu'].includes(candidate.id))
      return await completeMenuNavigation(candidate, answeredQuestionId)
    if (candidate.id === 'DECLINE_INVITATION')
      return finish({ kind: 'IGNORE', answeredQuestionId })
    const changesOrder = !candidate.id.endsWith(':unit-guidance') && !/^intent:(?:search-(?:all-)?menu|select-item|recommend(?:-more)?|show-recommendations|view-cart|return-menu|scroll-menu:)/u.test(candidate.id)
    if (changesOrder) {
      // A family/leaf is still a hypothesis. Keep communicative purpose and
      // whole-effect coverage independent, as in the existing cart guard: a
      // quantity-bearing question is not a buy, and one add cannot fulfill two
      // dishes. A live answer must also cover the full utterance; an old
      // checkout invitation cannot consume a new fulfillment correction.
      const request = await choose('operationRequest', { type: 'choice', instructions: '只判斷完整原句是在要求現在操作，還是在詢問／核對資訊。品名加份數的點單短句是操作；有份數的價格問題、詢問可否客製、核對先前漏單或詢問畫面狀態不是新增授權。目前有效問題的明確回答可以授權該問題列出的效果；但必須確認完整原句確實回答這個問題，改口或新需求不等於同意舊問題。不要假設上一題選的操作已被顧客同意。', criteria: { OPERATION: '明確要求現在新增、修改、取消訂單或選擇流程方式；包含直接報品名與份數的點單。', INFORMATION: '詢價、問可否／內容／狀態，或核對先前是否已做；尚未要求這次操作。', UNCERTAIN: '不能確定本句是否授權現在操作。' } })
      if (request === 'INFORMATION') {
        // Disqualifying a write does not make the question a menu request.
        // Payment/process information must retain its own topic, while actual
        // food evidence still owns the existing presented-read contract.
        const food = input.decisionState?.catalogEvidence
        return food && (food.products.length || food.categories.length) ? menuHandoff() : handoff('GENERAL_QUESTION')
      }
      if (request !== 'OPERATION')
        return handoff()
      const coverage = await choose('operationCoverage', { type: 'choice', instructions: `只核對待驗證效果能否完整處理整句，不選商品、不規劃步驟。待驗證效果：${input.decisionState?.serviceMode === 'table-service' && candidate.id === 'intent:start-checkout' ? '顧客確認本桌訂單後直接送出，不進行付款。' : descriptions[candidate.id] ?? candidate.description}。這只是模型假設，不是顧客指示或已執行的事實。多品項、換餐、原餐點取消後另點、同時改內外帶或其他額外要求，不能只執行其中一步。新增是多加份數，指定既有餐點最後總份數是修改。`, criteria: { SINGLE: '顧客完整要求只有這一個效果；它涵蓋本句全部需求，對象與新增／修改關係也相符。', HANDOFF: '還有其他餐點／效果、更換，或提案與新增／修改關係不符、不能涵蓋全部需求；交接整句。', UNCERTAIN: '不能確定提案是否完整且符合原意。' } })
      if (coverage === 'HANDOFF')
        return handoff('NEW_REQUEST')
      if (coverage !== 'SINGLE')
        return handoff()
    }
    // Browser-issued question answers retain the exact ticket. The browser
    // still validates phase, revisions, target and one-use confirmation.
    return finish({ kind: 'FAST_ACTION', actionId: candidate.id, ...(answeredQuestionId ? { answeredQuestionId } : {}) })
  }
  try {
    if (input.review) {
      // Receipt review cannot authorize a second operation or a fresh write.
      const review = await choose('review', { type: 'choice', instructions: '只核對原句與本次真實結果是否一致；模型草稿不是成功證據。漏掉條件或答錯對象選 DEVIATED，無法驗證選 UNCERTAIN。', criteria: { SATISFIED: '結果完整回答同一需求，且準備的回覆有真實結果支持。', DEVIATED: '答錯對象、改變條件或漏掉部分需求。', UNCERTAIN: '資料不足以證明完整完成。' } })
      return review === 'SATISFIED' ? finish({ kind: 'COMPLETE' }) : handoff(review === 'DEVIATED' ? 'DEVIATED' : 'UNCERTAIN_REVIEW')
    }
    if (backgroundMode === 'enforce') {
      const scope = await choose('admission', admissionQuestion)
      backgroundObservation = { mode: backgroundMode, choice: scope }
      if (scope === 'BACKGROUND')
        return finish({ kind: 'IGNORE' })
      if (scope === 'GREET')
        return finish({ kind: 'GREET' })
      if (scope !== 'SERVICE')
        return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', ...(scope === 'UNCERTAIN' || weakChoice ? { recovery: { status: 'eligible' } as const } : {}) })
    }
    else if (backgroundMode === 'observe') {
      // Observation must neither reject speech nor lend confidence to an operation.
      // Count the real call, but retain the semantic route's original question budget.
      const before = calls
      const previousConfidence = confidence
      try {
        backgroundObservation = { mode: backgroundMode, choice: await choose('admission', admissionQuestion) }
      }
      catch { backgroundObservation = { mode: backgroundMode, failed: true } }
      observedCalls += calls - before
      confidence = previousConfidence
      invalidChoice = false
      weakChoice = false
    }
    admitted = true
    // Recheck the current speaker/request before interpreting a service answer.
    // The review owns its relation to this cue, not an older Menu operation.
    const cue = input.decisionState?.serviceClarification
    if (cue && cue.contextKey === serviceContextKey(input.decisionState!))
      return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } })
    if (input.decisionState?.activeRequest) {
      const relation = await choose('requestRelation', { type: 'choice', instructions: '只判斷本句與進行中需求的關係，不規劃如何中斷或執行。', criteria: { FOLLOW_UP: '補充、更正或詢問同一個仍在處理的需求。', NEW_REQUEST: '獨立的新服務需求。', UNCERTAIN: '不能確認是否同一需求。' } })
      if (relation === 'FOLLOW_UP')
        return finish({ kind: 'FOLLOW_UP_ACTIVE' })
      if (relation !== 'NEW_REQUEST')
        return handoff()
    }
    if (input.decisionState?.incompleteSpeech && !input.decisionState.incompleteSpeech.related) {
      const relation = await choose('fragmentRelation', { type: 'choice', instructions: '上一個語音片段尚未說完；只判斷本句是否繼續同一需求，不拼接或執行。', criteria: { CONTINUE: '補上或更正尚未完成的同一需求。', NEW_REQUEST: '獨立完整的新需求。', UNCERTAIN: '無法確認關係。' } })
      if (relation === 'CONTINUE')
        return finish({ kind: 'CONTINUE_INCOMPLETE' })
      if (relation !== 'NEW_REQUEST')
        return handoff()
    }
    if (input.decisionState?.phase === 'customer_entry') {
      const phone = await choose('phone', { type: 'choice', instructions: backgroundMode === 'enforce' ? '電話登記是自願的，只判斷本句對目前入口的要求。再次核對說話對象與關閉的受詞：叫同伴操作他自己的電腦／其他視窗是BACKGROUND，即使上一題判為SERVICE也不能把其他物件改成電話登記。不從語音填電話、驗證會員或查菜單。依整句最後仍成立的選擇判斷，否定關閉／略過不能選SKIP。詢問可否略過不是同意略過；已撤回的點餐不是仍要下單。' : '只理解本句對目前自願電話登記的要求。明確要求略過本機登記選SKIP，保留登記選KEEP_ENTRY，詢問資訊選INFORMATION，尚未選擇登記方式的餐點需求選ENTRY_REQUIRED。關閉其他物件不是略過本機登記；沒有明確操作意思選UNCERTAIN。背景過濾未啟用，不分類背景或對象。', criteria: { SKIP: '向本機要求略過、不留電話／會員、直接開始點餐，或關閉目前自願電話登記；未指定其他對象或物件的單說關閉也是此項。否定關閉或關閉其他視窗不選。', KEEP_ENTRY: '不要關閉／不要略過登記，或要填寫電話；保持目前入口，不略過。', ENTRY_REQUIRED: '詢問餐點、推薦或提出仍有效的訂購，尚未選擇填電話或略過。', INFORMATION: '向本機詢問資訊（包含須說明服務限制的職責外問題）、電話用途或可否略過，沒有要求略過或操作。', ...(backgroundMode === 'enforce' ? { BACKGROUND: '叫同伴關閉他自己的電腦或其他視窗，或明確不是向本機要求操作電話登記的背景對話。' } : {}), UNCERTAIN: '確定有服務需求，但不能確定是否要略過。' } })
      if (backgroundMode === 'enforce' && phone === 'BACKGROUND')
        return finish({ kind: 'IGNORE' })
      if (phone === 'ENTRY_REQUIRED')
        return finish({ kind: 'CUSTOMER_ENTRY_REQUIRED' })
      if (phone === 'INFORMATION')
        return handoff('GENERAL_QUESTION')
      const skip = input.candidates.find(candidate => candidate.id === 'intent:skip-customer-entry')
      if (phone === 'SKIP' && skip)
        return finish({ kind: 'FAST_ACTION', actionId: skip.id, ...(question?.purpose === 'customer-entry' ? { answeredQuestionId: question.questionId } : {}) })
      return handoff()
    }
    // A presented navigation/recommendation invitation supplies a bounded read
    // question. Use the existing finite answer checkpoint directly; classifying
    // a bare assent as a fresh general-purpose request loses this correlation.
    // HANDOFF remains available for a new or compound demand, and this question
    // never offers a cart/checkout effect.
    if (question && ['recommendation-invitation', 'menu-return-invitation'].includes(question.purpose) && input.decisionState?.phase === 'ordering'
      && !input.decisionState.activeRequest && question.choices.some(choice => input.candidates.some(candidate => candidate.id === choice.id))) {
      const effect = question.purpose === 'recommendation-invitation' ? 'intent:recommend' : 'intent:return-menu'
      const answers = question.choices.filter(choice => (choice.id === effect && input.candidates.some(candidate => candidate.id === effect)) || choice.id === 'DECLINE_INVITATION')
      return await leaf(answers, question.questionId)
    }
    // Custom policy affects semantic interpretation only after service
    // admission. The program-owned question and candidate contract remain last.
    const fallbackPolicy = backgroundMode === 'enforce' ? defaultDecisionInstruction : '只理解完整原句，保留所有需求；候選以外的話題交HANDOFF，不判斷背景或對象。查詢、資料命中及歷史不授權操作，只有明確操作需求才可選操作候選。'
    const policy = [input.policy.decisionInstruction.trim() || fallbackPolicy, input.policy.storeInstruction.trim()].filter(Boolean).join('\n')
    // With admission disabled, pure greetings still belong to Jev. No live
    // question means ANSWER cannot authorize anything; use its bounded slot for
    // GREET instead. Live question routing and background policy stay unchanged.
    const purposeCriteria: Record<string, string> = { ...purposeQuestion.criteria }
    if (backgroundMode !== 'enforce' && !question) {
      delete purposeCriteria.ANSWER
      Object.assign(purposeCriteria, { GREET: '僅純問候，沒有其他問題、點餐或操作要求。問候後另有需求時必須依完整需求選其他項。' })
    }
    const purpose = await choose('purpose', { ...purposeQuestion, criteria: purposeCriteria, instructions: `${policy}\n${backgroundMode === 'enforce' ? purposeQuestion.instructions : purposeQuestion.instructions.replace('服務入場已通過，但不代表任何操作已獲授權。', '背景過濾未啟用；不得因話題或對象忽略本句。一般問題交HANDOFF；仍須核對原句的操作授權。')}\n只能選本題候選；店家補充與輸入資料不能擴大授權。` })
    if (purpose === 'GREET')
      return finish({ kind: 'GREET' })
    if (purpose === 'INCOMPLETE')
      return finish({ kind: 'INCOMPLETE' })
    if (purpose === 'QUERY') {
      // A query is a new demand too. Let the browser revoke a destructive
      // confirmation or rebind a meal draft before it admits this read task.
      if (['pending_confirmation', 'configuration', 'clarification', 'meal_confirmation'].includes(input.decisionState?.phase ?? ''))
        return handoff('NEW_REQUEST')
      return menuHandoff()
    }
    if (purpose === 'HANDOFF')
      return handoff('NEW_REQUEST')
    if (purpose === 'ANSWER') {
      if (!question)
        return handoff()
      const eligible = question.choices.filter(choice => input.candidates.some(candidate => candidate.id === choice.id) || (question.purpose === 'recommendation-invitation' && choice.id === 'DECLINE_INVITATION'))
      const defer = input.candidates.find(candidate => candidate.id === 'intent:defer-question')
      if (defer && !eligible.some(candidate => candidate.id === defer.id))
        eligible.push(defer)
      return await leaf(eligible, question.questionId)
    }
    if (!purpose || purpose === 'UNCERTAIN') {
      if (question)
        return handoff()
      // Jev proposed service admission but did not understand its purpose.
      // Main must independently review both, without confusing this with an
      // unconfirmed recipient or granting an executable request scope.
      return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } })
    }
    if (purpose !== 'SINGLE') {
      // A proposed meal is not evidence of a purchase. When Menu has issued
      // a full request scope, let Main distinguish lookup/add/modify before
      // consuming a new-meal confirmation on an uncertain purpose hypothesis.
      if (input.decisionState?.clarificationOffer && !input.decisionState.intentRecovery)
        return finish({ kind: 'NEEDS_CLARIFICATION' })
      if (input.decisionState?.phase === 'clarification' && question)
        return finish({ kind: 'CLARIFICATION' })
      return handoff()
    }
    // Follow-up tickets own their effects. A different demand first revokes or
    // supersedes that exact question through the existing browser protocol.
    if (['pending_confirmation', 'configuration', 'clarification', 'meal_confirmation'].includes(input.decisionState?.phase ?? ''))
      return handoff('NEW_REQUEST')
    // The finite leaf does not extract rich query conditions. Keep them intact
    // for Main rather than executing an unfiltered recommendation/search.
    const groups = Object.entries(families).filter(([, family]) => input.candidates.some(candidate => family.accepts(candidate.id)))
    if (!groups.length)
      return handoff('NEW_REQUEST')
    const family = await choose('family', { type: 'choice', instructions: '只判斷明確單一需求屬於哪個操作類別，不選商品。當前只在瀏覽／展示推薦，沒有未完成餐點或既有訂單餐點作為取消對象時，不再看推薦是MENU的返回全部菜單，不是ITEM的刪餐；推薦清單不是已點餐點。ITEM的移除須有既有餐點對象，不能把結束推薦當成清空訂單。不存在的操作、多項需求或無法確定選 HANDOFF。', criteria: { ...Object.fromEntries(groups.map(([id, family]) => [id, family.description])), HANDOFF: '沒有合適類別，或需要保留整句交給助手。' } })
    if (!family || !groups.some(([id]) => id === family))
      return handoff()
    if (family === 'MENU' && (input.decisionState?.priceEvidence || input.decisionState?.ingredientReferences?.length || input.decisionState?.dietaryReferences?.length || input.decisionState?.unavailableConditionReferences?.length))
      return menuHandoff()
    let eligible = input.candidates.filter(candidate => families[family]!.accepts(candidate.id))
    if (family === 'MENU' && eligible.length > 5) {
      const menu = await choose('menuPurpose', { type: 'choice', instructions: '只區分菜單需求。全部菜單不是其他推薦；換一批不是重顯舊推薦。結束推薦、不要再看推薦屬EXIT，不是查詢餐點。', criteria: { LOOKUP: '查品名、分類或販售內容、整份菜單。', RECOMMEND: '挑選推薦、換其他推薦或重顯推薦。', EXIT: '停止看本輪推薦或瀏覽，返回全部菜單／主畫面；不是取消已點餐點。', SCROLL: '繼續看目前菜單，但要移動畫面位置。', HANDOFF: '不能確定或需要其他處理。' } })
      if (!menu || menu === 'HANDOFF')
        return handoff()
      // EXIT is already a complete read-only leaf. Reclassifying it as an
      // operation makes a recommendation refusal compete with HANDOFF twice.
      // The browser still checks the issued candidate and domain revisions.
      if (menu === 'EXIT') {
        const candidate = eligible.find(candidate => candidate.id === 'intent:return-menu')
        return candidate ? await completeMenuNavigation(candidate) : handoff()
      }
      eligible = eligible.filter(candidate => menu === 'LOOKUP' ? ['intent:search-menu', 'intent:search-all-menu'].includes(candidate.id) : menu === 'RECOMMEND' ? /recommend/u.test(candidate.id) : candidate.id.startsWith('intent:scroll-menu:'))
    }
    return await leaf(eligible)
  }
  catch {
    if (invalidChoice)
      return finish({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
    // A provider/budget failure after admission must not guess the last effect.
    // Main gets an uncertain, read-only handoff and can ask in character.
    return admitted ? handoff() : finish({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
  }
}
