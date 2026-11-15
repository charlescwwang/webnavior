import type { SystemOnePolicyInput, SystemOneQuestion, SystemOneResponse } from '../kiosk-system-one'
import type { DecisionConversation } from './context'
import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { isTargetAcknowledgement } from '@proj-airi/stage-shared/kiosk-conversation'

import { normalizeTranscript } from './context'
import { decisionQuestionBudget } from './contracts'
import { decideDirectInteraction } from './direct'
import { createDecisionInstructions, recipientQuestion, serviceRequestInstruction } from './prompt'
import { decideStagedInteraction } from './routing'

export type { KioskDecisionState, KioskInteractionDecision } from './contracts'

export interface KioskActionCandidate {
  description: string
  id: string
  requiresHighConfidence?: boolean
}

export interface KioskDecisionTrace {
  /** Ordered provider exchanges from this decision only, including early failures. */
  exchanges?: Array<{
    index: number
    state: string
    questions: Record<string, SystemOneQuestion>
    answers?: Record<string, unknown>
    durationMs: number
    status: 'answered' | 'failed'
  }>
  filterRequirement?: unknown
  priceAnswer?: unknown
  filterPresence?: unknown
  dietaryAnswer?: unknown
  ingredientAnswers?: unknown
  unavailableConditionAnswers?: unknown
  questionRelation?: unknown
  candidateIntents: readonly KioskActionCandidate[]
  decisionState: string
  rawAnswer?: unknown
  semanticCheck?: unknown
  transcript: string
  rawTranscript?: string
}

export interface DecisionInput {
  /** Jev/Decisions use direct selection; SLM retains staged routing. Omitted only for flat diagnostic replays. */
  routing?: 'staged' | 'direct'
  /** Server-resolved device policy; observe records recipient evidence without blocking. */
  backgroundSpeechMode?: 'off' | 'observe' | 'enforce'
  conversation?: DecisionConversation
  review?: { answer: string, observation: string }
  candidates: readonly KioskActionCandidate[]
  decisionState?: KioskDecisionState
  includeTrace?: boolean
  invoke: (state: string, questions: Record<string, SystemOneQuestion>) => Promise<SystemOneResponse>
  maxActionCandidates?: number
  maxQuestions?: number
  policy: SystemOnePolicyInput
  presenceState?: string
  transcript: string
}

