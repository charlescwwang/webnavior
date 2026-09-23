import type { PresenceState } from '@proj-airi/kiosk-proactive'

import type { KioskSpeechGuardLabel } from '../kiosk-speech-guard'

export type KioskTurnDecision = 'candidate' | 'continue' | 'ignore' | 'interrupt'
export type KioskTurnDecisionReason = 'low-confidence' | 'missing-or-passing' | 'speech-guard-customer-intent' | 'speech-guard-uncertain' | 'initial-customer-intent' | 'initial-uncertain' | 'initial-no-customer-intent' | 'explicit-change' | 'similar-acknowledgement' | 'new-order-intent' | 'no-customer-intent'

const orderChangePattern = /不要|取消|改[成為]?|換[成掉]?|加[一兩\d點]|減[一兩\d點]|多[一兩\d]|少[一兩\d]/
const newOrderIntentPattern = /我要|我想要|幫我|再來/
const initialCustomerIntentPattern = /我要|我想要|幫我|再來|點餐|菜單|推薦|請問|多少錢|有.+嗎|可以.+嗎|有什麼.*(?:吃|點)|(?:肚子)?餓.*(?:吃|點)/

/**
 * Makes the conservative interruption decision independently from UI and VAD.
 * Semantic similarity is optional because the embedding provider enriches a
 * safe customer-intent fallback instead of becoming a dependency for ordering.
 */
export function decideKioskTurn(input: {
  activeWork: boolean
  asrConfidence?: number
  presenceState?: PresenceState
  semanticSimilarity?: number
  speechGuardLabel?: KioskSpeechGuardLabel
  text: string
}): KioskTurnDecision {
  return evaluateKioskTurn(input).decision
}

/** Produces a stable, content-free reason suitable for aggregate observation. */
export function evaluateKioskTurn(input: {
  activeWork: boolean
  asrConfidence?: number
  presenceState?: PresenceState
  semanticSimilarity?: number
  speechGuardLabel?: KioskSpeechGuardLabel
  text: string
}): { decision: KioskTurnDecision, reason: KioskTurnDecisionReason } {
  const text = input.text.trim()
  if (text.length < 2 || (input.asrConfidence !== undefined && input.asrConfidence < 0.55))
    return { decision: 'ignore', reason: 'low-confidence' }

  // Presence is a local, anonymous state rather than identity proof. It may
  // only veto the clearly implausible case: a passer-by or no current person
  // sending a new request or pre-empting an active customer.
  if (input.presenceState === 'EMPTY' || input.presenceState === 'PASSING')
    return { decision: 'ignore', reason: 'missing-or-passing' }

  if (!input.activeWork) {
    if (input.speechGuardLabel) {
      if (input.speechGuardLabel === 'ORDER_INTENT' || input.speechGuardLabel === 'KIOSK_COMMAND')
        return { decision: 'continue', reason: 'speech-guard-customer-intent' }

      // An embedding label alone cannot establish whether someone is addressing
      // the kiosk. Keep an engaged person's intelligible utterance in a
      // short-lived, non-persisted candidate state instead of silently losing a
      // genuine request that happened to resemble background conversation.
      return initialCustomerIntentPattern.test(text)
        ? { decision: 'continue', reason: 'initial-customer-intent' }
        : input.presenceState === 'ENGAGED'
          ? { decision: 'candidate', reason: 'speech-guard-uncertain' }
          : { decision: 'ignore', reason: 'initial-no-customer-intent' }
    }

    // A fresh conversation has no customer request to compare semantically.
    // Require an observable ordering/questioning intent, so room conversation
    // and ASR noise do not create a visitor session or reach the Agent.
    return initialCustomerIntentPattern.test(text)
      ? { decision: 'continue', reason: 'initial-customer-intent' }
      : input.presenceState === 'ENGAGED'
        ? { decision: 'candidate', reason: 'initial-uncertain' }
        : { decision: 'ignore', reason: 'initial-no-customer-intent' }
  }

  // An explicit correction wins even when it shares most of its words with the
  // order under way, such as "不要蝦捲，改成擔仔麵".
  if (orderChangePattern.test(text))
    return { decision: 'interrupt', reason: 'explicit-change' }

  // A highly similar short acknowledgement should not cancel an in-flight
  // order. This handles repeated acknowledgements without exposing a score to
  // the kiosk or to a store operator.
  if (input.semanticSimilarity !== undefined && input.semanticSimilarity >= 0.86 && text.length <= 12)
    return { decision: 'ignore', reason: 'similar-acknowledgement' }

  // Similarity can say that two sentences differ, but cannot establish that a
  // nearby speaker owns the kiosk conversation. Require an observable ordering
  // change as well, until the later visual identity signal is available.
  return newOrderIntentPattern.test(text)
    ? { decision: 'interrupt', reason: 'new-order-intent' }
    : { decision: 'ignore', reason: 'no-customer-intent' }
}

/** Returns cosine similarity only for usable embeddings from the same model. */
export function calculateCosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length)
    return undefined

  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index]
    const rightValue = right[index]
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue))
      return undefined
    dotProduct += leftValue * rightValue
    leftMagnitude += leftValue ** 2
    rightMagnitude += rightValue ** 2
  }
  if (leftMagnitude === 0 || rightMagnitude === 0)
    return undefined
  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude)
}
