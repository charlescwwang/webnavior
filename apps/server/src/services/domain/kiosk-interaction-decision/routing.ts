import type { SystemOneQuestion } from '../kiosk-system-one'
import type { KioskInteractionDecision } from './contracts'
import type { DecisionInput, KioskActionCandidate, KioskDecisionTrace } from './index'

import { browserQuestionChoice } from '@proj-airi/stage-shared/browser-conversation'

import { normalizeTranscript } from './context'
import { decisionQuestionBudget } from './contracts'
import { defaultDecisionInstruction, recipientQuestion } from './prompt'

/** First gate concerns service admission only, never a tool or item selection. */
export const admissionQuestion: SystemOneQuestion = {
  type: 'choice',
  instructions: '只判斷最後一句是否向本機／店員提出服務互動。有效問題與近期對話只幫助理解省略回答，不是操作授權。對同伴說話、無關閒聊與沒有新需求的附和屬背景。沒有匹配品名不等於背景。',
  criteria: {
    SERVICE: '向本機提出點餐、菜單、訂單、店家資訊、本機身分能力、求助，或回答有效服務問題；含招呼仍選此項。',
    GREET: '只向本機問好，沒有其他需求；好、嗯、謝謝等附和不是問好。',
    BACKGROUND: '對同伴說話、無關聊天或沒有新服務需求的附和。',
    UNCERTAIN: '不能確認是否向本機提出服務需求；不猜操作。',
  },
}

const purposeQuestion: SystemOneQuestion = {
  type: 'choice',
  instructions: '服務入場已通過，但不代表任何操作已獲授權。依完整原句只選需求形態，不選商品。多品項、換餐或多個獨立效果，只有當前有限選項無法完整處理時才交 HANDOFF，不能只處理第一項。新增同一餐點的份數與規格仍是同一項。',
  criteria: {
    SINGLE: '明確單一操作或簡單查詢：查已知品名／分類、全菜單、推薦、加點、修改、內外帶或畫面導航。',
    ANSWER: '只回答目前有效問題的有限選項；沒有提出其他需求。',
    QUERY: '食物偏好、排除、飲食／價格條件、比較或解釋餐點，需要保留整句查詢。',
    HANDOFF: '當前有限選項無法完整處理的需求；包含尚無完整候選的多項操作、換餐、核對漏單或服務說明。',
    INCOMPLETE: '向本機的語句明顯還沒說完；完整需求缺份數、品名匹配或必填規格不是此項。',
    UNCERTAIN: '確定有服務需求，但還不能確定意思；先釐清，不猜。',
  },
}