/** Converts the current eligible action set into a finite System One choice. */
export async function decideInteraction(input: DecisionInput): Promise<KioskInteractionDecision> {
  if (input.routing === 'direct')
    return decideDirectInteraction(input)
  if (input.routing === 'staged')
    return decideStagedInteraction(input)
  let modelCalls = 0
  let modelQuestions = 0
  const admission: { recipient: 'unchecked' | 'unknown' | 'kiosk' | 'other', uncertainMeaning: boolean, invalidAnswer: boolean } = { recipient: 'unchecked', uncertainMeaning: false, invalidAnswer: false }
  // Observe actual finite answers even when tracing is off. Recipient admission
  // and semantic uncertainty are separate facts; model confidence never grants
  // target, question-answer, or execution authority.
  const invoke: DecisionInput['invoke'] = async (state, questions) => {
    if (modelQuestions + Object.keys(questions).length > (input.maxQuestions ?? decisionQuestionBudget))
      throw new Error('Decision question budget exhausted')
    modelCalls++
    modelQuestions += Object.keys(questions).length
    const response = await input.invoke(state, questions)
    for (const [key, question] of Object.entries(questions)) {
      if (question.type !== 'choice')
        continue
      if (key === 'recipient' || key === 'service' || key === 'greeting')
        admission.recipient = 'unknown'
      const answer = response.answers?.[key] as { choice?: unknown, confidence?: unknown } | undefined
      const choices = Array.isArray(question.criteria) ? question.criteria : Object.keys(question.criteria ?? {})
      if (!answer || typeof answer.choice !== 'string' || !choices.includes(answer.choice) || typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
        admission.invalidAnswer = true
        continue
      }
      if (key === 'recipient' || key === 'service' || key === 'greeting') {
        if (answer.confidence >= 0.6 && ['KIOSK', 'REQUEST'].includes(answer.choice))
          admission.recipient = 'kiosk'
        else if (answer.confidence >= 0.6 && ['OTHER', 'BACKGROUND', 'IGNORE'].includes(answer.choice))
          admission.recipient = 'other'
        continue
      }
      admission.uncertainMeaning ||= answer.confidence < 0.6 || answer.choice === 'UNCERTAIN'
    }
    return response
  }
  let result = await decideBoundedInteraction({ ...input, invoke })
  const weakDecision = (result.kind === 'FAST_ACTION' || result.kind === 'IGNORE' || result.kind === 'INCOMPLETE') && typeof result.confidence === 'number' && result.confidence < 0.6
  // Revoke the guessed effect before admission. A failed recipient check or
  // exhausted budget must never restore a weak action or a guessed IGNORE.
  if (!input.review && weakDecision)
    result = { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...(result.trace === undefined ? {} : { trace: result.trace }) }
  const rejectedMeaning = result.kind === 'UNAVAILABLE' && (result.reason === undefined || result.reason === 'UNCERTAIN_OPERATION')
  // Finalize only pre-execution semantic abstentions. A read review already has
  // receipts and its own recovery protocol; malformed replies and uncertain
  // recipients must not be promoted by this policy.
  if (!input.review && !admission.invalidAnswer && admission.uncertainMeaning && rejectedMeaning) {
    const preserved = result.trace === undefined ? {} : { trace: result.trace }
    if (admission.recipient === 'other') {
      result = { ...preserved, kind: 'IGNORE' }
    }
    else if (admission.recipient === 'unknown') {
      result = { ...preserved, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' }
    }
    else if (modelQuestions < (input.maxQuestions ?? decisionQuestionBudget)) {
      const waitingFor = input.decisionState?.waitingFor
      const serviceRequest: SystemOneQuestion = {
        type: 'choice',
        instructions: '只判斷顧客最後一句是否向點餐機提出有效服務互動，不選操作、不猜品名或授權。「你」開頭、沒有叫同伴名字、有人站在畫面前，都不能證明有服務需求。一般日常話題或私人經歷的閒聊，即使對本機提問也選 BACKGROUND。REQUEST 限向本機提出點餐、菜單、推薦、訂單、自願電話登記、店家服務資訊（店名、營業時間、付款方式、發票、點餐管道、取餐／送餐方式）或本機身分／名稱／能力等服務需求、直接問好，或依目前畫面、有效待答問題與真實 references 可理解的服務回答。單純笑聲、附和或表示了解，沒有新服務需求且不回答有效問題，選 BACKGROUND。未匹配品名不代表無服務需求。不能確定選 UNCERTAIN。',
        criteria: { REQUEST: '向本機提出有效點餐／本機／店家服務資訊需求、直接問好，或回答有效服務問題。', BACKGROUND: '對同伴說話、一般閒聊或單純附和，沒有向本機提出有效服務需求。', UNCERTAIN: '不能確認是否有向本機提出有效服務需求。' },
      }
      const state = JSON.stringify({ customerUtterance: normalizeTranscript(input.transcript).normalized, phase: input.decisionState?.phase, screen: input.decisionState?.interactionState?.screen, waitingFor: waitingFor && waitingFor.expiresAt > Date.now() ? { purpose: waitingFor.purpose, question: waitingFor.question, choices: waitingFor.choices } : null, references: input.decisionState?.references ?? [] })
      const startedAt = performance.now()
      const trace = result.trace as KioskDecisionTrace | undefined
      // Recipient confidence alone previously promoted weak IGNORE routes for
      // movie chatter to Main. Require an actual service request without
      // treating a missing product/operation as proof that speech is irrelevant.
      result = { ...preserved, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' }
      try {
        const response = await invoke(state, { serviceRequest })
        trace?.exchanges?.push({ index: modelCalls, state, questions: { serviceRequest }, answers: response.answers, durationMs: performance.now() - startedAt, status: 'answered' })
        const answer = response.answers?.serviceRequest as { choice?: string, confidence?: number } | undefined
        if (!admission.invalidAnswer && typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence) && answer.confidence >= 0.6 && answer.confidence <= 1) {
          if (answer.choice === 'REQUEST')
            result = { ...preserved, kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' }
          else if (answer.choice === 'BACKGROUND')
            result = { ...preserved, kind: 'IGNORE' }
          else
            result = { ...result, recovery: { status: 'eligible' } }
        }
        else if (admission.invalidAnswer) {
          result = { ...result, recovery: { status: 'failed', failure: 'invalid' } }
        }
        else if (!admission.invalidAnswer && typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence < 0.6) {
          result = { ...result, recovery: { status: 'eligible' } }
        }
      }
      catch {
        result = { ...result, recovery: { status: 'failed', failure: 'provider-error' } }
        trace?.exchanges?.push({ index: modelCalls, state, questions: { serviceRequest }, durationMs: performance.now() - startedAt, status: 'failed' })
      }
    }
    else {
      result = { ...preserved, kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' }
    }
  }
  return input.includeTrace ? { ...result, modelCalls, modelQuestions } : result
}

async function decideBoundedInteraction(input: DecisionInput): Promise<KioskInteractionDecision> {
  const transcript = normalizeTranscript(input.transcript)
  input = { ...input, transcript: transcript.normalized }
  if (!input.transcript)
    return { kind: 'IGNORE' }
  // Application-side shaping must fit the model budget. Silent truncation can
  // remove the one correct semantic option and turn a valid utterance into IGNORE.
  if (input.candidates.length > (input.maxActionCandidates ?? 253))
    return { kind: 'UNAVAILABLE', reason: 'CANDIDATE_BUDGET' }
  const eligibleCandidates = input.candidates
  const exchanges: NonNullable<KioskDecisionTrace['exchanges']> = []
  // The array is decision-local. It records the actual finite questions, not a
  // reconstructed prompt, and survives failures in any later provider call.
  const invoke: DecisionInput['invoke'] = async (state, questions) => {
    const startedAt = performance.now()
    try {
      const result = await input.invoke(state, questions)
      if (input.includeTrace)
        exchanges.push({ index: exchanges.length + 1, state, questions, answers: result.answers, durationMs: performance.now() - startedAt, status: 'answered' })
      return result
    }
    catch (error) {
      if (input.includeTrace)
        exchanges.push({ index: exchanges.length + 1, state, questions, durationMs: performance.now() - startedAt, status: 'failed' })
      // Provider error bodies can contain infrastructure details. The trace
      // records failure and timing without copying those bodies to the client.
      throw error
    }
  }
  let qualifiedRequest = false
  let recipientVerified = false
  let supersededQuestionId: string | undefined
  const providerFailure = (): KioskInteractionDecision => ({
    kind: qualifiedRequest ? 'NEEDS_ASSISTANT' : 'UNAVAILABLE',
    reason: 'PROVIDER_FAILURE',
    ...(supersededQuestionId ? { supersededQuestionId } : {}),
    ...(input.includeTrace ? { trace: { rawTranscript: transcript.raw, exchanges, candidateIntents: eligibleCandidates, decisionState: createDecisionState(input), transcript: input.transcript } } : {}),
  })
  const phase = input.decisionState?.phase
  // A question supplies context and answer effects, never a prerequisite for
  // routing the next utterance. Validate its relation only after such an effect
  // has been selected; unrelated state-valid actions keep their own route.
  const presented = input.decisionState?.waitingFor
  const waitingFor = !input.review && presented && presented.expiresAt > Date.now()
    && (presented.purpose !== 'recommendation-invitation' || (phase === 'ordering' && !input.decisionState?.activeRequest))
    ? presented
    : undefined
  // A standalone acknowledgement has no operation to resolve unless an
  // actionable question is live. Do not turn high-confidence HELLO_ONLY
  // misclassifications of 好/謝謝 into repeated greetings or menu mutations.
  if (/^(?:謝謝|謝謝你|了解|知道了|收到)[。.!！,，、\s]*$/.test(input.transcript) || ((!waitingFor || waitingFor.purpose === 'customer-entry') && /^(?:[好嗯喔哦]|好的)[。.!！,，、\s]*$/.test(input.transcript)))
    return { kind: 'IGNORE' }
  const invitation = waitingFor?.purpose === 'recommendation-invitation' ? waitingFor : undefined
  // The question owner supplies this turn's legal answers, including newly
  // parsed slot values. Dialogue text and purpose names cannot invent an answer.
  const questionChoices = waitingFor?.choices.filter(choice => eligibleCandidates.some(candidate => candidate.id === choice.id) || choice.id === 'DECLINE_INVITATION') ?? []
  // A broad route can confuse a companion's greeting with an address to this
  // kiosk. Verify the recipient and communicative effect before responding;
  // this never issues a command or answers the waiting operation question.
  async function resolveGreeting(): Promise<KioskInteractionDecision> {
    const result = await invoke(createDecisionState(input), {
      greeting: {
        type: 'choice',
        instructions: '只判斷最後一句話的對象及目的。店員或本機是服務對象；被叫名字的同伴不是店員。前面的問題不代表本句正在回答。',
        criteria: {
          GREET: '顧客明確向本機說你好、嗨等問候；好、嗯、謝謝、了解等附和不是問候。沒有其他要求。',
          IGNORE: '對同伴問好、約同伴移動或閒聊，沒有向店員／本機提出需求。',
          REQUEST: '顧客向店員／本機提出點餐、查詢、修改等需求，或回答操作問題。即使含問好，仍是需求而非純招呼。',
        },
      },
    })
    const answer = result.answers?.greeting as { choice?: string, confidence?: number } | undefined
    if (!answer || typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0.6 || answer.confidence > 1) {
      // Knowing the speaker's recipient does not establish a service request.
      // An uncertain social greeting stays silent rather than requesting a
      // clearer order or escalating the broad route's guessed intent.
      return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_GREETING' }
    }
    if (answer.choice === 'GREET' || answer.choice === 'IGNORE')
      return { kind: answer.choice, confidence: answer.confidence }
    return { kind: answer.choice === 'REQUEST' ? 'NEEDS_ASSISTANT' : 'UNAVAILABLE' }
  }
  const followUp = phase === 'clarification' || phase === 'pending_confirmation' || phase === 'configuration' || phase === 'meal_confirmation'
  const prices = !input.review && !followUp ? input.decisionState?.priceEvidence : undefined
  // Both phone-stage factual queries and ordering reads must qualify the same
  // browser-issued bounds before the host can carry them to menu tools.
  const priceQuestion: SystemOneQuestion | undefined = prices
    ? {
        type: 'choice',
        instructions: '只解讀 customerUtterance（或狀態最後的顧客語音）本句的完整價格條件，只選已提供的解讀。amounts 是同一句中文金額的數值證據，不是另一筆預算。未說元仍可完整詢價。邊界預設包含：以下、以內、以上，以及到／至／之間都包含對應邊界；只有原句明確說不到、低於、超過或高於才排除該端，不能自行補上排除條件。金額是單份基本售價，不是數量或人數。不新增訂購、不猜售價、不做多份／總額預算分配。以下與以內含邊界；不到與低於不含；以上含邊界；超過不含。最便宜／便宜的先／先看便宜的表示由低到高排序；有上下限時選保留上下限的 _ASC 解讀，不可只選 ASC 或不排序的版本。剛好／正好／等於某價格是 EXACT，上下限相同，不可放寬成以下或以上。範圍分別判斷兩端：「100到130」含兩端，「100以上不到130」含下限、不含上限（RANGE_MAX_EXCLUSIVE），不可選含兩端的 RANGE。範圍必須完整符合上下界；左右、更便宜、整筆預算或候選無法完整表示時選 UNSUPPORTED。只詢價選 INFORMATION。',
        criteria: Object.fromEntries(prices.choices.map(choice => [choice.id, choice.description])),
      }
    : undefined
  async function handoffMenu(decision: Extract<KioskInteractionDecision, { kind: 'NEEDS_ASSISTANT' }>): Promise<KioskInteractionDecision> {
    if (!prices || !priceQuestion || decision.priceChoiceId !== undefined)
      return decision
    // A read-only handoff is not a resolved price. Carry this utterance's
    // browser-issued bounds before the host creates the guarded Agent task;
    // otherwise even a correct menu call stays blocked as unresolvedPrice.
    // This checkpoint resolves only the current utterance's literal price.
    // Previous budgets and SHOWN/CATALOG answers belong to query scope; replaying
    // them here makes a new boundary compete with already-settled conditions.
    const result = await invoke(JSON.stringify({ customerUtterance: input.transcript, amounts: prices.amounts }), { price: priceQuestion })
    const answer = result.answers?.price as { choice?: unknown, confidence?: unknown } | undefined
    const trace = decision.trace as KioskDecisionTrace | undefined
    if (trace)
      trace.priceAnswer = answer
    const choice = prices.choices.find(choice => choice.id === answer?.choice)
    if (!choice || typeof answer?.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0.6 || answer.confidence > 1)
      return { ...decision, reason: 'UNSUPPORTED_PRICE' }
    if (choice.kind === 'unsupported')
      return { ...decision, reason: 'UNSUPPORTED_PRICE', priceChoiceId: choice.id }
    return { ...decision, priceChoiceId: choice.id }
  }

  if (phase === 'customer_entry' && !input.review) {
    // Do not repeat the clerk's invitation in this classification input: a
    // small model can classify that invitation instead of the final utterance.
    const state = JSON.stringify({ customerUtterance: input.transcript })
    const trace = input.includeTrace ? { trace: { exchanges, candidateIntents: eligibleCandidates, decisionState: state, transcript: input.transcript } } : {}
    try {
      const scope = (await invoke(state, { service: {
        type: 'choice',
        instructions: '只分類 customerUtterance。HELLO_ONLY 僅限對本機單純問好，沒有問題或要求。「好」「嗯」「謝謝」「了解」是附和，不是問好，沒有新需求選 BACKGROUND；只有明確問候才選 HELLO_ONLY。只要有提問或操作需求就選 REQUEST，含問好也一樣。叫同伴名字問好或聊天選 BACKGROUND；被叫名字的同伴不是本機。對比：「你好」是 HELLO_ONLY；「你好，你是誰」「你好，請略過電話」是 REQUEST；「小陳你好，好久不見」是 BACKGROUND。',
        criteria: {
          HELLO_ONLY: '只有對店員／本機問好，例如你好、哈囉、早安，沒有其他內容。',
          REQUEST: '向本機提問、要求推薦／點餐／略過／填電話或回答問題。身分、用途、可否略過都是提問，不是單純問好。',
          BACKGROUND: '對同伴問好或聊天，沒有向本機說話；有叫同伴名字的問候也是此項。',
        },
      } })).answers?.service as { choice?: string, confidence?: number } | undefined
      if (!scope || typeof scope.confidence !== 'number' || !Number.isFinite(scope.confidence) || scope.confidence < 0.6 || scope.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      if (scope.choice === 'HELLO_ONLY')
        // A direct greeting leaves the phone question pending and grants no
        // entry transition; no phone-choice or Agent generation is needed.
        return { kind: 'GREET', confidence: scope.confidence, ...trace }
      if (scope.choice === 'BACKGROUND')
        return { kind: 'IGNORE', ...trace }
      if (scope.choice !== 'REQUEST')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      qualifiedRequest = true
      const choice = (await invoke(state, { phone: {
        type: 'choice',
        instructions: '分類 customerUtterance 最後仍成立的需求。含招呼又提出需求時依需求分類；同句先點餐後撤回，以最後改口為準。已撤回的餐點不是仍要訂購，也不是查詢有沒有；未指定電話的「不要了」不等於略過電話。沒有剩餘操作的撤回選 ASK，交助手確認。ORDER 是仍請你推薦、換其他推薦、想吃或訂購餐點，先提醒完成電話選擇。MENU 是單純詢問販售內容、價格或查證有沒有，不代表要推薦或點餐，但同樣須先填手機或明確略過，不能直接查詢菜單。ASK 也包含電話用途、身分或其他一般問題。SKIP 是明確省略電話或直接開始點餐；ENTER 是要填電話或否定略過。「可以略過嗎」是 ASK，「請略過」是 SKIP，「不要略過」是 ENTER。',
        criteria: { SKIP: '明確要求現在略過、不填電話或直接開始點餐；撤回餐點不屬於此項。', ENTER: '要填電話，不略過。', ASK: '電話用途、可不可以略過、本機身分、店家服務資訊（營業時間、付款方式、發票、點餐與取餐管道）、一般問題，或同句撤回點餐後沒有剩餘操作，只需確認或釐清。', MENU: '單純問賣什麼、餐點價格、成分或有沒有某餐點／分類，以及查證先前品項；只提到已撤回的餐點不屬於此項。', ORDER: '最後仍要求推薦、換推薦、想吃或明確點餐、調整訂單；先完成電話選擇，不操作餐點。同句已撤回的訂購不屬於此項。' },
      } })).answers?.phone as { choice?: string, confidence?: number } | undefined
      if (!choice || typeof choice.confidence !== 'number' || !Number.isFinite(choice.confidence) || choice.confidence < 0.6 || choice.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (choice.choice === 'ORDER')
        // The host explains the prerequisite; this grants neither a phone skip
        // nor an order operation and does not start another Agent generation.
        return { kind: 'CUSTOMER_ENTRY_REQUIRED', confidence: choice.confidence, ...trace }
      if (choice.choice === 'MENU')
        return { kind: 'CUSTOMER_ENTRY_REQUIRED', confidence: choice.confidence, ...trace }
      if (choice.choice === 'ENTER' || choice.choice === 'ASK')
        return { kind: 'NEEDS_ASSISTANT', confidence: choice.confidence, ...trace }
      const skip = eligibleCandidates.find(candidate => candidate.id === 'intent:skip-customer-entry')
      if (choice.choice !== 'SKIP' || !skip)
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      return { kind: 'FAST_ACTION', actionId: skip.id, confidence: choice.confidence, ...(waitingFor?.purpose === 'customer-entry' ? { answeredQuestionId: waitingFor.questionId } : {}), ...trace }
    }
    catch { return providerFailure() }
  }
  const canClarify = Boolean(input.decisionState?.clarificationOffer) || phase === 'meal_confirmation'
  if (input.decisionState?.clarificationOffer && !input.review && (phase === 'configuration' || (phase === 'ordering' && input.decisionState.productResolution?.status === 'possible'))) {
    // Switching subjects while filling another meal has two separate unknowns:
    // the recipient, then the new request. Keep both finite instead of forcing
    // a small model to compare cancellation, topic change and clarification at once.
    const state = JSON.stringify({ customerUtterance: input.transcript })
    const configuring = input.decisionState.references?.find(reference => reference.refId === 'CONFIGURING_ITEM')
    const cancel = configuring?.label === input.decisionState.clarificationOffer.label
      ? eligibleCandidates.find(candidate => candidate.id.endsWith(':cancel') && waitingFor?.choices.some(choice => choice.id === candidate.id))
      : undefined
    const inquiry = cancel ? eligibleCandidates.find(candidate => candidate.id === cancel.id.replace(/:cancel$/, ':inquiry')) : undefined
    const trace = input.includeTrace ? { trace: { exchanges, candidateIntents: eligibleCandidates, decisionState: state, transcript: input.transcript } } : {}
    try {
      const scope = (await invoke(state, { service: {
        type: 'choice',
        instructions: '只判斷 customerUtterance 的說話對象。直接向店員詢問、拒絕、取消或糾正店員誤解都選 REQUEST，否認要點餐也是向店員回答，不是背景。叫同伴名字對他說話、討論事情或背景聊天選 BACKGROUND。不要決定要不要購買。',
        criteria: { REQUEST: '直接向點餐機／店員報餐點、提問、拒絕或更正誤解；不是安排同伴的事情。', BACKGROUND: '對同伴說話、工作報告、安排稍後討論或一般聊天，順帶提菜名也屬此項。', UNCERTAIN: '無法確定是否在向店員說話。' },
      } })).answers?.service as { choice?: string, confidence?: number } | undefined
      if (!scope || typeof scope.confidence !== 'number' || !Number.isFinite(scope.confidence) || scope.confidence < 0.6 || scope.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      if (scope.choice === 'BACKGROUND')
        return { kind: 'IGNORE', ...trace }
      if (scope.choice !== 'REQUEST')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      qualifiedRequest = true
      const purpose = (await invoke(state, { purpose: {
        type: 'choice',
        instructions: inquiry ? '只分類顧客這一句：單純不要是 CANCEL；說不是要點、只是問有沒有是 INQUIRY；只有菜名是 CONFIRM；查價或其他新需求是 NEW_REQUEST。以整句為準，不猜份數。' : '只分類顧客這一句：只有菜名或用途不清先 CONFIRM；明確查價、查詢或完整的新操作選 NEW_REQUEST。不決定取消原餐點，不猜份數。',
        criteria: inquiry
          ? { CANCEL: '只說不要、取消、不點這道，沒有另問問題。', INQUIRY: '說不是要點，只是問有沒有或是否有賣；更正被誤會成購買。', CONFIRM: '只有餐點名字，沒有不要、提問或其他需求。', NEW_REQUEST: '查價或其他獨立新需求，不是上述三種。' }
          : { CONFIRM: '只報新餐點名字或用途不清，先確認是否要點這道。', NEW_REQUEST: '明確查價、查詢或完整的新操作。', UNCERTAIN: '無法理解要做什麼。' },
      } })).answers?.purpose as { choice?: string, confidence?: number } | undefined
      if (!purpose || !['CONFIRM', 'NEW_REQUEST', 'UNCERTAIN', ...(cancel ? ['CANCEL'] : []), ...(inquiry ? ['INQUIRY'] : [])].includes(String(purpose.choice)) || typeof purpose.confidence !== 'number' || !Number.isFinite(purpose.confidence) || purpose.confidence < 0 || purpose.confidence > 1)
        return providerFailure()
      const invitationResult = invitation ? { supersededQuestionId: invitation.questionId } : {}
      if (purpose.choice === 'INQUIRY' && inquiry && purpose.confidence >= 0.6)
        return { kind: 'FAST_ACTION', actionId: inquiry.id, confidence: purpose.confidence, answeredQuestionId: waitingFor!.questionId, ...trace }
      if (purpose.choice === 'CANCEL' && cancel && purpose.confidence >= 0.6)
        return { kind: 'FAST_ACTION', actionId: cancel.id, confidence: purpose.confidence, answeredQuestionId: waitingFor!.questionId, ...trace }
      if (purpose.choice === 'NEW_REQUEST' && purpose.confidence >= 0.6)
        return { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', confidence: purpose.confidence, ...invitationResult, ...trace }
      // Service admission is already reliable. An unclear purpose can ask the
      // one read-only proposal question, but cannot authorize its meal/cart.
      return { kind: 'NEEDS_CLARIFICATION', confidence: scope.confidence, ...invitationResult, ...trace }
    }
    catch { return providerFailure() }
  }
  let answeredQuestionId: string | undefined
  const criteria: Record<string, string> = followUp
    ? { IGNORE: '與點餐無關的背景話語，沒有向店員回答或提出需求。' }
    : {
        INCOMPLETE: '顧客正在說一個可點餐操作但語句明顯尚未說完，例如「我要一份……」；不能因缺少數量、規格、唯一 target 或對應候選而選此項。完整訂購但無合法新增候選應選 NEEDS_ASSISTANT。已向本機求助但說不清楚要做什麼，是需要釐清的完整求助，選NEEDS_ASSISTANT；不是安靜等待更多訂購字詞。Kiosk 會安靜等待下一句，不能執行操作。',
        GREET: '只向店員／本機打招呼，沒有提出點餐、查詢或其他需求。招呼加點餐必須選點餐意圖；對同伴打招呼屬 IGNORE。',
        IGNORE: '叫同伴名字向他說話或提問，即使詢問餐點種類、報品名或要求操作，也屬此項。其他背景討論、招呼、閒聊或對已完成資訊回答的單純附和，沒有向店員／本機提出服務需求。不能因向本機提出的有效需求缺資料就選 IGNORE。',
        MULTI_ACTION: '顧客這一句向店員／本機明確要求兩個以上獨立的點餐服務操作；單一步驟無法完整完成，應保留整句交給 Main Agent，不可只執行其中一步。多個子句、一般討論或抱怨不等於多項操作。',
        NEEDS_ASSISTANT: '向店員／本機提出的點餐服務需求超出有限候選：需要餐點比較、推薦原因、未提供的飲食資料或其他服務推理；向本機求助但說不清楚需求也交接釐清，不猜操作。顧客已表達要點餐點，但只有 possible／fragment 商品證據、沒有合法新增候選時也選此項，交接確認品名；這不是語句未完成，不改成查詢。無關話語即使有疑問或解釋語氣仍是 IGNORE；不能因有「問題」就交給助手。已提供的食材包含／排除及飲食條件查詢不屬於此項。',
      }
  if (input.review) {
    for (const key of Object.keys(criteria)) delete criteria[key]
    criteria.SATISFIED = '實際結果回答原句的同一個需求，target 與條件沒有被替換，且回覆有結果支持；結束本輪。'
    criteria.DEVIATED = '本次理解或執行結果改變原需求，例如把特定商品問題改成泛食材搜尋、回答不同商品、漏掉必要條件。不得自動重做。'
    criteria.UNCERTAIN = '無法確認原需求與實際結果一致，或沒有足夠資料證明需求已完成。停止核對，交接原句與真實結果。'
  }
  if (phase === 'pending_confirmation')
    criteria.NEW_REQUEST = '顧客明確提出另一個點餐需求、詢問本機身分／能力／店家服務資訊或改主意，不是在授權目前待確認的操作；先撤銷舊確認，再處理完整新需求。背景話語不是新需求。'
  if (phase === 'configuration')
    criteria.NEW_REQUEST = '顧客提出另一個需求或查詢，不是回答這筆餐點的缺漏設定。原問題問份數／規格，卻單說另一個真實菜單品名或分類，也選此項，不必出現「我要」「改成」。品名不是份數，換話題不是取消。先重新判斷新需求，只有明確換餐點才替換未加入的餐點；本選項不直接變更訂單。背景話語不是新需求。'
  if (phase === 'meal_confirmation')
    criteria.NEW_REQUEST = '顧客明確提出查價、其他餐點或不同服務需求，不是在回答這題是／不是；交接新需求，保留原本點餐進度。'
  if (!input.review && (!phase || phase === 'ordering')) {
    criteria.GENERAL_QUESTION = '顧客直接詢問本機身分、名稱、能力、電話用途或店家服務資訊（店名、營業時間、付款方式、發票、點餐管道、取餐／送餐方式），只詢問資訊而非要求操作；不需要餐點、價格、庫存或訂單事實。餐點偏好、拒絕先前餐點或含糊飲食需求不是一般問題；不能靠這項直接介紹餐點。'
    criteria.MENU_QUERY = '顧客表達或修改想吃／不想吃的餐點範圍、飲食偏好、排除條件、複合條件或改口；或查證、比較與解釋餐點。整句交給助手理解並查詢，不把提到的分類當成正向查詢，不拆成新增或移除訂單。單純查已知品名／分類、明確單份價格，或原條件不變的推薦／換批，仍選已有的精確意圖。'
  }
  if (canClarify && !input.review)
    criteria.CLARIFY_REQUEST = '確定顧客向本機提出服務需求，但不能確定是否要點提案中的餐點；用已提供的提案反問一次。正在回答確認問題但答案不清楚也選此項。對象不明、背景聊天不是此項，不因低信心就選；明確查價／篩選直接選查詢。'
  if (!followUp && !input.review && input.decisionState?.activeRequest)
    criteria.FOLLOW_UP_ACTIVE = '顧客這句是在補充或修正目前仍由 Main Agent 處理的上一句需求；不是獨立新訂單。只選關係，不決定如何中斷工具。'
  if (phase === 'clarification') {
    criteria.CLARIFICATION = '顧客正在回答或詢問這次釐清問題，但完整回答仍無法唯一對應列出的 target。保留問題，繼續以語音釐清，不取消需求；不是背景語音。'
    criteria.NEW_REQUEST = '顧客提出不同的新需求或查詢，不是在選擇原問題的餐點；先判斷新需求，查詢不等於取消原需求。不是背景語音。'
  }
  if (!input.review && input.decisionState?.incompleteSpeech && !input.decisionState.incompleteSpeech.related)
    criteria.CONTINUE_INCOMPLETE = '顧客正在補上或修正尚未完成的同一個需求，需從兩個獨立語音片段重新解析；完整的新需求直接選其意圖，不強制承接舊片段。'
  for (const candidate of eligibleCandidates) criteria[candidate.id] = candidate.description
  if (waitingFor) {
    for (const choice of questionChoices)
      criteria[choice.id] = `${choice.description} 若本句是在回答有效問題「${waitingFor.question}」，只能承接這個效果；明確獨立需求仍可直接選其合法意圖。`
  }
  if (phase === 'checkout_invoice' && !input.review) {
    criteria.INCOMPLETE = '語句明顯停在一半，還沒表達選擇。省略畫面已知的操作對象仍是完整指令；單說略過、跳過、捐贈、載具或付款方式不是此項。'
    criteria.NEEDS_ASSISTANT = '詢問流程或可否略過，尚未選擇；或要求候選不能完成的其他服務。'
  }
  if (phase === 'meal_confirmation' && !input.review) {
    // Keep opaque browser ticket IDs out of this simple semantic choice. Only
    // YES/NO below map back to the two answers of this exact live question.
    for (const choice of questionChoices) delete criteria[choice.id]
    const inquiry = eligibleCandidates.find(candidate => candidate.id.startsWith('inquire-meal:'))
    if (inquiry) {
      delete criteria[inquiry.id]
      criteria.READ = inquiry.description
    }
    criteria.IGNORE = '叫同伴名字向他提問、請同伴去問，或背景聊天。即使提到菜名、還有沒有，也不是向本機查詢。'
    criteria.YES = '單純肯定要點這款餐點，例如對、是、沒錯、我要。'
    criteria.NO = '單純否認要點，例如不是、不要、沒有；後面沒有改提查詢。不是開頭但接著詢問還有沒有，屬查詢。'
  }
  try {
    const state = createDecisionState(input)
    const instructions = input.review
      ? '比較顧客原句、相關角色對話、本次理解與真正執行結果。本次理解是待檢查的假設，不是顧客已確認的事實。只選 SATISFIED、DEVIATED、UNCERTAIN 或列出的有限後續查詢；不同需求不能因查到結果就算完成，不主動增加操作。'
      : phase === 'meal_confirmation'
        ? '只分類 customerUtterance，不把 pendingQuestion 當成顧客的需求。先判斷對象：叫同伴名字對他說話，一律 IGNORE。向本機詢問目前餐點還有沒有、能不能點，選已提供的查詢候選；先說不是再改問，也依完整查詢判斷。只有單純肯定或否定購買才選 YES／NO。其他明確新需求選 NEW_REQUEST；正在對本機說但意思不清選 CLARIFY_REQUEST。不得猜份數、加入或付款。'
        : phase === 'clarification'
          ? '保留原意圖，只從真實 target 候選選擇。先以完整回答的份數、口味、規格、序號等差異對照問題中的對象；省略品名但能唯一指涉也可選對應候選。否定屬性不能匹配相反的值，不能只看共同品名。只有仍無法唯一對應的回答或詢問問題意思才選 CLARIFICATION；背景話語選 IGNORE；不同的新需求選 NEW_REQUEST。不得發明 target。'
          : phase === 'configuration'
            ? '目前只補齊上一個新增餐點需求的必要資料。從列出的有限選項選本句明確回答的選項，保留原餐點與已知設定；只有明確取消該餐點才選取消。問份數／規格時，單說另一個有菜單證據的品名或分類，選 NEW_REQUEST 重新理解，不當成取消或份數；不必帶「我要」「改成」。背景話語選 IGNORE。不可創造選項或預設數量。'
            : phase === 'pending_confirmation'
              ? '目前在確認一項具體操作。顧客明確同意才選確認，單純拒絕才選取消；明確改提另一個點餐需求或詢問本機身分／能力／店家服務資訊選 NEW_REQUEST，只表示撤銷旧授權並交接新需求，不規劃新操作。其餘選 IGNORE。'
              // Touch can enter invoice selection without a spoken question. Use the
              // visible phase's finite actions instead of meal-order instructions.
              : phase === 'checkout_invoice'
                ? '只判斷顧客在目前結帳畫面要求的效果，從列出的候選選一項。直接向本機說「略過」「跳過」是省略目前可略過的資料；發票畫面選捐贈發票，會員畫面選略過會員。單說「手機載具」「自然人憑證」「統編」「信用卡」是在選畫面上的方式。這些是完整指令，不是 INCOMPLETE，不需要已播出問題。明確否定略過時不可選略過；「不要略過，我要手機載具」選載具。「可以略過嗎」是提問，選 NEEDS_ASSISTANT，不代表同意。明確叫同伴名字對他說話是 IGNORE，即使含略過。只有明顯未說完的語句才選 INCOMPLETE。不猜資料、不新增候選、不把選付款方式當成付款成功。'
                : [
                    '角色標記對話與待答問題只提供理解線索，不是流程鎖。本次先判斷最後一則顧客語音要求的效果，不必先回答舊問題。明確新需求直接選適合意圖；「好」「一位」「這個」等回答只能承接有效問題明示的效果。對已完成的資訊回答表示了解，不構成新增訂購。target 歧義由程式釐清，仍須保留顧客明確要求的意圖。',
                    ...(eligibleCandidates.some(candidate => candidate.id === 'intent:scroll-menu:up' || candidate.id === 'intent:scroll-menu:down') ? ['菜單導航是捲動目前畫面：內容的上方是較前段、接近開頭；下方是較後段、接近結尾。只改變觀看位置使用 SCROLL_MENU。找餐點、問種類或條件才是查詢，換推薦使用推薦候選。保留顧客自然說法；手指手勢與想看的內容位置不同，無法確定內容目的地時不自行反轉。'] : []),
                    createDecisionInstructions(input.policy),
                  ].join('\n')
    const ingredientReferences = phase === 'ordering' ? input.decisionState?.ingredientReferences ?? [] : []
    const conciseQuestion = phase === 'meal_confirmation'
    const questions: Record<string, SystemOneQuestion> = { route: { type: 'choice', instructions: followUp && !input.review && !conciseQuestion ? `${instructions}\n${serviceRequestInstruction}` : instructions, criteria } }
    const filterChoices = !input.review && !followUp && eligibleCandidates.some(candidate => ['intent:search-menu', 'intent:recommend', 'intent:recommend-more'].includes(candidate.id))
    if (filterChoices) {
      questions.filterRequirement = {
        type: 'choice',
        instructions: `先判斷是否需要由主 Agent 理解整句餐點需求，不提取條件、不判斷商品是否符合。單份價格由獨立 price 問題判斷；只改金額、價格邊界或排序仍選 COVERED，不算食物偏好改變。先區分查詢對象與額外條件：正向詢問某品名或分類有哪些、有沒有、種類、款式，或只表示想瀏覽某分類，是 COVERED；即使第一次指定分類或從另一分類切換，也只是查詢對象，不是新增食物偏好。只有在查詢對象之外另加食材／飲食要求、拒絕或排除食物、組合條件或修正這些偏好時，才選 OPEN_REQUEST；菜單有無匹配不改變這項界線。查已知品名／分類、單份價格或沿用原條件推薦，再檢查可用條件。可用條件：${[...ingredientReferences.map(reference => `${reference.label}：包含或排除`), ...(input.decisionState?.dietaryReferences ?? []).map(reference => reference.label), ...(prices?.choices.some(choice => choice.kind === 'condition') ? ['單份價格上限、下限、完整區間、精確價格、由低到高排序；具體邊界由獨立 price 問題判斷'] : [])].join('；') || '本句未解析出可用條件'}。詢問商品售價與不要求條件的查詢或推薦也是 COVERED；整筆預算或未提供價格條件不可忽略。`,
        criteria: {
          OPEN_REQUEST: '查詢對象之外另加或修改食材／飲食偏好、拒絕或排除食物、組合條件或修正這些偏好，需要完整理解。單純正向品名／分類瀏覽，以及單份價格改變不屬於此項。交接原句，不選餐點或規劃訂單操作。',
          COVERED: '正向詢問某品名／分類有哪些、有沒有、種類或款式，或想瀏覽某分類；首次指定或切換分類也是查詢對象，不是額外食物偏好。也包含單份售價、價格邊界／區間／排序與沿用條件換批。沒有額外飲食或排除要求；價格交獨立問題判定。',
          UNSUPPORTED_FILTER: '至少一項要求營養數據、過敏安全保證、更嚴格素別、其他未提供的條件，或條件互相矛盾。不可省略這項要求。',
        },
      }
      questions.filterPresence = { type: 'choice', instructions: '只判斷本句是否額外要求食材／飲食條件。詢問餐點名稱、種類、款式或有哪些，沒有額外成分要求時選 NO_FILTER；菜名包含食材字眼不等於成分篩選。價格上下限、區間或排序不屬於食材條件，僅談價格選 NO_FILTER。歷史條件已由程式保留，不是本句的新條件。不查菜單、不選操作。', criteria: { REQUIRED: '本句明確新增或修改包含／排除的食材或飲食條件。', NO_FILTER: '本句沒有新增或修改食材／飲食條件。只問價格範圍、價格排序、品名、分類、菜單、一般推薦或沿用原條件換批，都屬於此項。' } }
      if (input.decisionState?.productResolution?.status === 'none') {
        // A category/ingredient match does not cover an unrecognized dish name.
        // The finite browser plan cannot preserve that free-text subject, so
        // it must be looked up by Agent rather than widened into recommendations.
        questions.filterPresence.instructions = `本句沒有商品名稱匹配。已匹配分類：${JSON.stringify(input.decisionState.catalogEvidence?.categories.map(category => category.matchedText) ?? [])}。只判斷查詢範圍：泛問菜單、上述分類、價格或推薦且沒有成分要求，選 NO_FILTER；明確包含／排除食材或飲食條件選 REQUIRED；詢問另一個具體餐點名稱，但不是上述分類本身，選 UNRESOLVED_SUBJECT。金額數字、價格上限／下限／區間／排序不是餐點名稱；只有價格條件而沒有具體品名時，必須選 NO_FILTER，價格由獨立問題處理。陌生餐點名稱不能拆成分類或食材查詢，不核對有沒有賣。`
        questions.filterPresence.criteria = {
          REQUIRED: '要求包含／排除食材或飲食條件，不是在問特定品名。',
          NO_FILTER: '泛問菜單、已匹配分類、推薦或單純價格條件；價格數字不是品名。沒有另提具體餐點名稱或食材條件。',
          UNRESOLVED_SUBJECT: '在問尚未匹配的具體餐點名稱，不是分類、金額數字、食材條件或一般餐點用語。不能以分類、食材或一般推薦代替該品名。',
        }
      }
      if (input.decisionState?.productResolution?.status === 'possible' || input.decisionState?.productResolution?.status === 'overflow') {
        questions.filterPresence = {
          type: 'choice',
          instructions: '本句有未確認的商品名稱線索。只區分商品查詢與食材要求；有限商品候選不是已確認 target，食材提及也不是已確認條件。',
          criteria: {
            PRODUCT_QUERY: '顧客在問餐點名稱；食材字眼只是可能的品名，不要求所有含該食材的餐點。',
            REQUIRED: '顧客明確要求包含／排除食材的餐點，而不是查特定餐點名稱。',
            BOTH: '同時查特定餐點並要求食材條件，兩個限制都不能省略。',
            UNCERTAIN: '無法確定是商品名稱、食材篩選或兩者，不能直接用一種解讀查詢。',
          },
        }
      }
      if (input.decisionState?.dietaryReferences?.some(reference => reference.id === 'vegetarian'))
        questions.dietary = { type: 'choice', instructions: '只判斷本句是否要求已提供的素食條件；符合與否由店家標示驗證。', criteria: { VEGETARIAN: '本句要求素食，可能還有其他已提供食材條件。', UNSUPPORTED: '拒絕素食、要求更嚴格素別或語意有衝突，不能用一般素食條件執行。' } }
      for (const reference of input.decisionState?.unavailableConditionReferences ?? []) {
        questions[`unavailable:${reference.id}`] = {
          type: 'choice',
          instructions: `本句是否把「${reference.label}」當成餐點必須符合的條件？只選要求或提及，不查菜單，不推測資料。`,
          criteria: { REQUIRED: `本句要求餐點符合${reference.label}相關條件。`, MENTION_ONLY: '只出現在餐點品名、敘述或其他話題中，没有要求餐點符合這項條件。' },
        }
      }
    }
    if (filterChoices && priceQuestion)
      questions.price = priceQuestion
    for (const reference of ingredientReferences) {
      questions[`ingredient:${reference.id}`] = {
        type: 'choice',
        instructions: '只判斷最後一句是否額外要求食材條件。食材字詞若只是餐點或分類名稱的一部分，詢問其種類、款式、有哪些或有沒有，選 NONE；不能從菜名推論顧客要求成分。顧客另外明確要求包含或排除該食材時，才選 INCLUDE 或 EXCLUDE。歷史台詞或助手舉例不是本句的新條件。不選餐點、不規劃操作。',
        criteria: { EXCLUDE: `本句明確要求排除${reference.label}，不是只提及品名。`, INCLUDE: `本句明確要求餐點含有${reference.label}，作為額外食材篩選；品名含這個字不算。`, NONE: `${reference.label}只是餐點名稱、詢問款式或其他敘述，沒有額外要求成分條件。` },
      }
    }
    // Establish the route first. Conditions cannot change a non-read route,
    // so do not spend forwards evaluating them for background or checkout.
    const result = await invoke(state, { route: questions.route! })
    let answer = result.answers?.route as { choice?: unknown, confidence?: unknown } | undefined
    let confidence = typeof answer?.confidence === 'number' ? answer.confidence : undefined
    let actionId = typeof answer?.choice === 'string' ? answer.choice : undefined
    if (phase === 'meal_confirmation' && answer?.choice === 'READ')
      actionId = eligibleCandidates.find(candidate => candidate.id.startsWith('inquire-meal:'))?.id
    let selected = eligibleCandidates.find(candidate => candidate.id === actionId)
    const trace: { trace?: KioskDecisionTrace, supersededQuestionId?: string, priceChoiceId?: string } = (input.includeTrace ? { trace: { rawTranscript: transcript.raw, exchanges, candidateIntents: eligibleCandidates, decisionState: state, rawAnswer: answer, transcript: input.transcript } } : {})
    if (phase === 'ordering' && (actionId === 'intent:scroll-menu:up' || actionId === 'intent:scroll-menu:down')) {
      // Content destination is independent of finger motion. Keep this finite
      // check separate from the broad route until replay evidence supports removal.
      const destination = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { destination: {
        type: 'choice',
        instructions: '顧客要顯示哪裡的菜單內容？依想看的內容位置選擇，不依手指動作方向。只有手勢、未交代想看的位置時選 OTHER。對同伴說話、查餐點或換推薦也選 OTHER。',
        criteria: { EARLIER: '想看目前位置上方、較前段、接近菜單開頭的內容。', LATER: '想看目前位置下方、較後段、接近菜單結尾的內容。', OTHER: '只有手指動作，沒有交代想看的內容位置；或對同伴說話、換推薦、不是捲動菜單。' },
      } })).answers?.destination as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'scroll-destination', proposedActionId: actionId, answer: destination }
      if (!destination || !['EARLIER', 'LATER'].includes(String(destination.choice)) || typeof destination.confidence !== 'number' || !Number.isFinite(destination.confidence) || destination.confidence < 0.6 || destination.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      const verifiedId = destination.choice === 'EARLIER' ? 'intent:scroll-menu:up' : 'intent:scroll-menu:down'
      const verified = eligibleCandidates.find(candidate => candidate.id === verifiedId)
      if (!verified)
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      actionId = verifiedId
      selected = verified
      confidence = Math.min(confidence ?? 0, destination.confidence)
    }
    // A matched meal is a subject, not purchase authority. Check proposed cart
    // mutations, including the first item, before opening a purchase draft or
    // consuming an unrelated fulfillment/invitation question. CART_LINE refs
    // provide actual cart context; history alone never invents an order line.
    const cartReferences = input.decisionState?.references?.filter(reference => reference.refId.startsWith('CART_LINE_')) ?? []
    // Both a weak partial mutation and a weak compound route can describe the
    // same replacement. Recipient verification must precede this narrow check;
    // it admits the whole utterance, never a target or permission to mutate.
    async function qualifyReplacement(): Promise<KioskInteractionDecision> {
      const replacement = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { replacement: {
        type: 'choice',
        instructions: '這句話是在要求將一種餐點改成另一種餐點嗎？只判斷語意，不查菜單或購物車，不確認商品、份數或能不能換；這些由程式處理。A幫我改B、A改B、A換成B，都是換餐點。加一份B、A改兩份、A不要辣，則不是換成另一種餐點。詢問能不能換或意思不明選 OTHER。',
        criteria: { REPLACE: '要求把原餐點改成另一種餐點。', OTHER: '不是要求換成另一種餐點。' },
      } })).answers?.replacement as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'weak-cart-replacement', replacement }
      if (replacement?.choice === 'REPLACE' && typeof replacement.confidence === 'number' && Number.isFinite(replacement.confidence) && replacement.confidence >= 0.6 && replacement.confidence <= 1)
        return { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', confidence: replacement.confidence, ...trace }
      return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
    }
    const cartEffects: Record<string, string> = {
      'intent:add-item': '只新增餐點，所有原購物車餐點保留，不更換、不移除。',
      'intent:remove-item': '只移除既有餐點，不新增替代品項。',
      'intent:set-quantity': '只調整原餐點份數，不改成另一道餐點。',
      'intent:set-option': '只調整原餐點的口味或選項，不改成另一道餐點。',
    }
    const proposedEffect = selected && cartEffects[selected.id]
    if (!input.review && !followUp && phase === 'ordering' && selected && proposedEffect) {
      // Determine communicative purpose without showing the model an assumed
      // action. Combining reads with whole-operation coverage made a first
      // purchase look like a query, and quantity-bearing questions look like buys.
      // Use the browser's literal matched subject in contrast examples.
      // This teaches the speech form across the live catalog without assigning
      // that subject, quantity or intent to the customer's actual request.
      const subject = input.decisionState?.catalogEvidence?.products[0]?.matchedText ?? '餐點'
      const purpose = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { requestPurpose: {
        type: 'choice',
        instructions: `只判斷這一句是在詢問資訊，還是要求操作。不核對菜單、不判斷份數是否齊全、不規劃步驟。直接報品名與份數是要求訂購；問價格、每份內容、種類或有沒有是在詢問資訊，問句含份數也不是訂購。對比：${JSON.stringify(`${subject}一份`)} 、${JSON.stringify(`${subject}兩份`)}、${JSON.stringify(`兩份${subject}`)} 都是 OPERATION，份數與詞序不改變訂購目的；${JSON.stringify(`${subject}一份多少錢`)}、${JSON.stringify(`有哪種${subject}`)} 是 INQUIRY。只分類 customerUtterance，例句不是顧客需求或操作授權。`,
        criteria: { INQUIRY: '詢問資訊，例如價格、每份內容、種類、有沒有；沒有要求現在改訂單。', OPERATION: '要求現在訂購或修改訂單，包括直接報餐點與份數的點單短句，以及更換、取消、調整要求。' },
      } })).answers?.requestPurpose as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'cart-operation-coverage', proposedAction: selected.id, purpose }
      if (!purpose || !['INQUIRY', 'OPERATION'].includes(String(purpose.choice)))
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      if (typeof purpose.confidence !== 'number' || !Number.isFinite(purpose.confidence) || purpose.confidence < 0 || purpose.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      const uncertainPurpose = purpose.confidence < 0.6
      const readOnly = purpose.choice === 'INQUIRY' && !uncertainPurpose
      // A weak purpose answer is not evidence of an inquiry or consent. Keep
      // the original route and whole-effect checks authoritative in that case;
      // both must independently pass before a single operation may execute.
      const coverage = readOnly
        ? { choice: 'READ_ONLY', confidence: purpose.confidence }
        : (await invoke(JSON.stringify({ customerUtterance: input.transcript, proposedAction: proposedEffect, cartItems: cartReferences.map(reference => reference.label), lastAddedMeal: input.decisionState?.interactionState?.lastAddedItemName }), { cartRequest: {
            type: 'choice',
            instructions: '只判斷 customerUtterance 的整句效果和說話對象，不規劃步驟、不選商品或數量。SINGLE：向本機提出的整句需求，完全只有 proposedAction 這一個效果。新增是增加份數，不是指定既有品項最後總數；指定總份數選TOTAL（有提供時），否則HANDOFF。HANDOFF：向本機要求換成另一道餐點，或整句還有 proposedAction 沒涵蓋的服務需求；不要只做其中一半。「水餃不要，改牛肉麵」「水餃換牛肉麵一份」「剛才那份改牛肉麵」都是更換既有餐點，要交接整句；不能因為有新增替代品項，就當成只新增。「再加一份牛肉麵」只是新增。「水餃改兩份」只是改數量。更換目標不在菜單也屬 HANDOFF，不核對有沒有賣。對同伴說話選 BACKGROUND；對象或意思不明選 UNCERTAIN。',
            criteria: {
              ...(selected.id === 'intent:add-item' && cartReferences.length ? { TOTAL: '顧客指定購物車既有餐點最後的總份數，不是再多加這些份數。這是改既有數量，不是新增；例如原有一份，最後共兩份，就是把總數設為二，不是變成三。' } : {}),
              SINGLE: '顧客不是在問資訊，而是要求執行 proposedAction 這一件事。直接報品名加份數的點單短句也是訂購，不必有「我要」。沒有另外要求更換、取消、查詢或其他操作。',
              HANDOFF: '向本機要求把原品項換成另一道餐點，或還有提案之外的其他服務需求。單純加點、移除或改數量若與提案相符，是 SINGLE。',
              BACKGROUND: '對同伴說話或背景聊天，沒有向本機提出需求。',
              UNCERTAIN: '無法確認對象或整句意思。',
            },
          } })).answers?.cartRequest as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'cart-operation-coverage', proposedAction: selected.id, purpose, answer: coverage }
      if (!coverage || !['SINGLE', 'HANDOFF', 'BACKGROUND', 'UNCERTAIN', ...(selected.id === 'intent:add-item' && cartReferences.length ? ['TOTAL'] : []), ...(readOnly ? ['READ_ONLY'] : [])].includes(String(coverage.choice)))
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      if (coverage.choice === 'HANDOFF' && typeof coverage.confidence === 'number' && Number.isFinite(coverage.confidence) && coverage.confidence >= 0 && coverage.confidence < 0.6 && cartReferences.length) {
        // Weak coverage cannot authorize the proposed partial mutation. Qualify
        // recipient and replacement semantics independently, without showing
        // the assumed ADD/REMOVE action or the pending fulfillment question.
        // Cart presence gates recovery; it does not confirm the source target.
        // This only routes the original utterance; Agent tools still resolve and
        // authorize every target/effect against fresh browser state.
        const recipient = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { recipient: recipientQuestion })).answers?.recipient as { choice?: string, confidence?: number } | undefined
        if (trace.trace)
          trace.trace.semanticCheck = { kind: 'weak-cart-replacement', recipient }
        if (!recipient || typeof recipient.confidence !== 'number' || !Number.isFinite(recipient.confidence) || recipient.confidence < 0.6 || recipient.confidence > 1)
          return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
        if (recipient.choice === 'OTHER')
          return { kind: 'IGNORE', confidence: recipient.confidence, ...trace }
        if (recipient.choice !== 'KIOSK')
          return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
        return await qualifyReplacement()
      }
      if (typeof coverage.confidence !== 'number' || !Number.isFinite(coverage.confidence) || coverage.confidence < 0 || coverage.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      // A reliable order request can still have uncertain whole-request
      // coverage: one proposed mutation may omit a second requested effect.
      // This grants no single-action authority. Verify the recipient below,
      // then let Main resolve the original utterance against fresh cart state.
      const unresolvedOperation = coverage.choice === 'SINGLE' && coverage.confidence < 0.6 && !uncertainPurpose && typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0.6 && confidence <= 1
      if ((coverage.confidence < 0.6 && !unresolvedOperation) || coverage.choice === 'UNCERTAIN')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (coverage.choice === 'BACKGROUND')
        return { kind: 'IGNORE', confidence: coverage.confidence, ...trace }
      if (unresolvedOperation || coverage.choice === 'READ_ONLY' || ['HANDOFF', 'TOTAL'].includes(String(coverage.choice)) || confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1) {
        // Coverage alone is not admission: mentioning a complete replacement
        // to a companion must not promote a weak route into an Agent task.
        // Isolate the literal utterance so cart/history cannot imply consent.
        const service = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { service: {
          type: 'choice',
          instructions: '只判斷 customerUtterance 的說話對象。向本機／店員詢問或回答，即使是短句，選 REQUEST。叫同伴名字對他說話、討論事情或背景聊天選 BACKGROUND。例：「水餃不要，改牛肉麵」是 REQUEST；「小王，水餃不要，改牛肉麵」是 BACKGROUND。人名指名不是叫本機；明確指令或餐點更換也不能蓋過說話對象。',
          criteria: { REQUEST: '向點餐機／店員提出需求或回答。', BACKGROUND: '向同伴說話或背景聊天。', UNCERTAIN: '無法確認對象。' },
        } })).answers?.service as { choice?: string, confidence?: number } | undefined
        if (trace.trace)
          trace.trace.semanticCheck = { kind: 'cart-operation-coverage', proposedAction: selected.id, purpose, answer: coverage, service }
        if (!service || typeof service.confidence !== 'number' || !Number.isFinite(service.confidence) || service.confidence < 0.6 || service.confidence > 1 || service.choice === 'UNCERTAIN')
          return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
        if (service.choice === 'BACKGROUND')
          return { kind: 'IGNORE', confidence: service.confidence, ...trace }
        if (service.choice !== 'REQUEST')
          return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
        qualifiedRequest = true
        recipientVerified = true
        if (invitation)
          trace.supersededQuestionId = invitation.questionId
        if (coverage.choice === 'READ_ONLY') {
          // Rejoin the existing read path so unsupported conditions, prices
          // and ingredient ambiguity cannot disappear during recovery.
          const search = eligibleCandidates.find(candidate => candidate.id === 'intent:search-menu')
          if (!search)
            return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: coverage.confidence, ...trace })
          answer = { choice: search.id, confidence: coverage.confidence }
          actionId = search.id
          confidence = coverage.confidence
          selected = search
        }
        else {
          return { kind: 'NEEDS_ASSISTANT', reason: ['HANDOFF', 'TOTAL'].includes(String(coverage.choice)) ? 'NEW_REQUEST' : 'UNCERTAIN_OPERATION', confidence: coverage.confidence, ...trace }
        }
      }
    }
    const categories = input.decisionState?.catalogEvidence?.categories ?? []
    const weakIncomplete = confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1
    if (!input.review && !followUp && (phase === 'ordering' || phase === undefined) && answer?.choice === 'INCOMPLETE' && (weakIncomplete || categories.length > 0)) {
      // A category-only follow-up can be a complete lookup, even when the broad
      // model confidently calls it unfinished. Evidence is not intent: verify
      // the recipient first, without repeating the clerk's pending question.
      const scope = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { service: {
        type: 'choice',
        instructions: '只判斷 customerUtterance 的說話對象。向本機／店員詢問或回答，即使是短句，選 REQUEST。叫同伴名字對他說話、討論事情或背景聊天選 BACKGROUND。提到餐點或分類不代表對本機說話。',
        criteria: { REQUEST: '向點餐機／店員提出需求或回答。', BACKGROUND: '向同伴說話或背景聊天。', UNCERTAIN: '無法確認對象。' },
      } })).answers?.service as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'unfinished-speech', service: scope }
      if (!scope || typeof scope.confidence !== 'number' || !Number.isFinite(scope.confidence) || scope.confidence < 0.6 || scope.confidence > 1 || scope.choice === 'UNCERTAIN')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      if (scope.choice === 'BACKGROUND')
        return { kind: 'IGNORE', confidence: scope.confidence, ...trace }
      if (scope.choice !== 'REQUEST')
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      qualifiedRequest = true
      recipientVerified = true
      const search = categories.length ? eligibleCandidates.find(candidate => candidate.id === 'intent:search-menu') : undefined
      const speech = (await invoke(JSON.stringify({ customerUtterance: input.transcript, matchedCategories: categories.map(category => category.label), previousCustomerUtterance: input.conversation?.messages.findLast(message => message.role === 'user')?.content }), { speech: {
        type: 'choice',
        instructions: '已確認顧客向本機說話，只分類最後這一句。只說「我要一份……」「我想要……」而尚未說餐點，是 INCOMPLETE。只報分類、分類加「呢」「之類的」可承接上一句菜單查詢，是 QUERY，不必有動詞。前句不能替未完句補餐點。已說餐點但缺份數或規格，不算未說完。明確向本機求助卻無法說清楚需求，是完整求助選REQUEST，讓後續釐清意思，不當成訂購起頭等待。不得猜品項、份數、加入或取消。',
        criteria: { ...(search ? { QUERY: '完整的分類瀏覽或詢問，即使只報上述分類名稱；沒有指定購買。' } : {}), INCOMPLETE: '只說起頭或數量，停在餐點／需求還沒說出來的位置，例如「我要一份……」。', REQUEST: '已表達完整的求助、詢問、投訴、比較或訂購；明確求助但說不清楚目的仍是完整求助，不能猜操作；不是訂購起頭或數量後尚未說完。' },
      } })).answers?.speech as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'unfinished-speech', service: scope, speech }
      if (!speech || !['INCOMPLETE', 'REQUEST', ...(search ? ['QUERY'] : [])].includes(String(speech.choice)) || typeof speech.confidence !== 'number' || !Number.isFinite(speech.confidence) || speech.confidence < 0 || speech.confidence > 1)
        return providerFailure()
      // Recipient confidence cannot establish service relevance when speech
      // meaning is still weak. Rejoin the final serviceRequest checkpoint.
      if (speech.confidence < 0.6)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (speech.choice === 'REQUEST')
        return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', confidence: speech.confidence, ...trace }
      if (speech.choice === 'INCOMPLETE')
        return { kind: 'INCOMPLETE', confidence: speech.confidence, ...trace }
      // Recovered reads still pass normal filter/price validation below. The
      // recovery cannot resolve an old question or issue a new order mutation.
      answer = { choice: search!.id, confidence: speech.confidence }
      actionId = search!.id
      confidence = speech.confidence
      selected = search
    }
    if (phase === 'meal_confirmation' && !input.review && selected?.id.startsWith('inquire-meal:')) {
      // Availability wording also occurs in requests to a companion. The
      // combined route overweights that wording, so verify its recipient using
      // only the utterance before consuming the browser's pending proposal.
      const scope = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { service: {
        type: 'choice',
        instructions: '只判斷 customerUtterance 的說話對象。直接向本機／店員詢問或回答選 REQUEST。叫同伴名字並對他說話、請他去問、討論事情或背景聊天，選 BACKGROUND。提到餐點或查詢用語不代表對本機說話。',
        criteria: { REQUEST: '向點餐機／店員提出需求或回答。', BACKGROUND: '向同伴說話或背景聊天。', UNCERTAIN: '無法確認對象。' },
      } })).answers?.service as { choice?: string, confidence?: number } | undefined
      if (!scope || typeof scope.confidence !== 'number' || !Number.isFinite(scope.confidence) || scope.confidence < 0.6 || scope.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      if (scope.choice === 'BACKGROUND')
        return { kind: 'IGNORE', ...trace }
      if (scope.choice !== 'REQUEST')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      qualifiedRequest = true
    }
    if (phase === 'meal_confirmation' && (answer?.choice === 'YES' || answer?.choice === 'NO')) {
      const suffix = answer.choice === 'YES' ? ':yes' : ':no'
      const choice = questionChoices.find(choice => choice.id.startsWith('confirm-meal:') && choice.id.endsWith(suffix))
      if (!choice || waitingFor?.purpose !== 'confirm-meal' || confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      // This only advances a non-financial draft question. Payment/destructive
      // confirmations retain their existing separate answer verification.
      return { kind: 'FAST_ACTION', actionId: choice.id, confidence, answeredQuestionId: waitingFor.questionId, ...trace }
    }
    // Agent handoff admits speech into customer dialogue just like an action.
    // Fail closed before superseding a question; an uncertain read-result
    // review remains distinct because its original request was already admitted.
    const assistantRoute = answer?.choice === 'GENERAL_QUESTION' || answer?.choice === 'MENU_QUERY' || answer?.choice === 'NEEDS_ASSISTANT' || answer?.choice === 'MULTI_ACTION' || answer?.choice === 'CLARIFY_REQUEST'
      || (answer?.choice === 'FOLLOW_UP_ACTIVE' && Boolean(criteria.FOLLOW_UP_ACTIVE))
    // Search and recommendation routes compete for short follow-up inquiries.
    // Their weak choice cannot authorize a batch change, but can be independently
    // qualified as a factual read using the same boundary as weak MENU_QUERY.
    // Verify recipient and pure inquiry here before filter classification can
    // reject it; only the read-only handoff below may recover the request.
    // Pending invitations retain their concrete answer validation below; a
    // short acceptance is not independently a factual menu inquiry.
    const inquiryRoute = phase === 'ordering' && (selected?.id === 'intent:search-menu'
      || (!waitingFor && selected !== undefined && ['intent:recommend', 'intent:recommend-more'].includes(selected.id)))
    if (!input.review && (assistantRoute || inquiryRoute) && (confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1)) {
      // A weak broad route never gains mutation authority. Qualify its literal
      // recipient before trying the narrower, read-only menu-query boundary.
      const recipient = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { recipient: recipientQuestion })).answers?.recipient as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'weak-handoff-recipient', recipient }
      if (recipient?.choice === 'OTHER' && typeof recipient.confidence === 'number' && Number.isFinite(recipient.confidence) && recipient.confidence >= 0.6 && recipient.confidence <= 1)
        return { kind: 'IGNORE', confidence: recipient.confidence, ...trace }
      if (answer?.choice === 'MULTI_ACTION' && cartReferences.length
        && typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence < 0.6
        && recipient?.choice === 'KIOSK' && typeof recipient.confidence === 'number' && Number.isFinite(recipient.confidence) && recipient.confidence >= 0.6 && recipient.confidence <= 1) {
        // A replacement is not a factual inquiry. Resolve its complete semantic
        // purpose before the inquiry-only recovery can grant a read-only task.
        return await qualifyReplacement()
      }
      // The broad route mixes uncertainty about intent, catalog coverage and
      // execution. Verify a pure menu inquiry independently: an unknown dish
      // still deserves a factual lookup, but recipient confidence alone cannot
      // grant an operation or turn an uncertain request into a purchase.
      if (phase === 'ordering' && eligibleCandidates.some(candidate => candidate.id === 'intent:search-menu')
        && typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence < 0.6
        && recipient?.choice === 'KIOSK' && typeof recipient.confidence === 'number' && Number.isFinite(recipient.confidence) && recipient.confidence >= 0.6 && recipient.confidence <= 1) {
        const inquiry = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { menuInquiry: {
          type: 'choice',
          instructions: '只分類 customerUtterance 是否純粹詢問餐點／菜單資訊，不核對菜單、不判斷有沒有賣、不補餐點或份數。問販售、有無、價格、種類、成分、飲食條件或比較，且沒有要求改訂單，選 QUERY；陌生品名或查無資料仍可查詢。要求新增、刪除、更換、修改、結帳或付款，以及查詢後附帶操作，都選 OTHER。詢問本機身分及無關話題也是 OTHER。未說完或無法確定是否純查詢選 UNCERTAIN。',
          criteria: { QUERY: '只有餐點／菜單資訊查詢，不包含改訂單或付款操作。', OTHER: '操作、查詢兼操作、其他服務或無關話語。', UNCERTAIN: '無法確認是純菜單查詢。' },
        } })).answers?.menuInquiry as { choice?: string, confidence?: number } | undefined
        if (trace.trace)
          trace.trace.semanticCheck = { kind: 'weak-handoff-menu-inquiry', recipient, inquiry }
        if (inquiry?.choice === 'QUERY' && typeof inquiry.confidence === 'number' && Number.isFinite(inquiry.confidence) && inquiry.confidence >= 0.6 && inquiry.confidence <= 1)
          return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: inquiry.confidence, ...trace })
      }
      return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
    }
    // An invitation is conversational foreground, not an unfinished meal. A
    // verified independent demand replaces it, while its record stays retained.
    if (invitation && confidence !== undefined && confidence >= 0.6
      && ((selected && selected.id !== 'intent:recommend') || ['GENERAL_QUESTION', 'NEEDS_ASSISTANT', 'MULTI_ACTION'].includes(String(answer?.choice)))) {
      supersededQuestionId = invitation.questionId
      trace.supersededQuestionId = invitation.questionId
    }
    if (input.review) {
      if (answer?.choice === 'SATISFIED' && confidence !== undefined && confidence >= 0.6)
        return { kind: 'COMPLETE', confidence, ...trace }
      if (answer?.choice === 'DEVIATED')
        return { kind: 'NEEDS_ASSISTANT', reason: 'DEVIATED', ...trace }
      if (answer?.choice === 'UNCERTAIN' || answer?.choice === 'SATISFIED')
        return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_REVIEW', ...trace }
      if (!selected || confidence === undefined || confidence < 0.6)
        return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_REVIEW', ...trace }
    }
    if (canClarify && answer?.choice === 'CLARIFY_REQUEST' && !input.review)
      return { kind: 'NEEDS_CLARIFICATION', confidence, ...trace }
    if ((phase === 'pending_confirmation' || phase === 'configuration' || phase === 'clarification' || phase === 'meal_confirmation') && answer?.choice === 'NEW_REQUEST')
      return typeof confidence === 'number' && confidence >= 0.6 ? { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', confidence, ...trace } : { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
    // Assent to a list is not a choice within it, even when the model selects
    // a valid index confidently. Retain recipient admission before asking again.
    const unqualifiedTargetAnswer = waitingFor?.purpose === 'item-clarification'
      && questionChoices.filter(choice => choice.id.startsWith('clarify:') && !choice.id.endsWith(':cancel')).length > 1
      && isTargetAcknowledgement(input.transcript)
      && questionChoices.some(choice => choice.id === actionId)
    if (phase === 'clarification' && (answer?.choice === 'CLARIFICATION' || unqualifiedTargetAnswer)) {
      if (confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      // An unresolved target is not proof of who spoke. Qualify the literal
      // recipient before a voice retry; background/weak speech stays silent
      // and cannot consume or cancel the pending clarification.
      const recipient = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { recipient: recipientQuestion })).answers?.recipient as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'clarification-recipient', recipient }
      if (!recipient || typeof recipient.confidence !== 'number' || !Number.isFinite(recipient.confidence) || recipient.confidence < 0.6 || recipient.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      if (recipient.choice === 'OTHER')
        return { kind: 'IGNORE', confidence: recipient.confidence, ...trace }
      if (recipient.choice !== 'KIOSK')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
      return { kind: 'CLARIFICATION', confidence, ...trace }
    }
    if (answer?.choice === 'GREET' && criteria.GREET)
      return { ...await resolveGreeting(), ...trace }
    if (answer?.choice === 'CONTINUE_INCOMPLETE' && criteria.CONTINUE_INCOMPLETE) {
      if (confidence === undefined || confidence < 0.6)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      return { kind: 'CONTINUE_INCOMPLETE', ...trace }
    }
    // Ordinary questions share one answer contract. High-risk confirmation
    // remains a distinct one-use protocol, never an ordinary answer receipt.
    const questionEffect = waitingFor && phase !== 'pending_confirmation' && questionChoices.some(choice => choice.id === actionId)
    if (questionEffect) {
      const answerCriteria = Object.fromEntries(questionChoices.map(choice => [choice.id, choice.description]))
      const relationResult = await invoke(state, { relation: {
        type: 'choice',
        instructions: `只解析最後一句顧客語音是否向店員回答有效問題「${waitingFor.question}」，以及具體回答哪個合法選項。第一輪路由只是待驗證假設，不能假定顧客已同意，不需維持第一輪選擇。「改內用」「改自取／外帶」是新的用餐方式要求，不是同意結帳、選發票或暫緩；應選新的需求，不繼承舊問題的操作。依原句的肯定、否定、暫緩、值與對象區分效果；正在回答不等於同意。只能選下列已提供的答案，不猜值、商品或工具參數。問份數／規格時，單說另一個有菜單證據的品名或分類，屬 NEW_REQUEST，不是取消；不必帶「我要」「改成」。只重述原餐點不是取消。若拒絕後另提需求，選 NEW_REQUEST；無法確認選 UNCERTAIN。`,
        criteria: {
          ...answerCriteria,
          ...(canClarify ? { CLARIFY_REQUEST: '確定向本機提出服務需求，但答案無法對應是／不是或當前設定；用真實提案再確認。背景／對象不明不可選。' } : {}),
          NEW_REQUEST: '向店員提出獨立的新需求，不是回答上述問題；即使先拒絕原問題再提出新需求，也屬新需求。',
          BACKGROUND: '對同伴說話或背景閒聊，沒有向店員提出需求或回答。',
          UNCERTAIN: '無法確認本句的對象或具體答案，或沒有合法選項能表示回答；不得猜同意、拒絕或值。',
        },
      } })
      const relation = relationResult.answers?.relation as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.questionRelation = { questionId: waitingFor.questionId, ...relation }
      if (!relation?.choice || ![...questionChoices.map(choice => choice.id), 'NEW_REQUEST', 'BACKGROUND', 'UNCERTAIN', ...(canClarify ? ['CLARIFY_REQUEST'] : [])].includes(relation.choice))
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      // A weak broad route can still reach answer parsing; only a reliable,
      // concrete answer may grant its bounded effect. Uncertainty retains the
      // question and does not hand the same guess to Agent for execution.
      if (relation.choice === 'UNCERTAIN' || typeof relation.confidence !== 'number' || relation.confidence < 0.6)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (relation.choice === 'BACKGROUND')
        return { kind: 'IGNORE', confidence: relation.confidence, ...trace }
      if (relation.choice === 'CLARIFY_REQUEST')
        return { kind: 'NEEDS_CLARIFICATION', confidence: relation.confidence, ...trace }
      if (relation.choice === 'NEW_REQUEST') {
        // Relation parsing supplies the new topic, not independent proof that
        // a companion's instruction was addressed to this kiosk.
        const recipient = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { recipient: recipientQuestion })).answers?.recipient as { choice?: string, confidence?: number } | undefined
        if (!recipient || typeof recipient.confidence !== 'number' || !Number.isFinite(recipient.confidence) || recipient.confidence < 0.6 || recipient.confidence > 1)
          return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
        if (recipient.choice === 'OTHER')
          return { kind: 'IGNORE', confidence: recipient.confidence, ...trace }
        if (recipient.choice !== 'KIOSK')
          return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
        if (invitation) {
          supersededQuestionId = invitation.questionId
          trace.supersededQuestionId = invitation.questionId
        }
        return { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', confidence: relation.confidence, ...trace }
      }
      actionId = relation.choice
      confidence = relation.confidence
      // Concrete answer validation already distinguished a reply to this kiosk
      // from background speech; a resulting read must not ask scope again.
      recipientVerified = true
      selected = eligibleCandidates.find(candidate => candidate.id === actionId)
      if (invitation)
        answeredQuestionId = invitation.questionId
      if (actionId === 'DECLINE_INVITATION')
        return { kind: 'IGNORE', confidence, ...(answeredQuestionId ? { answeredQuestionId } : {}), ...trace }
    }
    if (answer?.choice === 'IGNORE')
      return { kind: 'IGNORE', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'INCOMPLETE')
      return { kind: 'INCOMPLETE', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'GENERAL_QUESTION' && criteria.GENERAL_QUESTION)
      return { kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', confidence, ...trace }
    if (answer?.choice === 'MENU_QUERY' && criteria.MENU_QUERY)
      return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence, ...trace })
    if (answer?.choice === 'NEEDS_ASSISTANT')
      return { kind: 'NEEDS_ASSISTANT', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'FOLLOW_UP_ACTIVE' && criteria.FOLLOW_UP_ACTIVE)
      return { kind: 'FOLLOW_UP_ACTIVE', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (answer?.choice === 'MULTI_ACTION')
      return { kind: 'NEEDS_ASSISTANT', ...(confidence === undefined ? {} : { confidence }), ...trace }
    if (actionId) {
      if (selected) {
        qualifiedRequest = typeof confidence === 'number' && confidence >= 0.6
        // No actor has reliably classified this utterance. Sending it to Main
        // Agent would bypass the background-speech filter, so fail closed.
        if (selected.requiresHighConfidence && confidence !== undefined && confidence < 0.5)
          return { kind: 'UNAVAILABLE', ...trace }
        let ingredientFilters: NonNullable<Extract<KioskInteractionDecision, { kind: 'FAST_ACTION' }>['ingredientFilters']> | undefined
        const requiresFilters = ['intent:search-menu', 'intent:recommend', 'intent:recommend-more'].includes(selected.id) && filterChoices
        // The finite read route cannot silently discard a budget when executing
        // an addition/checkout instead. Leave the whole request for clarification.
        if (prices && !requiresFilters) {
          // Currency can also be part of a real dish name or background speech.
          // Only an explicit NONE permits this already-selected non-read effect;
          // a real price requirement must not be reduced to a partial mutation.
          if (!questions.price)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER', ...trace }
          const response = await invoke(state, { price: questions.price })
          const price = response.answers?.price as { choice?: unknown, confidence?: unknown } | undefined
          if (trace.trace)
            trace.trace.priceAnswer = price
          if (price?.choice !== 'NONE' || typeof price.confidence !== 'number' || price.confidence < 0.6)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER', ...trace }
          trace.priceChoiceId = 'NONE'
        }
        const possibleProduct = input.decisionState?.productResolution?.status === 'possible' || input.decisionState?.productResolution?.status === 'overflow'
        if (requiresFilters) {
          const conditionQuestions = Object.fromEntries(Object.entries(questions).filter(([key]) => key !== 'route' && (!possibleProduct || ['filterRequirement', 'filterPresence', 'price'].includes(key))))
          // A food query addressed to a companion can look like a valid read
          // even at high route confidence. Verify scope before conditions,
          // isolated from cart/history and the clerk's wording.
          // Recovered reads already verified their recipient and do not repeat it.
          if (!recipientVerified) {
            const service = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { recipient: recipientQuestion })).answers?.recipient as { choice?: string, confidence?: number } | undefined
            if (trace.trace)
              trace.trace.semanticCheck = { kind: 'read-recipient', service }
            if (!service || typeof service.confidence !== 'number' || !Number.isFinite(service.confidence) || service.confidence < 0.6 || service.confidence > 1 || service.choice === 'UNCERTAIN')
              return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT', ...trace }
            if (service.choice === 'OTHER')
              return { kind: 'IGNORE', confidence: service.confidence, ...trace }
            if (service.choice !== 'KIOSK')
              return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
          }
          // Filters keep their original typed evidence and contextual state;
          // scope isolation must not change price or ingredient interpretation.
          // Classify the whole request before spending forwards on finite slots.
          // A catalog match cannot turn a rejected category into a positive lookup.
          const requirement = await invoke(state, { filterRequirement: questions.filterRequirement! })
          const scope = requirement.answers?.filterRequirement as { choice?: string, confidence?: number } | undefined
          if (trace.trace)
            trace.trace.filterRequirement = scope
          if (scope?.choice === 'OPEN_REQUEST') {
            if (typeof scope.confidence !== 'number' || !Number.isFinite(scope.confidence) || scope.confidence < 0 || scope.confidence > 1)
              return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
            if (scope.confidence < 0.6) {
              // A reliable read route permits reasoning about unclear filters,
              // but never a finite action or an unqualified price.
              if (typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0.6 && confidence <= 1)
                return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', confidence, ...trace })
              return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
            }
            return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: scope.confidence, ...trace })
          }
          if (!scope || !['COVERED', 'UNSUPPORTED_FILTER'].includes(String(scope.choice)) || typeof scope.confidence !== 'number' || !Number.isFinite(scope.confidence) || scope.confidence < 0.5 || scope.confidence > 1)
            return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace })
          if (scope.choice === 'UNSUPPORTED_FILTER')
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER', ...trace }
          const remainingQuestions = Object.fromEntries(Object.entries(conditionQuestions).filter(([key]) => key !== 'filterRequirement'))
          const conditions = await invoke(state, remainingQuestions)
          result.answers = { ...result.answers, ...conditions.answers, filterRequirement: scope }
        }
        if (requiresFilters && prices) {
          const price = result.answers?.price as { choice?: unknown, confidence?: unknown } | undefined
          if (trace.trace)
            trace.trace.priceAnswer = price
          const choice = prices.choices.find(choice => choice.id === price?.choice)
          if (!choice || typeof price?.confidence !== 'number' || price.confidence < 0.6)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
          trace.priceChoiceId = choice.id
          if (choice.kind === 'unsupported')
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_PRICE', ...trace }
        }
        const filterRequirement = result.answers?.filterRequirement as { choice?: unknown, confidence?: unknown } | undefined
        const interpretation = result.answers?.filterPresence as { choice?: unknown, confidence?: unknown } | undefined
        if (requiresFilters && possibleProduct) {
          if (filterRequirement?.choice !== 'COVERED' || typeof filterRequirement.confidence !== 'number' || filterRequirement.confidence < 0.5 || typeof interpretation?.confidence !== 'number' || interpretation.confidence < 0.5)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
          if (interpretation.choice === 'PRODUCT_QUERY') {
            if (selected.id !== 'intent:search-menu' || input.decisionState?.productResolution?.status === 'overflow' || !input.decisionState?.productResolution?.references.length)
              return { kind: 'NEEDS_ASSISTANT', reason: 'CANDIDATE_BUDGET', ...trace }
            if (input.decisionState.dietaryReferences?.length || input.decisionState.unavailableConditionReferences?.length)
              return { kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER', ...trace }
            return { kind: 'FAST_ACTION', actionId, searchInterpretation: 'product', ingredientFilters: { excludeIngredients: [], includeIngredients: [] }, confidence, ...trace }
          }
          if (interpretation.choice !== 'REQUIRED')
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER', ...trace }
          // Only a verified filter interpretation spends the remaining slot
          // forwards; a product query never asks the model to invent polarity.
          const slotQuestions = Object.fromEntries(Object.entries(questions).filter(([key]) => !['route', 'filterRequirement', 'filterPresence', 'price'].includes(key)))
          if (Object.keys(slotQuestions).length) {
            const slots = await invoke(state, slotQuestions)
            result.answers = { ...result.answers, ...slots.answers }
          }
        }
        if (requiresFilters) {
          const unavailableAnswers: Record<string, unknown> = {}
          for (const reference of input.decisionState?.unavailableConditionReferences ?? []) {
            const slot = result.answers?.[`unavailable:${reference.id}`] as { choice?: unknown, confidence?: unknown } | undefined
            unavailableAnswers[reference.id] = slot
            if (trace.trace)
              trace.trace.unavailableConditionAnswers = unavailableAnswers
            if (!slot || !['REQUIRED', 'MENTION_ONLY'].includes(String(slot.choice)) || typeof slot.confidence !== 'number' || slot.confidence < 0.5)
              return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
            if (slot.choice === 'REQUIRED')
              return { kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_FILTER', ...trace }
          }
          if (trace.trace)
            trace.trace.filterRequirement = filterRequirement
          if (trace.trace) {
            trace.trace.filterPresence = result.answers?.filterPresence
            trace.trace.dietaryAnswer = result.answers?.dietary
          }
          if (!filterRequirement || typeof filterRequirement.confidence !== 'number' || filterRequirement.confidence < 0.5 || filterRequirement.choice !== 'COVERED')
            return { kind: 'NEEDS_ASSISTANT', reason: filterRequirement?.choice === 'UNSUPPORTED_FILTER' ? 'UNSUPPORTED_FILTER' : 'UNCERTAIN_FILTER', ...trace }
          if (input.decisionState?.dietaryReferences?.some(reference => reference.id === 'vegetarian')) {
            const dietary = result.answers?.dietary as { choice?: unknown, confidence?: unknown } | undefined
            if (!dietary || dietary.choice !== 'VEGETARIAN' || typeof dietary.confidence !== 'number' || dietary.confidence < 0.5)
              return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
            ingredientFilters = { excludeIngredients: [], includeIngredients: [], dietary: 'vegetarian' }
          }
        }
        if (['intent:search-menu', 'intent:recommend', 'intent:recommend-more'].includes(selected.id) && ingredientReferences.length) {
          ingredientFilters ??= { excludeIngredients: [], includeIngredients: [] }
          const ingredientAnswers: Record<string, unknown> = {}
          for (const reference of ingredientReferences) {
            const slot = result.answers?.[`ingredient:${reference.id}`] as { choice?: unknown, confidence?: unknown } | undefined
            ingredientAnswers[reference.id] = slot
            if (trace.trace)
              trace.trace.ingredientAnswers = ingredientAnswers
            if (!slot || !['EXCLUDE', 'INCLUDE', 'NONE'].includes(String(slot.choice)) || typeof slot.confidence !== 'number' || slot.confidence < 0.5)
              return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
            if (slot.choice === 'EXCLUDE')
              ingredientFilters.excludeIngredients.push(reference.id)
            if (slot.choice === 'INCLUDE')
              ingredientFilters.includeIngredients.push(reference.id)
          }
        }
        if (requiresFilters) {
          const presence = result.answers?.filterPresence as { choice?: unknown, confidence?: unknown } | undefined
          if (input.decisionState?.productResolution?.status === 'none' && presence?.choice === 'UNRESOLVED_SUBJECT' && typeof presence.confidence === 'number' && Number.isFinite(presence.confidence) && presence.confidence >= 0.6 && presence.confidence <= 1)
            return await handoffMenu({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: presence.confidence, ...trace })
          if (!presence || !['REQUIRED', 'NO_FILTER'].includes(String(presence.choice)) || typeof presence.confidence !== 'number' || presence.confidence < 0.5)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
          const hasFilter = Boolean(ingredientFilters?.dietary || ingredientFilters?.excludeIngredients.length || ingredientFilters?.includeIngredients.length)
          if ((presence.choice === 'REQUIRED') !== hasFilter)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER', ...trace }
        }
        // Intent confidence does not identify a dish. Category-only evidence
        // can originate from an unknown name, so never authorize a category
        // member as its substitute, even when the category contains one item.
        if (actionId === 'intent:add-item' && input.decisionState?.productResolution?.status === 'none' && input.decisionState.catalogEvidence?.categories.reduce((count, category) => count + category.itemCount, 0) === 1)
          return { kind: 'NEEDS_ASSISTANT', confidence, ...trace }
        return { kind: 'FAST_ACTION', actionId, ...(possibleProduct ? { searchInterpretation: 'filter' as const } : {}), ...(ingredientFilters ? { ingredientFilters } : {}), ...(confidence === undefined ? {} : { confidence }), ...(answeredQuestionId ? { answeredQuestionId } : {}), ...trace }
      }
    }
    return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
  }
  catch { return providerFailure() }
}

