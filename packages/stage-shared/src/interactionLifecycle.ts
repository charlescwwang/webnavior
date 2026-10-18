import type { InferOutput } from 'valibot'

import { literal, number, object, optional, picklist, pipe, regex, safeParse, string, url } from 'valibot'

const orderResultSchema = object({
  environment: picklist(['test', 'live']),
  fulfillmentMode: picklist(['dine-in', 'takeout']),
  id: string(),
  itemCount: number(),
  posOrderId: optional(string()),
  status: literal('accepted'),
  total: number(),
})

const messageSchema = object({
  source: literal('airi-interaction-lifecycle'),
  type: picklist(['activity', 'completed']),
  orderResult: optional(orderResultSchema),
  orderContinuationUrl: optional(pipe(string(), url(), regex(/^https?:\/\//))),
})

/** Non-personal accepted-order metadata suitable for the host's durable archive. */
export type InteractiveServiceOrderResult = InferOutput<typeof orderResultSchema>

/**
 * Approved iframe lifecycle envelope. The continuation URL is a transient bearer
 * capability for the completion UI; never persist it with the order result or chat.
 */
export type InteractionLifecycleMessage = InferOutput<typeof messageSchema>

/** Validates the envelope after a host checks the sending iframe and origin. */
export function readInteractionLifecycle(value: unknown): InteractionLifecycleMessage | undefined {
  const result = safeParse(messageSchema, value)
  return result.success ? result.output : undefined
}
