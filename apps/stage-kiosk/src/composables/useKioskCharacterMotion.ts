import type { ToolExecution } from '@proj-airi/stage-shared/interactive-service'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'
import type { MaybeRefOrGetter } from 'vue'

import type { KioskInteractionPhase } from './useKioskInteractionTurn'

import { productPresentationSchema } from '@proj-airi/stage-shared/product-presentation'
import { boolean, literal, looseObject, optional, safeParse, string, unknown } from 'valibot'
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'

/** Published VRMA slots; speech mouth movement remains owned by the shared Stage audio path. */
export type KioskMotionName = 'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking'
type TransientMotion = 'acknowledge' | 'greeting' | 'presentRecommendations'

const receiptSchema = looseObject({
  ok: literal(true),
  source: literal('browser'),
  status: optional(string()),
  repeated: optional(boolean()),
  presentation: optional(unknown()),
})
const cartWrites = new Set(['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'])

/** Selects published motions from real interaction phases and correlated PB receipts. */
export function useKioskCharacterMotion(options: {
  animations: MaybeRefOrGetter<Partial<Record<KioskMotionName, string>> | undefined>
  idleAnimation: MaybeRefOrGetter<string | undefined>
  phase: MaybeRefOrGetter<KioskInteractionPhase>
  busy: MaybeRefOrGetter<boolean>
  client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'onExecution' | 'availability'>
}) {
  const transient = shallowRef<TransientMotion>()
  const pending = new Map<string, { connectionId: string, documentId: string }>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function reset() {
    clearTimeout(timer)
    timer = undefined
    transient.value = undefined
    pending.clear()
  }

  function play(name: TransientMotion) {
    if (!toValue(options.animations)?.[name])
      return
    clearTimeout(timer)
    transient.value = name
    // Preserve master's short gesture window, then resume the current phase.
    timer = setTimeout(() => {
      transient.value = undefined
      timer = undefined
    }, 1800)
  }

  const stopExecution = options.client.onExecution((event: ToolExecution) => {
    if (event.phase === 'called') {
      pending.set(event.operationId, { connectionId: event.connectionId, documentId: event.documentId })
      return
    }
    const owner = pending.get(event.operationId)
    pending.delete(event.operationId)
    // The connection/document pair owns this operation. Failed, orphaned or
    // retired-service completions must not animate an apparent confirmation.
    if (event.phase !== 'resolved' || options.client.availability.value !== 'ready'
      || owner?.connectionId !== event.connectionId || owner.documentId !== event.documentId) {
      return
    }
    const receipt = safeParse(receiptSchema, event.result)
    if (!receipt.success || receipt.output.repeated)
      return
    if (cartWrites.has(event.tool.name)) {
      if (receipt.output.status === 'verified')
        play('acknowledge')
      return
    }
    // Internal catalog reads have no presentation. A nonempty, validated cue
    // means the PB page actually presented products, rather than merely read them.
    const presentation = safeParse(productPresentationSchema, receipt.output.presentation)
    if (presentation.success && presentation.output.cue === 'shown' && presentation.output.products.length)
      play('presentRecommendations')
  })
  const stopAvailability = watch(options.client.availability, (state) => {
    if (state !== 'ready')
      reset()
  }, { flush: 'sync' })

  const animation = computed(() => {
    const animations = toValue(options.animations)
    const idle = animations?.idle ?? toValue(options.idleAnimation)
    if (transient.value)
      return animations?.[transient.value] ?? idle
    const phase = toValue(options.phase)
    if (phase === 'hearing-speech')
      return animations?.listening ?? idle
    if (phase === 'transcribing' || toValue(options.busy))
      return animations?.thinking ?? idle
    return idle
  })
  onScopeDispose(() => {
    reset()
    stopExecution()
    stopAvailability()
  })
  return { animation, loop: computed(() => !transient.value), play, reset }
}
