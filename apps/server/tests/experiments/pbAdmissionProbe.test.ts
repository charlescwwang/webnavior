import type { SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { Buffer } from 'node:buffer'

import { errorMessageFrom } from '@moeru/std'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { createDrizzle } from '../../src/libs/db'
import { mockDB } from '../../src/libs/mock-db'
import { recipientQuestion as recipientOnly } from '../../src/services/domain/kiosk-interaction-decision/prompt'
import { admissionQuestion } from '../../src/services/domain/kiosk-interaction-decision/routing'
import { createKioskSystemOneService } from '../../src/services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'

import * as schema from '../../src/schemas'

// Report: output/playwright/pb-electron/restored-S06-nov4-partial.json.
// Fixed contrasts distinguish recipient from food vocabulary; this probe never
// exposes browser tools, writes merchant data, or changes the active profile.
it.skipIf(process.env.KIOSK_PB_ADMISSION_PROBE !== '1')('compares admission evidence and recipient wording against fixed contrasts', async () => {
  const history = [{ role: 'user', content: '幫我介紹今天的便當。' }, { role: 'assistant', content: '目前有雞腿便當、排骨便當、控肉便當。' }]
  const cases = [
    { text: '小明，我們下班去看電影吧。', expected: 'BACKGROUND' },
    { text: '小明，你要兩份還是三份？', expected: 'BACKGROUND' },
    { text: '請在畫面搜尋雞腿便當。', expected: 'SERVICE' },
    { text: '店員，我要雞腿兩份。', expected: 'SERVICE' },
    { text: '小明說他不要了，我的兩份先保留。', expected: 'SERVICE' },
    { text: '對，請照這樣點。', expected: 'SERVICE', waitingFor: { purpose: 'addition', question: '確認排骨便當一份嗎？' } },
  ]
  const recipientQuestion: SystemOneQuestion = {
    ...admissionQuestion,
    instructions: '先辨識最後一句的收話對象，再判斷是否需要本機回應。直接叫同伴名字並向他提問／提議，是同伴對話，即使提到餐點或份數仍是BACKGROUND。提及同伴但向店員要求保留、修改或核對自己的餐點，是SERVICE。不能因上一輪在點餐就假設下一句也是對店員。直接向店員提出服務、未叫名字但直接提出點餐需求，或回答waitingFor服務問題，是SERVICE。不選商品、不猜操作。',
  }
  const recipientLabels: Record<string, string> = { KIOSK: 'SERVICE', OTHER: 'BACKGROUND', UNCERTAIN: 'UNCERTAIN' }
  const live = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL!, DB_POOL_MAX: 1, DB_POOL_CONNECTION_TIMEOUT_MS: 5000 })
  const rows: Array<{ variant: string, text: string, expected: string, choice?: string, correct: boolean, ms: number, error?: string }> = []
  let calls = 0
  let failures = 0
  const deadline = Date.now() + 90_000
  try {
    const active = await live.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
    if (!active)
      throw new Error('No active Jev profile')
    const isolated = await mockDB(schema)
    await isolated.insert(schema.kioskSystemOneProfiles).values({ ...active, verifiedAt: new Date() })
    const jev = createKioskSystemOneService({ db: isolated, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY!, 'base64') }), fetchImpl: async (url, init) => {
      if (calls >= 24 || Date.now() >= deadline || failures >= 3)
        throw new Error('Admission probe budget exhausted')
      calls++
      return fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now()))), ...(init?.signal ? [init.signal] : [])]) })
    } })
    for (const variant of (process.env.KIOSK_PB_ADMISSION_VARIANT === 'recipient-only' ? ['recipient-only'] : ['original', 'minimal', 'recipient', 'recipient-only'])) {
      for (const test of cases) {
        const started = Date.now()
        const state = { customerUtterance: test.text, phase: 'ordering', waitingFor: test.waitingFor ?? null, ...(variant === 'original' ? { recentDialogue: history, references: [], productResolution: { status: 'none', count: 0, references: [] }, catalogEvidence: { products: [], categories: [] } } : {}) }
        try {
          const result = await jev.decide(JSON.stringify(state), { admission: variant === 'recipient-only' ? recipientOnly : variant === 'recipient' ? recipientQuestion : admissionQuestion })
          const answer = result.answers?.admission
          const label = answer && typeof answer === 'object' && 'choice' in answer && typeof answer.choice === 'string' ? answer.choice : undefined
          const choice = variant === 'recipient-only' ? (recipientLabels[label ?? ''] ?? label) : label
          failures = 0
          rows.push({ variant, text: test.text, expected: test.expected, choice, correct: choice === test.expected, ms: Date.now() - started })
        }
        catch (error) {
          failures++
          rows.push({ variant, text: test.text, expected: test.expected, correct: false, ms: Date.now() - started, error: errorMessageFrom(error) })
        }
        process.stdout.write(`[pb-admission-probe] ${JSON.stringify(rows.at(-1))}\n`)
      }
    }
    expect(rows).toHaveLength(process.env.KIOSK_PB_ADMISSION_VARIANT === 'recipient-only' ? 6 : 24)
    expect(rows.filter(row => row.error)).toHaveLength(0)
    expect(rows.filter(row => row.variant === 'recipient-only' && !row.correct)).toEqual([])
  }
  finally {
    await live.pool.end()
  }
}, 100_000)
