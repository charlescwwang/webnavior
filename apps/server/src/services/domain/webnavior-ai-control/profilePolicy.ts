import type { WebnaviorAiCapability, WebnaviorAiConnectionKind } from '../../../schemas/webnavior-ai'

import { createBadRequestError } from '../../../utils/error'

/** Native Responses supports Main chat only; the local chat-template switch is not an OpenAI parameter. */
export function validateProviderProfile(capability: WebnaviorAiCapability, input: { kind: WebnaviorAiConnectionKind, enableThinking?: boolean }) {
  if (input.kind === 'openai-responses' && (capability !== 'chat' || input.enableThinking))
    throw createBadRequestError('OpenAI Responses 僅適用於對話模型，且不支援本機模型的思考模式開關。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_UNSUPPORTED_CONFIGURATION')
}
