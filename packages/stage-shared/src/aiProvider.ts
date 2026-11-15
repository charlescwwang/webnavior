import type { InferOutput } from 'valibot'

import { picklist } from 'valibot'

/** Upstream reply policy; auto preserves the calling endpoint's requested format. */
export const chatResponseModeSchema = picklist(['auto', 'json', 'sse'])

/** Selects the upstream chat response format without changing Kiosk event envelopes. */
export type ChatResponseMode = InferOutput<typeof chatResponseModeSchema>
