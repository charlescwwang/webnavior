import type { SystemOneQuestion } from '../kiosk-system-one'
import type { KioskInteractionDecision } from './contracts'
import type { DecisionInput, KioskDecisionTrace } from './index'

import { normalizeTranscript } from './context'
import { decisionQuestionBudget } from './contracts'
import { defaultDecisionInstruction, recipientQuestion } from './prompt'
import { decideStagedInteraction } from './routing'

/** Selects a whole offered effect without requiring overlapping intent categories. */
export async function decideDirectInteraction(input: DecisionInput): Promise<KioskInteractionDecision> {
  // These protocols own a live deadline or in-flight request. They are not
  // ordinary menu classification and retain their existing correlation rules.
  if (input.review || input.decisionState?.phase === 'idle_confirmation' || input.decisionState?.phase === 'customer_entry' || input.decisionState?.activeRequest || input.decisionState?.incompleteSpeech)
    return decideStagedInteraction(input)
  const transcript = normalizeTranscript(input.transcript)
  if (!transcript.normalized)
    return { kind: 'IGNORE' }
  const live = input.decisionState?.waitingFor
  const question = live && live.expiresAt > Date.now() ? live : undefined
  const state = JSON.stringify({
    customerUtterance: transcript.normalized,
    phase: input.decisionState?.phase,
    tableSelection: input.decisionState?.tableSelection,
    screen: input.decisionState?.interactionState,
    menuSearch: input.decisionState?.menuSearch,
    constraints: input.decisionState?.constraints,
    waitingFor: question ?? null,
    recentDialogue: input.conversation?.messages.slice(-4) ?? [],
    references: input.decisionState?.references ?? [],
    productResolution: input.decisionState?.productResolution,
    catalogEvidence: input.decisionState?.catalogEvidence,
    availableActions: input.candidates,
  })
  const exchanges: NonNullable<KioskDecisionTrace['exchanges']> = []
  let invalidAnswer = false
  const finish = (result: KioskInteractionDecision): KioskInteractionDecision => ({
    ...result,
    ...(input.includeTrace ? { modelCalls: exchanges.length, modelQuestions: exchanges.length, trace: { rawTranscript: transcript.raw, transcript: transcript.normalized, candidateIntents: input.candidates, decisionState: state, exchanges } } : {}),
  })
  const handoff = (reason: KioskInteractionDecision['reason'] = 'UNCERTAIN_OPERATION') => finish({ kind: 'NEEDS_ASSISTANT', reason })
  const ask = async (key: string, question: SystemOneQuestion) => {
    if (exchanges.length >= (input.maxQuestions ?? decisionQuestionBudget))
      throw new Error('Decision question budget exhausted')
    const startedAt = performance.now()
    let recorded = false
    try {
      const response = await input.invoke(state, { [key]: question })
      exchanges.push({ index: exchanges.length + 1, state, questions: { [key]: question }, answers: response.answers, durationMs: performance.now() - startedAt, status: 'answered' })
      recorded = true
      const raw = response.answers?.[key]
      if (!raw || typeof raw !== 'object' || !('choice' in raw) || typeof raw.choice !== 'string' || !Object.hasOwn(question.criteria ?? {}, raw.choice) || !('confidence' in raw) || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
        invalidAnswer = true
        throw new Error('Invalid decision answer')
      }
      return { choice: raw.choice, confidence: raw.confidence }
    }
    catch (error) {
      if (!recorded)
        exchanges.push({ index: exchanges.length + 1, state, questions: { [key]: question }, durationMs: performance.now() - startedAt, status: 'failed' })
      throw error
    }
  }
  let recipientAdmitted = input.backgroundSpeechMode !== 'enforce'
  try {
    if (input.backgroundSpeechMode && input.backgroundSpeechMode !== 'off') {
      try {
        const recipient = await ask('recipient', recipientQuestion)
        if (input.backgroundSpeechMode === 'enforce') {
          if (recipient.confidence < 0.6 || recipient.choice === 'UNCERTAIN')
            return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' })
          if (recipient.choice === 'OTHER')
            return finish({ kind: 'IGNORE', confidence: recipient.confidence })
          recipientAdmitted = recipient.choice === 'KIOSK'
        }
      }
      catch (error) {
        if (input.backgroundSpeechMode !== 'observe')
          throw error
        // Observation failures remain in the trace, but cannot become an
        // admission veto or taint the following action's error classification.
        invalidAnswer = false
      }
      // Observe records the same result but does not veto an action. The
      // per-device setting comes from Server settings, never a client claim.
    }
    const closedAnswer = question && input.candidates.length === 1 && input.candidates[0].id === 'answer:current' && question.choices.some(choice => choice.id === 'answer:current')
    const fallbacks = {
      HANDOFF: '這是服務需求，但沒有一個選項能完整處理整句，或意思／對象不確定；交主要助手理解，不做其中一部分。',
      ...(input.backgroundSpeechMode === 'enforce' && !closedAnswer ? { IGNORE: '明確只表示了解、沒有待處理需求的附和、背景談話或無關內容；有效問題的回答，以及介紹餐點後尚需確認購買意思的省略同意，不能因短句而忽略。' } : {}),
      ...(!closedAnswer
        ? { GREET: '只有向本機打招呼，沒有其他需求。', INCOMPLETE: '語句明顯還沒說完；完整點餐缺份數、必選設定或唯一商品時不選此項；請顧客把需求說完整。' }
        : {}),
    }
    const ids = input.candidates.map(candidate => candidate.id)
    if (new Set(ids).size !== ids.length || ids.some(id => ['HANDOFF', 'IGNORE', 'GREET', 'INCOMPLETE'].includes(id)))
      return finish({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
    if (ids.length > (input.maxActionCandidates ?? 128))
      return handoff('CANDIDATE_BUDGET')
    const policy = [input.policy.decisionInstruction.trim() || defaultDecisionInstruction, input.policy.storeInstruction.trim()].filter(Boolean).join('\n')
    // Saved custom instructions may mention IGNORE. Device enforcement owns
    // whether that option exists, and this rule follows the saved wording.
    const speechPolicy = input.backgroundSpeechMode === 'enforce'
      ? '背景語句判斷已啟用，依說話對象核對與本題實際提供的選項處理。'
      : '本次設定優先於上面提到忽略背景的文字：背景語句判斷未啟用，不判斷本句是否對點餐員說話，不提供IGNORE；意思不清或無法處理時選HANDOFF，由助手回覆或請顧客說明。'
    const selected = await ask('action', {
      type: 'choice',
      instructions: `${policy}\n直接依完整原句、最新狀態及有效問題選一個完整效果，不必先分類成回答／新需求或菜單／購物車。選項描述是實際可做的全部效果，不得補造工具或參數。\n查詢價格、內容、能否客製或核對是否做過，不是要求現在購買；報品名及份數的點單則是操作。再加兩份是新增兩份，改成兩份是最後總份數。候選中的固定份數必須符合顧客明說或有效問題；沒說份數時選補問份數的候選，未提供則HANDOFF，不自行套用固定份數。多項需求只有一個選項明列全部效果時才能選，否則HANDOFF，不能只做半句。\n有效問題只供理解回答，同意只涵蓋該問題明示效果；顧客可提出新需求，不必先回答舊問題。餐點介紹後只回答好，先交HANDOFF釐清是否購買，不當成已同意或無需回覆的附和。畫面目前選擇不是已問過的問題；明確要求開始時可沿用目前桌號，不能把歷史桌號蓋過最新觸控選擇。語意或取消對象不清選HANDOFF，不猜第一項。\n${speechPolicy}`,
      criteria: { ...Object.fromEntries(input.candidates.map(candidate => [candidate.id, candidate.description])), ...fallbacks },
    })
    if (selected.confidence < 0.6)
      return finish({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', confidence: selected.confidence })
    if (selected.choice === 'HANDOFF')
      return handoff(input.decisionState?.readOnly ? 'MENU_QUERY' : 'NEW_REQUEST')
    if (selected.choice === 'IGNORE' || selected.choice === 'GREET' || selected.choice === 'INCOMPLETE')
      return finish({ kind: selected.choice, confidence: selected.confidence })
    const answer = question?.choices.some(choice => choice.id === selected.choice)
    // Answer IDs carry a one-use effect. No expired/absent question can be
    // restored just because a model selected an otherwise known action ID.
    if ((!question && live?.choices.some(choice => choice.id === selected.choice)) || (answer && question && question.expiresAt <= Date.now()))
      return handoff()
    return finish({ kind: 'FAST_ACTION', actionId: selected.choice, confidence: selected.confidence, ...(answer && question ? { answeredQuestionId: question.questionId } : {}), ...(question?.purpose === 'recommendation-invitation' && !answer ? { supersededQuestionId: question.questionId } : {}) })
  }
  catch {
    if (!recipientAdmitted)
      return finish({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' })
    return finish({ kind: 'UNAVAILABLE', reason: invalidAnswer ? 'INVALID_CHOICE' : 'PROVIDER_FAILURE' })
  }
}