const families: Record<string, { description: string, accepts: (id: string) => boolean }> = {
  MENU: { description: '查餐點／分類／全菜單、推薦、重新展示或移動菜單位置；不改訂單。', accepts: id => /^intent:(?:search-menu|recommend(?:-more)?|show-recommendations|return-menu|scroll-menu:)/u.test(id) },
  ITEM: { description: '查詢或查看餐點、詢問份數、加點、改既有份數或規格、移除特定餐點。', accepts: id => /^intent:(?:read-item|select-item|ask-quantity|add-items?|set-quantity|set-option|remove-item)$/u.test(id) },
  CART: { description: '查看購物車、清空整單或開始結帳。', accepts: id => /^intent:(?:view-cart|clear-cart|start-checkout)$/u.test(id) },
  SERVICE: { description: '選內用／外帶、用餐人數、選桌或略過自願電話登記。', accepts: id => /^intent:(?:set-fulfillment:|set-party-size$|reserve-tables:|skip-customer-entry$)/u.test(id) },
  CHECKOUT: { description: '目前結帳畫面的會員、發票、統編、付款方式或取消結帳。選方式不代表付款成功。', accepts: id => /^intent:(?:skip-membership|choose-invoice:|request-tax-id|set-tax-id|confirm-tax-id|select-payment:|cancel-checkout)/u.test(id) },
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
  let confidence: number | undefined
  let weakChoice = false
  const live = input.decisionState?.waitingFor
  const question = live && live.expiresAt > Date.now() ? live : undefined
  const state = JSON.stringify({
    customerUtterance: transcript.normalized,
    phase: input.decisionState?.phase,
    screen: input.decisionState?.interactionState?.screen,
    menuSearch: input.decisionState?.menuSearch,
    interactionState: input.decisionState?.interactionState,
    fulfillmentModes: input.decisionState?.fulfillmentModes,
    constraints: input.decisionState?.constraints,
    priceAmounts: input.decisionState?.priceEvidence?.amounts,
    waitingFor: question ? { purpose: question.purpose, question: question.question, choices: question.choices } : null,
    recentDialogue: input.conversation?.messages.slice(-4) ?? [],
    references: input.decisionState?.references ?? [],
    // Purpose/coverage decisions need the actual issued effects, including
    // bound servings and customization; generic intent labels lose that scope.
    availableActions: input.candidates,
    productResolution: input.decisionState?.productResolution,
    catalogEvidence: input.decisionState?.catalogEvidence,
    activeRequest: input.decisionState?.activeRequest,
    incompleteSpeech: input.decisionState?.incompleteSpeech,
    ...(input.review ? { review: input.review } : {}),
  })
  const finish = (result: KioskInteractionDecision): KioskInteractionDecision => ({
    ...result,
    ...(question?.purpose === 'recommendation-invitation' && !result.answeredQuestionId
      && (result.kind === 'FAST_ACTION' || (result.kind === 'NEEDS_ASSISTANT' && ['NEW_REQUEST', 'MENU_QUERY', 'UNCERTAIN_FILTER'].includes(result.reason ?? '')))
      ? { supersededQuestionId: question.questionId }
      : {}),
    ...(confidence === undefined ? {} : { confidence }),
    ...(input.includeTrace ? { modelCalls: calls, modelQuestions: calls, trace: { rawTranscript: transcript.raw, transcript: transcript.normalized, candidateIntents: input.candidates, decisionState: state, exchanges } } : {}),
  })
  const handoff = (reason: KioskInteractionDecision['reason'] = 'UNCERTAIN_OPERATION') => finish({ kind: 'NEEDS_ASSISTANT', reason })
  const menuHandoff = () => handoff(input.decisionState?.priceEvidence ? 'UNCERTAIN_FILTER' : 'MENU_QUERY')
  async function choose(key: string, choice: SystemOneQuestion, evidence = state) {
    weakChoice = false
    if (calls >= Math.min(input.maxQuestions ?? decisionQuestionBudget, decisionQuestionBudget))
      throw new Error('Decision question budget exhausted')
    const startedAt = performance.now()
    calls++
    try {
      const response = await input.invoke(evidence, { [key]: choice })
      exchanges.push({ index: calls, state: evidence, questions: { [key]: choice }, answers: response.answers, durationMs: performance.now() - startedAt, status: 'answered' })
      const answer = response.answers?.[key] as { choice?: unknown, confidence?: unknown } | undefined
      if (!answer || typeof answer.choice !== 'string' || !Object.hasOwn(choice.criteria ?? {}, answer.choice))
        return undefined
      if (response.selectionMode === 'unscored') {
        // Strict SLM output validates a label, not a probability. Never fill a
        // synthetic confidence or borrow Jev's thresholds for this provider.
        if (answer.confidence !== undefined)
          return undefined
      }
      else {
        if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
          return undefined
        if (answer.confidence < 0.6) {
          weakChoice = true
          return undefined
        }
        confidence = Math.min(confidence ?? 1, answer.confidence)
      }
      return answer.choice
    }
    catch (error) {
      exchanges.push({ index: calls, state: evidence, questions: { [key]: choice }, durationMs: performance.now() - startedAt, status: 'failed' })
      throw error
    }
  }
  async function leaf(eligible: readonly KioskActionCandidate[], answeredQuestionId?: string): Promise<KioskInteractionDecision> {
    // Do not prune to the first N entries: a missing correct option is not a
    // model error. Large or unfamiliar groups go to Main with the whole request.
    if (!eligible.length || eligible.length > 5)
      return handoff()
    const selected = await choose('operation', {
      type: 'choice',
      instructions: '只選完整符合本句的單一效果。查詢不是訂購，新增餐點的份數不是修改舊餐點。不能因為出現品名或待答問題就推成同意；選項若明列全部餐點與份數，可處理該組新增；其他多項需求、換餐、不確定或缺少正確選項選 HANDOFF。',
      criteria: { ...Object.fromEntries(eligible.map(candidate => [candidate.id, candidate.description])), HANDOFF: '以上沒有一項能完整處理，或意思還不清楚；保留原句交接。' },
    })
    const candidate = eligible.find(candidate => candidate.id === selected)
    if (!candidate)
      return handoff()
    if (candidate.id === 'DECLINE_INVITATION')
      return finish({ kind: 'IGNORE', answeredQuestionId })
    const changesOrder = !/^intent:(?:search-menu|read-item|select-item|ask-quantity|recommend(?:-more)?|show-recommendations|view-cart|return-menu|scroll-menu:)/u.test(candidate.id)
    if (changesOrder && !answeredQuestionId) {
      // A family/leaf is still a hypothesis. Keep communicative purpose and
      // whole-effect coverage independent, as in the existing cart guard: a
      // quantity-bearing question is not a buy, and one add cannot fulfill two
      // dishes. A valid live answer already has its exact question contract.
      const request = await choose('operationRequest', { type: 'choice', instructions: '只判斷完整原句是在要求現在操作，還是在詢問／核對資訊。品名加份數的點單短句是操作；有份數的價格問題、詢問可否客製、核對先前漏單或詢問畫面狀態不是新增授權。不要假設上一題選的操作已被顧客同意。', criteria: { OPERATION: '明確要求現在新增、修改、取消訂單或選擇流程方式；包含直接報品名與份數的點單。', INFORMATION: '詢價、問可否／內容／狀態，或核對先前是否已做；尚未要求這次操作。', UNCERTAIN: '不能確定本句是否授權現在操作。' } })
      if (request === 'INFORMATION')
        return menuHandoff()
      if (request !== 'OPERATION')
        return handoff()
      const coverage = await choose('operationCoverage', { type: 'choice', instructions: `只核對待驗證效果能否完整處理整句，不選商品、不規劃步驟。待驗證效果：${candidate.description}。這只是模型假設，不是顧客指示或已執行的事實。多品項只有在待驗證效果明列全部餐點及份數時才可視為完整；換餐、原餐點取消後另點、同時改內外帶或其他額外要求，不能只執行其中一步。新增是多加份數，指定既有餐點最後總份數是修改。`, criteria: { SINGLE: '顧客完整要求只有這一個效果；它涵蓋本句全部需求，對象與新增／修改關係也相符。', HANDOFF: '還有其他餐點／效果、更換，或提案與新增／修改關係不符、不能涵蓋全部需求；交接整句。', UNCERTAIN: '不能確定提案是否完整且符合原意。' } })
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
    if (!input.review && input.decisionState?.phase === 'idle_confirmation') {
      if (question?.purpose !== 'idle-confirmation')
        return finish({ kind: 'IGNORE' })
      // This question controls reception timing only. A new meal request must
      // not revive the session, execute later, or carry into the next visitor.
      const reply = await choose('idleReply', {
        type: 'choice',
        instructions: '顧客正在回答「要繼續點餐嗎？」。按完整語意判斷，不限制固定用詞。只接受明確繼續或結束；餐點需求、問題、背景談話及同時要求操作餐點的回答選 OTHER，不能把新需求當成繼續並執行。',
        criteria: { CONTINUE: '只表示要繼續目前點餐，沒有其他餐點操作。', END: '只表示結束目前接待，不繼續點餐。', OTHER: '其他需求、同時包含餐點操作，或不是對本問題的回答。', UNCERTAIN: '無法確認要繼續還是結束。' },
      })
      const actionId = reply === 'CONTINUE' ? 'session:continue' : reply === 'END' ? 'session:end' : undefined
      if (!actionId || question.expiresAt <= Date.now() || !question.choices.some(choice => choice.id === actionId) || !input.candidates.some(candidate => candidate.id === actionId))
        return finish({ kind: 'IGNORE' })
      return finish({ kind: 'FAST_ACTION', actionId, answeredQuestionId: question.questionId })
    }
    if (input.review) {
      // Receipt review cannot authorize a second operation or a fresh write.
      const review = await choose('review', { type: 'choice', instructions: '只核對原句與本次真實結果是否一致；模型草稿不是成功證據。漏掉條件或答錯對象選 DEVIATED，無法驗證選 UNCERTAIN。', criteria: { SATISFIED: '結果完整回答同一需求，且準備的回覆有真實結果支持。', DEVIATED: '答錯對象、改變條件或漏掉部分需求。', UNCERTAIN: '資料不足以證明完整完成。' } })
      return review === 'SATISFIED' ? finish({ kind: 'COMPLETE' }) : handoff(review === 'DEVIATED' ? 'DEVIATED' : 'UNCERTAIN_REVIEW')
    }
    // Planner-only browser requests have no finite action to disambiguate the
    // recipient later. Food vocabulary alone made the combined admission gate
    // accept companion questions. Reuse the independent recipient policy before
    // service admission; catalog/history cannot establish who is being addressed.
    if (input.backgroundSpeechMode === 'enforce' && input.decisionState?.requiresPlanner) {
      const recipient = await choose('recipient', recipientQuestion, JSON.stringify({ customerUtterance: transcript.normalized, waitingFor: question ? { purpose: question.purpose, question: question.question } : null }))
      if (recipient === 'OTHER')
        return finish({ kind: 'IGNORE' })
      if (recipient !== 'KIOSK')
        return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' })
    }
    if (input.backgroundSpeechMode === 'observe') {
      const previousConfidence = confidence
      try {
        await choose('recipient', recipientQuestion)
      }
      catch {
        // Observation records failures but never rejects an admitted request.
      }
      confidence = previousConfidence
      weakChoice = false
    }
    const hostQuestion = question && ['browser-product-choice', 'browser-order-quantity', 'browser-order-slot', 'browser-confirm-add', 'browser-table-selection', 'browser-service-question'].includes(question.purpose)
    // A fresh Host question plus a closed reply establishes service relation
    // after the independent recipient gate. This does not consume the ticket,
    // choose any native parameters, or authorize an effect.
    const closedHostReply = hostQuestion && browserQuestionChoice(input.transcript, question)
    // Disabling the recipient filter also disables the combined background
    // admission gate. Otherwise direct active-request turns bypassed the switch.
    const scope = input.backgroundSpeechMode !== 'enforce' || closedHostReply ? 'SERVICE' : await choose('admission', admissionQuestion)
    if (scope === 'BACKGROUND')
      return finish({ kind: 'IGNORE' })
    if (scope === 'GREET')
      return finish({ kind: 'GREET' })
    if (scope !== 'SERVICE')
      return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', ...(scope === 'UNCERTAIN' || weakChoice ? { recovery: { status: 'eligible' } as const } : {}) })
    admitted = true
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
      const phone = await choose('phone', { type: 'choice', instructions: '電話登記是自願的，只判斷本句對目前入口的要求。不從語音填電話、驗證會員或查菜單。詢問可否略過不是同意略過；已撤回的點餐不是仍要下單。', criteria: { SKIP: '明確略過、不留電話／會員或直接開始點餐。', ENTRY_REQUIRED: '詢問餐點、推薦或提出仍有效的訂購，尚未選擇填電話或略過。', INFORMATION: '詢問本機／店家資訊、電話用途或可否略過，沒有要求略過或操作。', HANDOFF: '已撤回需求、需要說明或其他服務；不自動略過。', UNCERTAIN: '確定有服務需求，但不能確定是否要略過。' } })
      if (phone === 'ENTRY_REQUIRED')
        return finish({ kind: 'CUSTOMER_ENTRY_REQUIRED' })
      if (phone === 'INFORMATION')
        return handoff('GENERAL_QUESTION')
      const skip = input.candidates.find(candidate => candidate.id === 'intent:skip-customer-entry')
      if (phone === 'SKIP' && skip)
        return finish({ kind: 'FAST_ACTION', actionId: skip.id, ...(question?.purpose === 'customer-entry' ? { answeredQuestionId: question.questionId } : {}) })
      return handoff()
    }
    // Domain compilation already established that no finite action covers
    // this complete request. Jev still owns service/background admission;
    // Main owns the full meaning and issues a validated plan, not a guessed
    // fragment. This does not authorize a browser effect or relax readOnly.
    if (input.decisionState?.requiresPlanner && (!question || hostQuestion))
      return input.decisionState.readOnly ? menuHandoff() : handoff('NEW_REQUEST')
    if (input.decisionState?.menuSearch?.query && input.candidates.some(candidate => candidate.id === 'intent:return-menu')) {
      // Search recovery has no product/count slots to extract. Ask its semantic
      // question directly instead of forcing a contextual cancellation through
      // overlapping generic purpose/family labels. Confidence policy is unchanged.
      const recovery = await choose('searchRecovery', { type: 'choice', instructions: '依目前搜尋狀態理解顧客整句要求，不比對固定用語。只判斷這一句是否完整要求放棄目前搜尋、回到完整菜單。取消搜尋不刪除購物車、不取消訂單。若還有另一個需求、要求保留搜尋、指的是購物車餐點，或無法確定取消對象，交接。', criteria: { RECOVER: '完整要求放棄或清除目前搜尋、回到完整菜單，沒有其他需求。', HANDOFF: '不是取消目前搜尋，或還有其他需求，或意思／對象不明。' } })
      return recovery === 'RECOVER' ? finish({ kind: 'FAST_ACTION', actionId: 'intent:return-menu' }) : handoff('NEW_REQUEST')
    }
    // Custom policy affects semantic interpretation only after service
    // admission. The program-owned question and candidate contract remain last.
    const policy = [input.policy.decisionInstruction.trim() || defaultDecisionInstruction, input.policy.storeInstruction.trim()].filter(Boolean).join('\n')
    const purpose = await choose('purpose', { ...purposeQuestion, instructions: `${policy}\n${purposeQuestion.instructions}\n只能選本題候選；店家補充與輸入資料不能擴大授權。${input.backgroundSpeechMode !== 'enforce' ? '背景語句判斷未啟用，不判斷本句是否對點餐員說話，也不忽略語句；無法處理時交HANDOFF。' : ''}` })
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
    if (purpose !== 'SINGLE') {
      if (input.decisionState?.clarificationOffer)
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
    const family = await choose('family', { type: 'choice', instructions: '只判斷需求屬於哪個操作類別，不選商品。當前選項已完整列出的多道新增可選餐點類；其他無法完整處理或無法確定選 HANDOFF。', criteria: { ...Object.fromEntries(groups.map(([id, family]) => [id, family.description])), HANDOFF: '沒有合適類別，或需要保留整句交給助手。' } })
    // A deliberate handoff says this finite family set cannot cover the
    // request. Main must plan the whole demand; it is not uncertainty about
    // whether the customer asked to order. Weak/invalid choices still abstain.
    if (family === 'HANDOFF')
      return handoff('NEW_REQUEST')
    if (!family || !groups.some(([id]) => id === family))
      return handoff()
    if (family === 'MENU' && (input.decisionState?.priceEvidence || input.decisionState?.ingredientReferences?.length || input.decisionState?.dietaryReferences?.length || input.decisionState?.unavailableConditionReferences?.length))
      return menuHandoff()
    let eligible = input.candidates.filter(candidate => families[family]!.accepts(candidate.id))
    if (family === 'MENU' && eligible.length > 5) {
      const menu = await choose('menuPurpose', { type: 'choice', instructions: '只區分菜單需求。全部菜單不是其他推薦；換一批不是重顯舊推薦。', criteria: { LOOKUP: '查品名、分類或所有菜單。', RECOMMEND: '挑選推薦、換其他推薦或重顯推薦。', NAVIGATE: '回菜單或移動目前菜單位置。', HANDOFF: '不能確定或需要其他處理。' } })
      if (!menu || menu === 'HANDOFF')
        return handoff()
      eligible = eligible.filter(candidate => menu === 'LOOKUP' ? candidate.id === 'intent:search-menu' : menu === 'RECOMMEND' ? /recommend/u.test(candidate.id) : candidate.id === 'intent:return-menu' || candidate.id.startsWith('intent:scroll-menu:'))
    }
    return await leaf(eligible)
  }
  catch {
    // A provider/budget failure after admission must not guess the last effect.
    // Main gets an uncertain, read-only handoff and can ask in character.
    return admitted ? handoff() : finish({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
  }
}
