import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'
import { recoverServiceRequest } from './serviceRecovery'

// Report: this chat, 2026-11-06; authorized read-only replay of the recorded review failure.
it('probes the recorded buy-one-get-one review without executing tools', async () => {
  const profile = JSON.parse(await readFile('/tmp/webnavior-main-scope-profile.json', 'utf8'))
  const state = JSON.parse(await readFile('/tmp/kiosk-invalid-review-state.json', 'utf8'))
  const crypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') })
  const secret = profile.api_key_ciphertext ? crypto.decryptKey(profile.api_key_ciphertext, { keyEntryId: 'default', modelName: `webnavior-ai:provider-profile:${profile.id}` }) : undefined
  const observations: unknown[] = []
  try {
    const result = await recoverServiceRequest({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } }, {
      backgroundSpeechMode: 'off',
      transcript: state.customerUtterance,
      modelName: profile.model_id,
      state,
      conversation: { messages: state.recentDialogue },
      complete: async (body, signal) => {
        const request = { ...body, model: profile.model_id, chat_template_kwargs: { enable_thinking: profile.enable_thinking } }
        const response = await fetch(`${profile.base_url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret.toString()}` } : {}) }, body: JSON.stringify(request), signal })
        observations.push({ request, status: response.status, response: await response.clone().json() })
        return response
      },
    })
    observations.push({ result })
    await writeFile('/tmp/kiosk-review-contract-live.json', JSON.stringify(observations, null, 2), { mode: 0o600 })
    expect(result.recovery?.status).toBe('completed')
  }
  finally { secret?.fill(0) }
}, 30000)
