import type { SystemOnePolicyInput, SystemOneQuestion } from '../kiosk-system-one'
import type { DecisionConversation } from './context'
import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { normalizeTranscript } from './context'
import { decisionQuestionBudget } from './contracts'
import { createDecisionInstructions, serviceRequestInstruction } from './prompt'

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

interface DecisionInput {
  conversation?: DecisionConversation
  review?: { answer: string, observation: string }
  candidates: readonly KioskActionCandidate[]
  decisionState?: KioskDecisionState
  includeTrace?: boolean
  invoke: (state: string, questions: Record<string, SystemOneQuestion>) => Promise<{ answers?: Record<string, unknown> }>
  maxActionCandidates?: number
  maxQuestions?: number
  policy: SystemOnePolicyInput
  presenceState?: string
  transcript: string
}

// Scope is separate from task content: a perfectly valid menu query can still
// be addressed to a companion. Only literal customer speech enters this check.
const recipientQuestion: SystemOneQuestion = {
  type: 'choice',
  instructions: '只看 customerUtterance 的說話對象，不區分詢問或指令，不判斷操作能否執行。直接向本機／店員提問、點餐、要求修改、提出條件或簡短回答，都選 KIOSK。明確叫同伴名字向那個人說話或提問，選 OTHER；「你」指向前面被叫名字的人，不是本機。真的無法判斷對象才選 UNCERTAIN。',
  criteria: { KIOSK: '向點餐機／店員提出需求或回答，包含操作、更換、價格條件或省略短句，沒有指名向同伴說話。', OTHER: '叫同伴名字向他說話、提問或要求操作；即使談菜單也不是對點餐機。背景聊天也選此項。', UNCERTAIN: '無法確認在對誰說話。' },
}