function createDecisionState(input: Pick<DecisionInput, 'conversation' | 'review' | 'decisionState' | 'presenceState' | 'transcript'>) {
  if (input.decisionState?.phase === 'customer_entry' && !input.review) {
    return [
      '本機目前詢問：手機可以選填，也可以略過，直接開始點餐。',
      `近期角色對話：${JSON.stringify(input.conversation?.messages ?? [])}`,
      `顧客最新語音：${input.transcript}`,
    ].join('\n')
  }
  if (input.decisionState?.phase === 'meal_confirmation' && !input.review) {
    // Keep the actual utterance distinct from the clerk's proposal. A query
    // following a correction is not consent or a bare denial of that proposal.
    return JSON.stringify({ customerUtterance: input.transcript, pendingQuestion: input.decisionState.waitingFor?.question ?? '' })
  }
  const rawCheckout = input.decisionState?.checkoutSnapshot
  const checkout = rawCheckout && typeof rawCheckout === 'object' && !Array.isArray(rawCheckout)
    ? rawCheckout as Record<string, unknown>
    : undefined
  const checkoutSummary = checkout
    ? {
        stage: typeof checkout.stage === 'string' ? checkout.stage : input.decisionState?.phase,
        invoiceMethod: typeof checkout.invoiceMethod === 'string' ? checkout.invoiceMethod : undefined,
        hasCarrier: typeof checkout.carrierCode === 'string' && checkout.carrierCode.length > 0,
        hasTaxId: typeof checkout.taxId === 'string' && /^\d{8}$/.test(checkout.taxId),
      }
    : undefined
  if (input.decisionState?.phase === 'checkout_invoice' && !input.review) {
    // Touch can enter invoice selection before a spoken question. Ground short choices
    // in this step, without stale meal references or personal invoice codes.
    const waitingFor = input.decisionState.waitingFor
    return JSON.stringify({ customerUtterance: input.transcript, phase: input.decisionState.phase, checkout: checkoutSummary, pendingQuestion: waitingFor && waitingFor.expiresAt > Date.now() ? waitingFor : null })
  }
  return [
    `近期角色標記對話：${JSON.stringify(input.conversation?.messages ?? [])}`,
    ...(input.decisionState?.incompleteSpeech ? [`尚未完成的顧客語句（獨立片段）：${JSON.stringify(input.decisionState.incompleteSpeech)}`] : []),
    `正在等待回答的問題：${JSON.stringify(input.decisionState?.waitingFor && input.decisionState.waitingFor.expiresAt > Date.now() ? input.decisionState.waitingFor : null)}`,
    ...(input.review ? [`本次已執行結果：${input.review.observation}`, `已準備的回覆：${input.review.answer}`] : []),
    `現場 presence：${input.presenceState ?? '未知'}`,
    `目前 phase：${input.decisionState?.phase ?? 'unknown'}`,
    `目前可見畫面：${input.decisionState?.interactionState?.screen ?? 'unknown'}`,
    `付款狀態：${input.decisionState?.paymentState ?? 'unknown'}`,
    `結帳畫面摘要：${JSON.stringify(checkoutSummary ?? {})}`,
    `允許的付款方式：${JSON.stringify(input.decisionState?.allowedPaymentMethods ?? [])}`,
    `POS 提供的用餐方式：${JSON.stringify(input.decisionState?.fulfillmentModes ?? [])}`,
    `真實 domain references：${JSON.stringify(input.decisionState?.references ?? [])}`,
    ...(input.decisionState?.clarificationOffer ? [`可用單一品名確認提案（只能建立問題，不是下單授權）：${JSON.stringify(input.decisionState.clarificationOffer)}`] : []),
    `本句商品名稱證據（possible 不是已確認 target）：${JSON.stringify(input.decisionState?.productResolution ?? null)}`,
    `本句菜單匹配來源（name 是品名、alias 是店家別名、fragment 只是可能片段；分類項數不等於顧客指定品名）：${JSON.stringify(input.decisionState?.catalogEvidence ?? null)}`,
    `互動焦點：${JSON.stringify(input.decisionState?.interactionState ?? {})}`,
    `已解析限制：${JSON.stringify(input.decisionState?.constraints ?? { exclude: [] })}`,
    `本次已完成查詢：${JSON.stringify(input.decisionState?.completedReads?.map(receipt => ({ customerMessage: receipt.customerMessage })) ?? [])}`,
    `本句有限食材 references：${JSON.stringify(input.decisionState?.ingredientReferences ?? [])}`,
    // Choices already live in the price question. Repeating their complete
    // descriptions here made the classifier read the first inclusive bound
    // as the customer's request instead of distinguishing 不到 from 以下.
    ...(input.decisionState?.priceEvidence ? [`本句價格字面證據（不是授權或已解析條件）：${JSON.stringify(input.decisionState.priceEvidence.amounts)}`] : []),
    `本句有限飲食條件 references：${JSON.stringify(input.decisionState?.dietaryReferences ?? [])}`,
    `本句提及但資料不能驗證的條件 references：${JSON.stringify(input.decisionState?.unavailableConditionReferences ?? [])}`,
    `進行中需求：${JSON.stringify(input.decisionState?.activeRequest ?? {})}`,
    // The latest user turn comes after context. A long question receipt must
    // not become the apparent last utterance for a small bounded-choice model.
    `顧客語音：${input.transcript}`,
  ].join('\n')
}
