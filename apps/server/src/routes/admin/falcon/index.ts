import type { ConfigKVService } from '../../../services/adapters/config-kv'
import type { HonoEnv } from '../../../types/hono'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'

import { falconSettingsSchema } from '@proj-airi/stage-shared/falcon-settings'
import { Hono } from 'hono'
import { boolean, maxLength, object, optional, pipe, safeParse, string } from 'valibot'

import { adminGuard } from '../../../middlewares/admin-guard'
import { authGuard } from '../../../middlewares/auth'
import { createBadRequestError } from '../../../utils/error'

const inputSchema = object({
  ...falconSettingsSchema.entries,
  plaintextKey: optional(pipe(string(), maxLength(8192))),
  clearApiKey: optional(boolean()),
})

/** Admin-only connection draft. Activation stays blocked until the AV pipeline is verified. */
export function createAdminFalconRoutes(configKV: ConfigKVService, crypto: EnvelopeCrypto) {
  async function snapshot() {
    const { keyCiphertext, ...settings } = await configKV.get('FALCON_CONNECTION_CONFIG')
    return { settings, hasApiKey: Boolean(keyCiphertext), ready: false as const, responseStatus: 'pending' as const }
  }
  return new Hono<HonoEnv>()
    .use('*', authGuard)
    .use('*', adminGuard)
    .get('/', async (c) => {
      c.header('Cache-Control', 'no-store')
      return c.json(await snapshot())
    })
    .put('/', async (c) => {
      const result = safeParse(inputSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Falcon 設定格式不正確，請檢查服務網址與欄位。', 'FALCON_SETTINGS_INVALID')
      const { plaintextKey, clearApiKey, ...settings } = result.output
      if (settings.mode !== 'legacy')
        throw createBadRequestError('Falcon 回傳格式與影音管線尚未驗證，目前請維持舊模式。', 'FALCON_NOT_READY')
      if (settings.engine === 'pytorch' && settings.precision !== 'fp32')
        throw createBadRequestError('PyTorch 模式僅支援 FP32。', 'FALCON_PRECISION_INVALID')
      if (clearApiKey && plaintextKey)
        throw createBadRequestError('請選擇更新或清除 Key，不能同時執行。', 'FALCON_KEY_CONFLICT')
      const previous = await configKV.get('FALCON_CONNECTION_CONFIG')
      let keyCiphertext = clearApiKey ? undefined : previous.keyCiphertext
      if (plaintextKey)
        keyCiphertext = crypto.encryptKey(plaintextKey, { modelName: 'webnavior-falcon', keyEntryId: 'default' })
      await configKV.set('FALCON_CONNECTION_CONFIG', { ...settings, ...(keyCiphertext ? { keyCiphertext } : {}) })
      return c.json(await snapshot())
    })
}