/** Converts the current eligible action set into a finite System One choice. */
export async function decideInteraction(input: DecisionInput): Promise<KioskInteractionDecision> {
  let modelCalls = 0
  let modelQuestions = 0
  const result = await decideBoundedInteraction({ ...input, invoke: async (state, questions) => {
    if (modelQuestions + Object.keys(questions).length > (input.maxQuestions ?? decisionQuestionBudget))
      throw new Error('Decision question budget exhausted')
    modelCalls++
    modelQuestions += Object.keys(questions).length
    return await input.invoke(state, questions)
  } })
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
          GREET: '顧客只向服務中的店員／本機問好，沒有其他要求。',
          IGNORE: '對同伴問好、約同伴移動或閒聊，沒有向店員／本機提出需求。',
          REQUEST: '顧客向店員／本機提出點餐、查詢、修改等需求，或回答操作問題。即使含問好，仍是需求而非純招呼。',
        },
      },
    })
    const answer = result.answers?.greeting as { choice?: string, confidence?: number } | undefined
    if (!answer || typeof answer.confidence !== 'number' || answer.confidence < 0.6)
      return { kind: 'UNAVAILABLE' }
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
        instructions: '判斷最後一句的完整價格需求，只選已發出的價格解讀。金額是單份基本售價，不是數量或人數。不新增訂購、不猜售價、不做多份／總額預算分配。以下與以內含邊界；不到與低於不含；以上含邊界；超過不含。最便宜／便宜的先／先看便宜的表示由低到高排序；有上下限時選保留上下限的 _ASC 解讀，不可只選 ASC 或不排序的版本。剛好／正好／等於某價格是 EXACT，上下限相同，不可放寬成以下或以上。範圍分別判斷兩端：「100到130」含兩端，「100以上不到130」含下限、不含上限（RANGE_MAX_EXCLUSIVE），不可選含兩端的 RANGE。範圍必須完整符合上下界；左右、更便宜、整筆預算或候選無法完整表示時選 UNSUPPORTED。只詢價選 INFORMATION。',
        criteria: Object.fromEntries(prices.choices.map(choice => [choice.id, choice.description])),
      }
    : undefined
  if (phase === 'customer_entry' && !input.review) {
    // Do not repeat the clerk's invitation in this classification input: a
    // small model can classify that invitation instead of the final utterance.
    const state = JSON.stringify({ customerUtterance: input.transcript })
    const trace = input.includeTrace ? { trace: { exchanges, candidateIntents: eligibleCandidates, decisionState: state, transcript: input.transcript } } : {}
    try {
      const scope = (await invoke(state, { service: {
        type: 'choice',
        instructions: '只分類 customerUtterance。HELLO_ONLY 僅限對本機單純問好，沒有問題或要求。只要有提問或操作需求就選 REQUEST，含問好也一樣。叫同伴名字問好或聊天選 BACKGROUND；被叫名字的同伴不是本機。對比：「你好」是 HELLO_ONLY；「你好，你是誰」「你好，請略過電話」是 REQUEST；「小陳你好，好久不見」是 BACKGROUND。',
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
        instructions: '分類 customerUtterance 的目的。含招呼又提出需求時依需求分類。ORDER 是請你推薦、換其他推薦、想吃或訂購餐點，先提醒完成電話選擇。MENU 是單純詢問販售內容、價格或查證有沒有，不代表要推薦或點餐。ASK 是電話用途、身分或其他一般問題。SKIP 是明確省略電話或直接開始點餐；ENTER 是要填電話或否定略過。「可以略過嗎」是 ASK，「請略過」是 SKIP，「不要略過」是 ENTER。',
        criteria: { SKIP: '明確要求現在略過、不填電話或直接開始點餐。', ENTER: '要填電話，不略過。', ASK: '電話用途、可不可以略過、本機身分或其他一般問題。', MENU: '單純問賣什麼、餐點價格、成分或有沒有某餐點／分類，以及查證先前品項。', ORDER: '請推薦、換推薦、想吃或明確點餐、調整訂單；先完成電話選擇，不操作餐點。' },
      } })).answers?.phone as { choice?: string, confidence?: number } | undefined
      if (!choice || typeof choice.confidence !== 'number' || !Number.isFinite(choice.confidence) || choice.confidence < 0.6 || choice.confidence > 1)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (choice.choice === 'ORDER')
        // The host explains the prerequisite; this grants neither a phone skip
        // nor an order operation and does not start another Agent generation.
        return { kind: 'CUSTOMER_ENTRY_REQUIRED', confidence: choice.confidence, ...trace }
      if (choice.choice === 'MENU') {
        if (priceQuestion && prices) {
          const price = (await invoke(state, { price: priceQuestion })).answers?.price as { choice?: string, confidence?: number } | undefined
          const interpretation = prices.choices.find(candidate => candidate.id === price?.choice)
          if (!interpretation || typeof price?.confidence !== 'number' || !Number.isFinite(price.confidence) || price.confidence < 0.6 || price.confidence > 1)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
          return { kind: 'NEEDS_ASSISTANT', reason: interpretation.kind === 'unsupported' ? 'UNSUPPORTED_PRICE' : 'MENU_QUERY', priceChoiceId: interpretation.id, confidence: price.confidence, ...trace }
        }
        return { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: choice.confidence, ...trace }
      }
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
        INCOMPLETE: '顧客正在說一個可點餐操作但語句明顯尚未說完，例如「我要一份……」；不能因缺少數量、規格、唯一 target 或對應候選而選此項。完整訂購但無合法新增候選應選 NEEDS_ASSISTANT。Kiosk 會安靜等待下一句，不能執行操作。',
        GREET: '只向店員／本機打招呼，沒有提出點餐、查詢或其他需求。招呼加點餐必須選點餐意圖；對同伴打招呼屬 IGNORE。',
        IGNORE: '叫同伴名字向他說話或提問，即使詢問餐點種類、報品名或要求操作，也屬此項。其他背景討論、招呼、閒聊或對已完成資訊回答的單純附和，沒有向店員／本機提出服務需求。不能因向本機提出的有效需求缺資料就選 IGNORE。',
        MULTI_ACTION: '顧客這一句向店員／本機明確要求兩個以上獨立的點餐服務操作；單一步驟無法完整完成，應保留整句交給 Main Agent，不可只執行其中一步。多個子句、一般討論或抱怨不等於多項操作。',
        NEEDS_ASSISTANT: '向店員／本機提出的點餐服務需求超出有限候選，或直接詢問本機身分、名稱或能力（你是誰、你能做什麼）：需要餐點比較、推薦原因、未提供的飲食資料或其他服務推理。顧客已表達要點餐點，但只有 possible／fragment 商品證據、沒有合法新增候選時也選此項，交接確認品名；這不是語句未完成，不改成查詢。無關話語即使有疑問或解釋語氣仍是 IGNORE；不能因有「問題」就交給助手。已提供的食材包含／排除及飲食條件查詢不屬於此項。',
      }
  if (input.review) {
    for (const key of Object.keys(criteria)) delete criteria[key]
    criteria.SATISFIED = '實際結果回答原句的同一個需求，target 與條件沒有被替換，且回覆有結果支持；結束本輪。'
    criteria.DEVIATED = '本次理解或執行結果改變原需求，例如把特定商品問題改成泛食材搜尋、回答不同商品、漏掉必要條件。不得自動重做。'
    criteria.UNCERTAIN = '無法確認原需求與實際結果一致，或沒有足夠資料證明需求已完成。停止核對，交接原句與真實結果。'
  }
  if (phase === 'pending_confirmation')
    criteria.NEW_REQUEST = '顧客明確提出另一個點餐需求、詢問本機身分／能力或改主意，不是在授權目前待確認的操作；先撤銷舊確認，再處理完整新需求。背景話語不是新需求。'
  if (phase === 'configuration')
    criteria.NEW_REQUEST = '顧客提出另一個需求或查詢，不是回答這筆餐點的缺漏設定。原問題問份數／規格，卻單說另一個真實菜單品名或分類，也選此項，不必出現「我要」「改成」。品名不是份數，換話題不是取消。先重新判斷新需求，只有明確換餐點才替換未加入的餐點；本選項不直接變更訂單。背景話語不是新需求。'
  if (phase === 'meal_confirmation')
    criteria.NEW_REQUEST = '顧客明確提出查價、其他餐點或不同服務需求，不是在回答這題是／不是；交接新需求，保留原本點餐進度。'
  if (!input.review && (!phase || phase === 'ordering'))
    criteria.MENU_QUERY = '顧客查證先前介紹的品項：真的有嗎、菜單沒有吧、是否說錯餐點；或需要超出有限候選的餐點比較／解釋。必須交給助手先查菜單；不能用一般聊天回答。單純查詢、推薦與換批仍選已有的精確意圖。'
  if (canClarify && !input.review)
    criteria.CLARIFY_REQUEST = '確定顧客向本機提出服務需求，但不能確定是否要點提案中的餐點；用已提供的提案反問一次。正在回答確認問題但答案不清楚也選此項。對象不明、背景聊天不是此項，不因低信心就選；明確查價／篩選直接選查詢。'
  if (!followUp && !input.review && input.decisionState?.activeRequest)
    criteria.FOLLOW_UP_ACTIVE = '顧客這句是在補充或修正目前仍由 Main Agent 處理的上一句需求；不是獨立新訂單。只選關係，不決定如何中斷工具。'
  if (phase === 'clarification') {
    criteria.CLARIFICATION = '顧客正在回答這次釐清問題，但完整回答仍無法唯一對應列出的 target。結束這次補問並使用觸控；不是背景語音。'
    criteria.NEW_REQUEST = '顧客提出不同的新需求或查詢，不是在選擇原問題的餐點；先判斷新需求，查詢不等於取消原需求。不是背景語音。'
  }
  if (!input.review && input.decisionState?.incompleteSpeech && !input.decisionState.incompleteSpeech.related)
    criteria.CONTINUE_INCOMPLETE = '顧客正在補上或修正尚未完成的同一個需求，需從兩個獨立語音片段重新解析；完整的新需求直接選其意圖，不強制承接舊片段。'
  for (const candidate of eligibleCandidates) criteria[candidate.id] = candidate.description
  if (waitingFor) {
    for (const choice of questionChoices)
      criteria[choice.id] = `${choice.description} 若本句是在回答有效問題「${waitingFor.question}」，只能承接這個效果；明確獨立需求仍可直接選其合法意圖。`
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
          ? '保留原意圖，只從真實 target 候選選擇。有效但無法唯一對應的回答選 CLARIFICATION；背景話語選 IGNORE；不同的新需求選 NEW_REQUEST。不得發明 target。'
          : phase === 'configuration'
            ? '目前只補齊上一個新增餐點需求的必要資料。從列出的有限選項選本句明確回答的選項，保留原餐點與已知設定；只有明確取消該餐點才選取消。問份數／規格時，單說另一個有菜單證據的品名或分類，選 NEW_REQUEST 重新理解，不當成取消或份數；不必帶「我要」「改成」。背景話語選 IGNORE。不可創造選項或預設數量。'
            : phase === 'pending_confirmation'
              ? '目前在確認一項具體操作。顧客明確同意才選確認，單純拒絕才選取消；明確改提另一個點餐需求或詢問本機身分／能力選 NEW_REQUEST，只表示撤銷旧授權並交接新需求，不規劃新操作。其餘選 IGNORE。'
              : [
                  '角色標記對話與待答問題只提供理解線索，不是流程鎖。本次先判斷最後一則顧客語音要求的效果，不必先回答舊問題。明確新需求直接選適合意圖；「好」「一位」「這個」等回答只能承接有效問題明示的效果。對已完成的資訊回答表示了解，不構成新增訂購。target 歧義由程式釐清，仍須保留顧客明確要求的意圖。',
                  createDecisionInstructions(input.policy),
                ].join('\n')
    const ingredientReferences = phase === 'ordering' ? input.decisionState?.ingredientReferences ?? [] : []
    const conciseQuestion = phase === 'meal_confirmation'
    const questions: Record<string, SystemOneQuestion> = { route: { type: 'choice', instructions: followUp && !input.review && !conciseQuestion ? `${instructions}\n${serviceRequestInstruction}` : instructions, criteria } }
    const filterChoices = !input.review && !followUp && eligibleCandidates.some(candidate => ['intent:search-menu', 'intent:recommend', 'intent:recommend-more'].includes(candidate.id))
    if (filterChoices) {
      questions.filterRequirement = {
        type: 'choice',
        instructions: `只檢查本句是否要求未提供的篩選能力，不判斷商品是否符合。可用條件：${[...ingredientReferences.map(reference => `${reference.label}：包含或排除`), ...(input.decisionState?.dietaryReferences ?? []).map(reference => reference.label), ...(prices?.choices.some(choice => choice.kind === 'condition') ? ['單份價格上限、下限、完整區間、精確價格、由低到高排序；具體邊界由獨立 price 問題判斷'] : [])].join('；') || '本句未解析出可用條件'}。詢問商品售價與不要求條件的查詢或推薦也是 COVERED；整筆預算或未提供價格條件不可忽略。`,
        criteria: {
          COVERED: '顧客沒有要求條件；或要求的條件全部是上列可用條件。餐點是否符合交給程式查詢。',
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
    // A matched meal is a subject, not purchase authority. Check proposed cart
    // mutations, including the first item, before opening a purchase draft or
    // consuming an unrelated fulfillment/invitation question. CART_LINE refs
    // provide actual cart context; history alone never invents an order line.
    const cartReferences = input.decisionState?.references?.filter(reference => reference.refId.startsWith('CART_LINE_')) ?? []
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
            instructions: '只判斷 customerUtterance 的整句效果和說話對象，不規劃步驟、不選商品或數量。SINGLE：向本機提出的整句需求，完全只有 proposedAction 這一個效果。HANDOFF：向本機要求換成另一道餐點，或整句還有 proposedAction 沒涵蓋的服務需求；不要只做其中一半。「水餃不要，改牛肉麵」「水餃換牛肉麵一份」「剛才那份改牛肉麵」都是更換既有餐點，要交接整句；不能因為有新增替代品項，就當成只新增。「再加一份牛肉麵」只是新增。「水餃改兩份」只是改數量。更換目標不在菜單也屬 HANDOFF，不核對有沒有賣。對同伴說話選 BACKGROUND；對象或意思不明選 UNCERTAIN。',
            criteria: {
              SINGLE: '顧客不是在問資訊，而是要求執行 proposedAction 這一件事。直接報品名加份數的點單短句也是訂購，不必有「我要」。沒有另外要求更換、取消、查詢或其他操作。',
              HANDOFF: '向本機要求把原品項換成另一道餐點，或還有提案之外的其他服務需求。單純加點、移除或改數量若與提案相符，是 SINGLE。',
              BACKGROUND: '對同伴說話或背景聊天，沒有向本機提出需求。',
              UNCERTAIN: '無法確認對象或整句意思。',
            },
          } })).answers?.cartRequest as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'cart-operation-coverage', proposedAction: selected.id, purpose, answer: coverage }
      if (!coverage || !['SINGLE', 'HANDOFF', 'BACKGROUND', 'UNCERTAIN', ...(readOnly ? ['READ_ONLY'] : [])].includes(String(coverage.choice)))
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      if (typeof coverage.confidence !== 'number' || !Number.isFinite(coverage.confidence) || coverage.confidence < 0.6 || coverage.confidence > 1 || coverage.choice === 'UNCERTAIN')
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (coverage.choice === 'BACKGROUND')
        return { kind: 'IGNORE', confidence: coverage.confidence, ...trace }
      if (coverage.choice === 'READ_ONLY' || coverage.choice === 'HANDOFF' || confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1) {
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
            return { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: coverage.confidence, ...trace }
          answer = { choice: search.id, confidence: coverage.confidence }
          actionId = search.id
          confidence = coverage.confidence
          selected = search
        }
        else {
          return { kind: 'NEEDS_ASSISTANT', reason: coverage.choice === 'HANDOFF' ? 'NEW_REQUEST' : 'UNCERTAIN_OPERATION', confidence: coverage.confidence, ...trace }
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
        instructions: '已確認顧客向本機說話，只分類最後這一句。只說「我要一份……」「我想要……」而尚未說餐點，是 INCOMPLETE。只報分類、分類加「呢」「之類的」可承接上一句菜單查詢，是 QUERY，不必有動詞。前句不能替未完句補餐點。已說餐點但缺份數或規格，不算未說完。不得猜品項、份數、加入或取消。',
        criteria: { ...(search ? { QUERY: '完整的分類瀏覽或詢問，即使只報上述分類名稱；沒有指定購買。' } : {}), INCOMPLETE: '只說起頭或數量，停在餐點／需求還沒說出來的位置，例如「我要一份……」。', REQUEST: '已表達其他完整服務需求，例如詢問、投訴、比較或訂購；不是起頭或數量後尚未說完。' },
      } })).answers?.speech as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'unfinished-speech', service: scope, speech }
      if (!speech || !['INCOMPLETE', 'REQUEST', ...(search ? ['QUERY'] : [])].includes(String(speech.choice)) || typeof speech.confidence !== 'number' || !Number.isFinite(speech.confidence) || speech.confidence < 0 || speech.confidence > 1)
        return providerFailure()
      if (speech.confidence < 0.6 || speech.choice === 'REQUEST')
        return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', confidence: scope.confidence, ...trace }
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
    const assistantRoute = answer?.choice === 'MENU_QUERY' || answer?.choice === 'NEEDS_ASSISTANT' || answer?.choice === 'MULTI_ACTION' || answer?.choice === 'CLARIFY_REQUEST'
      || (answer?.choice === 'FOLLOW_UP_ACTIVE' && Boolean(criteria.FOLLOW_UP_ACTIVE))
    if (!input.review && assistantRoute && (confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1)) {
      // A weak broad route never gains mutation authority. Qualify its literal
      // recipient before trying the narrower, read-only menu-query boundary.
      const recipient = (await invoke(JSON.stringify({ customerUtterance: input.transcript }), { recipient: recipientQuestion })).answers?.recipient as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.semanticCheck = { kind: 'weak-handoff-recipient', recipient }
      if (recipient?.choice === 'OTHER' && typeof recipient.confidence === 'number' && Number.isFinite(recipient.confidence) && recipient.confidence >= 0.6 && recipient.confidence <= 1)
        return { kind: 'IGNORE', confidence: recipient.confidence, ...trace }
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
          return { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: inquiry.confidence, ...trace }
      }
      return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
    }
    // An invitation is conversational foreground, not an unfinished meal. A
    // verified independent demand replaces it, while its record stays retained.
    if (invitation && confidence !== undefined && confidence >= 0.6
      && ((selected && selected.id !== 'intent:recommend') || ['NEEDS_ASSISTANT', 'MULTI_ACTION'].includes(String(answer?.choice)))) {
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
    if (phase === 'clarification' && answer?.choice === 'CLARIFICATION')
      return { kind: 'CLARIFICATION', ...trace }
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
        instructions: `只解析最後一句顧客語音是否向店員回答有效問題「${waitingFor.question}」，以及具體回答哪個合法選項。第一輪路由只是待驗證假設，不能假定顧客已同意，不需維持第一輪選擇。依原句的肯定、否定、暫緩、值與對象區分效果；正在回答不等於同意。只能選下列已提供的答案，不猜值、商品或工具參數。問份數／規格時，單說另一個有菜單證據的品名或分類，屬 NEW_REQUEST，不是取消；不必帶「我要」「改成」。只重述原餐點不是取消。若拒絕後另提需求，選 NEW_REQUEST；無法確認選 UNCERTAIN。`,
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
    if (answer?.choice === 'MENU_QUERY' && criteria.MENU_QUERY)
      return { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence, ...trace }
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
          const conditions = await invoke(state, conditionQuestions)
          result.answers = { ...result.answers, ...conditions.answers }
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
            return { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', confidence: presence.confidence, ...trace }
          if (!presence || !['REQUIRED', 'NO_FILTER'].includes(String(presence.choice)) || typeof presence.confidence !== 'number' || presence.confidence < 0.5)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', ...trace }
          const hasFilter = Boolean(ingredientFilters?.dietary || ingredientFilters?.excludeIngredients.length || ingredientFilters?.includeIngredients.length)
          if ((presence.choice === 'REQUIRED') !== hasFilter)
            return { kind: 'NEEDS_ASSISTANT', reason: 'UNRESOLVED_FILTER', ...trace }
        }
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
