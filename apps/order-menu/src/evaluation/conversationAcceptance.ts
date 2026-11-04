import type { ConversationScript, ExpectedLine, MatrixStep } from './conversationMatrix'

/** Current outcome gold is versioned separately from the frozen historical scripts. */
export interface AcceptanceStep extends MatrixStep {
  /** Semantic admission is independent from whether a customer reply was spoken. */
  admission?: Array<'service' | 'background' | 'uncertain'>
  /** A pause must be understood as a service instruction, not merely leave the cart unchanged. */
  meaning?: 'pause'
  /** Observe raw class separately when Host must still prove silence and no adoption. */
  admissionAdvisory?: boolean
  /** Editing may ask whether to return, but cannot execute cancellation or discard data. */
  allowCancelQuestion?: boolean

  /** Each complete cart is independently acceptable; individual rows cannot be mixed. */
  cartAlternatives?: ExpectedLine[][]
  /** Read-only remarks may answer or stay silent, but cannot navigate or edit state. */
  preserveState?: boolean
}

export const acceptanceVersion = '2026-11-04-purchase-v5'

/** Applies user-confirmed outcome policy without changing historical inputs or hiding faults. */
export function applyAcceptancePolicy(source: ConversationScript) {
  const changes: Array<{ step: number, policy: string }> = []
  const steps: AcceptanceStep[] = source.steps.map((original, index) => {
    const step: AcceptanceStep = { ...original }
    const hearing = original.reply === '收到|聽|接收'
    const closing = (source.id === 'D08' && index === 1) || (source.id === 'C06-A1' && index === 1) || (source.id === 'C11-A2' && index === 2)
    const pause = ['C03-A1', 'C09-A1'].includes(source.id) && index === 1
    const unresolved = (source.id === 'M02' && index === 1) || (source.id === 'C15-F1' && [1, 2, 3].includes(index))
    // These are explicit test-input categories, never production transcript matching.
    const invoiceRefusal = ['invoice-confirmation', 'invoice-kind-confirmation', 'invoice-direct-main'].includes(source.group)
      && ['還沒輸入完，不要送出', '先不要送出', '我要先修改資料'].includes(original.text)
    if (hearing || closing || pause || unresolved || invoiceRefusal) {
      step.silentAllowed = true
      delete step.silentOnly
      delete step.reply
      if (hearing || closing || unresolved)
        delete step.forbidden
      if (!unresolved)
        step.preserveState = true
      changes.push({ step: index + 1, policy: unresolved ? 'unresolved-response-optional' : 'read-only-response-optional' })
    }
    if (original.silentOnly && !closing) {
      step.admission = source.id === 'B03-J-A1' ? ['service', 'uncertain'] : ['background', 'uncertain']
      changes.push({ step: index + 1, policy: 'verify-unadopted-speech-classification' })
    }
    if (invoiceRefusal && original.text === '我要先修改資料') {
      step.allowCancelQuestion = true
      changes.push({ step: index + 1, policy: 'allow-return-confirmation-with-preserved-data' })
    }
    if (original.silentOnly && !closing && source.id !== 'B03-J-A1') {
      step.admissionAdvisory = true
      changes.push({ step: index + 1, policy: 'class-advisory-effectively-unadopted-speech-required' })
    }
    if (pause) {
      step.admission = ['service']
      if (source.id === 'C09-A1')
        step.meaning = 'pause'
      changes.push({ step: index + 1, policy: 'verify-service-pause-or-read-only-request' })
    }
    if ((source.id === 'B03-J-A1' && index === 0) || (source.id === 'C06-F1' && index === 1) || (source.id === 'B04-J-F1' && index === 1)) {
      step.admission = ['service']
      changes.push({ step: index + 1, policy: 'verify-service-request' })
    }
    if (/^Q01-[JM]-A[12]$/u.test(source.id) && index === 0 && original.cart) {
      step.cartAlternatives = [source.initial.cart, original.cart]
      delete step.cart
      delete step.forbidden
      changes.push({ step: index + 1, policy: 'mixed-quantity-whole-refusal-or-legal-only' })
    }
    return step
  })
  // User deferred this uncommon negative phrasing; keep running and retaining
  // its actual failures, separately from required customer-flow acceptance.
  const advisory = steps.some(step => step.text === '先不要送出')
    && ['invoice-confirmation', 'invoice-kind-confirmation', 'invoice-direct-main'].includes(source.group)
  return { script: { ...source, steps }, revision: { version: acceptanceVersion, sourceId: source.id, gate: advisory ? 'advisory' : 'required', changes } }
}
