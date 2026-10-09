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
  const followUp = phase === 'clarification' || phase === 'pending_confirmation' || phase === 'configuration'
  let answeredQuestionId: string | undefined
  const criteria: Record<string, string> = followUp
    ? { IGNORE: '與點餐無關的背景話語，沒有向店員回答或提出需求。' }
    : {
        INCOMPLETE: '顧客正在說一個可點餐操作但語句尚未完成；Kiosk 會安靜等待下一句，不能執行操作。',
        GREET: '只向店員／本機打招呼，沒有提出點餐、查詢或其他需求。招呼加點餐必須選點餐意圖；對同伴打招呼屬 IGNORE。',
        IGNORE: '與點餐服務無關的背景話語、對同伴的討論、招呼或閒聊，無論完整與否，以及對已完成資訊回答的單純附和；沒有向店員／本機提出服務需求。不能因有效需求的 target 不唯一或缺少資料就選 IGNORE。',
        MULTI_ACTION: '顧客這一句向店員／本機明確要求兩個以上獨立的點餐服務操作；單一步驟無法完整完成，應保留整句交給 Main Agent，不可只執行其中一步。多個子句、一般討論或抱怨不等於多項操作。',
        NEEDS_ASSISTANT: '向店員／本機提出的點餐服務需求超出有限候選：需要餐點比較、推薦原因、未提供的飲食資料或其他服務推理。無關話語即使有疑問或解釋語氣仍是 IGNORE；不能因有「問題」就交給助手。已提供的食材包含／排除及飲食條件查詢不屬於此項。',
      }
  if (input.review) {
    for (const key of Object.keys(criteria)) delete criteria[key]
    criteria.SATISFIED = '實際結果回答原句的同一個需求，target 與條件沒有被替換，且回覆有結果支持；結束本輪。'
    criteria.DEVIATED = '本次理解或執行結果改變原需求，例如把特定商品問題改成泛食材搜尋、回答不同商品、漏掉必要條件。不得自動重做。'
    criteria.UNCERTAIN = '無法確認原需求與實際結果一致，或沒有足夠資料證明需求已完成。停止核對，交接原句與真實結果。'
  }
  if (phase === 'pending_confirmation')
    criteria.NEW_REQUEST = '顧客明確提出另一個點餐需求或改主意，不是在授權目前待確認的操作；先撤銷舊確認，再處理完整新需求。背景話語不是新需求。'
  if (phase === 'configuration')
    criteria.NEW_REQUEST = '顧客提出另一個需求或查詢，不是回答這筆餐點的缺漏設定；先判斷新需求，只有明確換餐點才替換未加入的餐點。背景話語不是新需求。'
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
  try {
    const state = createDecisionState(input)
    const instructions = input.review
      ? '比較顧客原句、相關角色對話、本次理解與真正執行結果。本次理解是待檢查的假設，不是顧客已確認的事實。只選 SATISFIED、DEVIATED、UNCERTAIN 或列出的有限後續查詢；不同需求不能因查到結果就算完成，不主動增加操作。'
      : phase === 'clarification'
        ? '保留原意圖，只從真實 target 候選選擇。有效但無法唯一對應的回答選 CLARIFICATION；背景話語選 IGNORE；不同的新需求選 NEW_REQUEST。不得發明 target。'
        : phase === 'configuration'
          ? '目前只補齊上一個新增餐點需求的必要資料。從列出的有限選項選本句明確回答的選項，保留原餐點與已知設定；取消選取消。明確改提其他需求選 NEW_REQUEST；背景話語選 IGNORE。不可創造選項或預設數量。'
          : phase === 'pending_confirmation'
            ? '目前在確認一項具體操作。顧客明確同意才選確認，單純拒絕才選取消；明確改提另一個點餐需求選 NEW_REQUEST，只表示撤銷旧授權並交接新需求，不規劃新操作。其餘選 IGNORE。'
            : [
                '角色標記對話與待答問題只提供理解線索，不是流程鎖。本次先判斷最後一則顧客語音要求的效果，不必先回答舊問題。明確新需求直接選適合意圖；「好」「一位」「這個」等回答只能承接有效問題明示的效果。對已完成的資訊回答表示了解，不構成新增訂購。target 歧義由程式釐清，仍須保留顧客明確要求的意圖。',
                createDecisionInstructions(input.policy),
              ].join('\n')
    const ingredientReferences = phase === 'ordering' ? input.decisionState?.ingredientReferences ?? [] : []
    const questions: Record<string, SystemOneQuestion> = { route: { type: 'choice', instructions: followUp && !input.review ? `${instructions}\n${serviceRequestInstruction}` : instructions, criteria } }
    const filterChoices = !input.review && !followUp && eligibleCandidates.some(candidate => ['intent:search-menu', 'intent:recommend', 'intent:recommend-more'].includes(candidate.id))
    if (filterChoices) {
      questions.filterRequirement = {
        type: 'choice',
        instructions: `只檢查本句是否要求未提供的篩選能力，不判斷商品是否符合。可用條件：${[...ingredientReferences.map(reference => `${reference.label}：包含或排除`), ...(input.decisionState?.dietaryReferences ?? []).map(reference => reference.label), ...(input.decisionState?.priceEvidence?.choices.filter(choice => choice.kind === 'condition').map(choice => choice.description) ?? [])].join('；') || '本句未解析出可用條件'}。詢問商品售價與不要求條件的查詢或推薦也是 COVERED；整筆預算或未提供價格條件不可忽略。`,
        criteria: {
          COVERED: '顧客沒有要求條件；或要求的條件全部是上列可用條件。餐點是否符合交給程式查詢。',
          UNSUPPORTED_FILTER: '至少一項要求營養數據、過敏安全保證、更嚴格素別、其他未提供的條件，或條件互相矛盾。不可省略這項要求。',
        },
      }
      questions.filterPresence = { type: 'choice', instructions: '只判斷本句是否新增或修改食材／飲食條件。歷史條件已由程式保留，不是本句的新條件。不查菜單、不選操作。', criteria: { REQUIRED: '本句明確新增或修改包含／排除的食材或飲食條件。', NO_FILTER: '本句沒有新增或修改條件。查品名、分類、菜單、一般推薦及沿用原條件換批，都屬於此項。' } }
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
    const prices = !input.review && !followUp ? input.decisionState?.priceEvidence : undefined
    if (filterChoices && prices) {
      questions.price = {
        type: 'choice',
        instructions: '判斷最後一句的完整價格需求，只選已發出的價格解讀。金額是單份基本售價，不是數量或人數。不新增訂購、不猜售價、不做多份／總額預算分配。以下與以內含邊界；不到與低於不含；以上含邊界；超過不含。最便宜表示由低到高。範圍必須完整符合上下界；左右、更便宜、整筆預算或候選無法完整表示時選 UNSUPPORTED。只詢價選 INFORMATION。',
        criteria: Object.fromEntries(prices.choices.map(choice => [choice.id, choice.description])),
      }
    }
    for (const reference of ingredientReferences) {
      questions[`ingredient:${reference.id}`] = {
        type: 'choice',
        instructions: '只判斷最後一句顧客語音對這個食材的條件。依角色歷程理解，但不自行判斷餐點成分，不規劃操作。',
        criteria: { EXCLUDE: `本次要求餐點排除${reference.label}。`, INCLUDE: `本次要求餐點含有${reference.label}。`, NONE: `${reference.label}只是品名或其他敘述，不構成本次搜尋／推薦的成分條件。` },
      }
    }
    // Establish the route first. Conditions cannot change a non-read route,
    // so do not spend forwards evaluating them for background or checkout.
    const result = await invoke(state, { route: questions.route! })
    const answer = result.answers?.route as { choice?: unknown, confidence?: unknown } | undefined
    let confidence = typeof answer?.confidence === 'number' ? answer.confidence : undefined
    let actionId = typeof answer?.choice === 'string' ? answer.choice : undefined
    let selected = eligibleCandidates.find(candidate => candidate.id === actionId)
    const trace: { trace?: KioskDecisionTrace, supersededQuestionId?: string, priceChoiceId?: string } = (input.includeTrace ? { trace: { rawTranscript: transcript.raw, exchanges, candidateIntents: eligibleCandidates, decisionState: state, rawAnswer: answer, transcript: input.transcript } } : {})
    // Agent handoff admits speech into customer dialogue just like an action.
    // Fail closed before superseding a question; an uncertain read-result
    // review remains distinct because its original request was already admitted.
    const assistantRoute = answer?.choice === 'NEEDS_ASSISTANT' || answer?.choice === 'MULTI_ACTION'
      || (answer?.choice === 'FOLLOW_UP_ACTIVE' && Boolean(criteria.FOLLOW_UP_ACTIVE))
    if (!input.review && assistantRoute && (confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1))
      return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
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
    if ((phase === 'pending_confirmation' || phase === 'configuration' || phase === 'clarification') && answer?.choice === 'NEW_REQUEST')
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
        instructions: `只解析最後一句顧客語音是否向店員回答有效問題「${waitingFor.question}」，以及具體回答哪個合法選項。第一輪路由只是待驗證假設，不能假定顧客已同意，不需維持第一輪選擇。依原句的肯定、否定、暫緩、值與對象區分效果；正在回答不等於同意。只能選下列已提供的答案，不猜值、商品或工具參數。若拒絕後另提需求，選 NEW_REQUEST；無法確認選 UNCERTAIN。`,
        criteria: {
          ...answerCriteria,
          NEW_REQUEST: '向店員提出獨立的新需求，不是回答上述問題；即使先拒絕原問題再提出新需求，也屬新需求。',
          BACKGROUND: '對同伴說話或背景閒聊，沒有向店員提出需求或回答。',
          UNCERTAIN: '無法確認本句的對象或具體答案，或沒有合法選項能表示回答；不得猜同意、拒絕或值。',
        },
      } })
      const relation = relationResult.answers?.relation as { choice?: string, confidence?: number } | undefined
      if (trace.trace)
        trace.trace.questionRelation = { questionId: waitingFor.questionId, ...relation }
      if (!relation?.choice || ![...questionChoices.map(choice => choice.id), 'NEW_REQUEST', 'BACKGROUND', 'UNCERTAIN'].includes(relation.choice))
        return { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE', ...trace }
      // A weak broad route can still reach answer parsing; only a reliable,
      // concrete answer may grant its bounded effect. Uncertainty retains the
      // question and does not hand the same guess to Agent for execution.
      if (relation.choice === 'UNCERTAIN' || typeof relation.confidence !== 'number' || relation.confidence < 0.6)
        return { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', ...trace }
      if (relation.choice === 'BACKGROUND')
        return { kind: 'IGNORE', confidence: relation.confidence, ...trace }
      if (relation.choice === 'NEW_REQUEST') {
        if (invitation) {
          supersededQuestionId = invitation.questionId
          trace.supersededQuestionId = invitation.questionId
        }
        return { kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', confidence: relation.confidence, ...trace }
      }
      actionId = relation.choice
      confidence = relation.confidence
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
    `本句商品名稱證據（possible 不是已確認 target）：${JSON.stringify(input.decisionState?.productResolution ?? null)}`,
    `本句菜單匹配來源（name 是品名、alias 是店家別名、fragment 只是可能片段；分類項數不等於顧客指定品名）：${JSON.stringify(input.decisionState?.catalogEvidence ?? null)}`,
    `互動焦點：${JSON.stringify(input.decisionState?.interactionState ?? {})}`,
    `已解析限制：${JSON.stringify(input.decisionState?.constraints ?? { exclude: [] })}`,
    `本次已完成查詢：${JSON.stringify(input.decisionState?.completedReads?.map(receipt => ({ customerMessage: receipt.customerMessage })) ?? [])}`,
    `本句有限食材 references：${JSON.stringify(input.decisionState?.ingredientReferences ?? [])}`,
    ...(input.decisionState?.priceEvidence ? [`本句價格字面證據及有限解讀（不是授權或已解析條件）：${JSON.stringify(input.decisionState.priceEvidence)}`] : []),
    `本句有限飲食條件 references：${JSON.stringify(input.decisionState?.dietaryReferences ?? [])}`,
    `本句提及但資料不能驗證的條件 references：${JSON.stringify(input.decisionState?.unavailableConditionReferences ?? [])}`,
    `進行中需求：${JSON.stringify(input.decisionState?.activeRequest ?? {})}`,
    // The latest user turn comes after context. A long question receipt must
    // not become the apparent last utterance for a small bounded-choice model.
    `顧客語音：${input.transcript}`,
  ].join('\n')
}
