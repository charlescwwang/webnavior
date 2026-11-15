import process from 'node:process'

import { eq } from 'drizzle-orm'

import { createDrizzle } from '../libs/db'
import { parseEnv } from '../libs/env'
import { createKioskService } from '../services/domain/kiosk'

import * as schema from '../schemas'

// This seed belongs only to the isolated runner, never the shared production DB.
const target = new URL(process.env.DATABASE_URL ?? '')
if (process.env.NODE_ENV !== 'development' || !process.env.PB_TEST_INSTANCE
  || target.hostname !== '127.0.0.1' || target.port !== '15434'
  || target.pathname !== '/webnavior_pb_test' || target.username !== 'pb_test') {
  throw new Error('PB test seeding requires the isolated local database.')
}

const { db, pool } = createDrizzle(parseEnv(process.env))
try {
  const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.slug, 'webnavior-test-site') })
  if (!site?.ownerUserId)
    throw new Error('Create the local test accounts first.')
  const release = await db.query.kioskProfileReleases.findFirst({ where: eq(schema.kioskProfileReleases.siteId, site.id) })
  // Initial publication only: subsequent starts must preserve operator edits.
  if (!release) {
    const kiosk = createKioskService(db)
    const greeting = '內用請先找到座位，再回來告訴我您的桌號；外帶請說「櫃台自取」。'
    const draft = await kiosk.saveProfileDraft({
      siteId: site.id,
      name: 'PB Ubuntu 純文字測試',
      snapshot: {
        version: 1,
        characterName: 'PB 點餐助手',
        assistanceReminderPrompt: '依實際菜單與目前對話簡短提供協助，不捏造品項、價格或優惠。',
        agentInstructions: '以繁體中文協助點餐。不確定品項、客製選項、用餐方式或桌號時先確認，以網站回傳資訊為準。',
        greetingPrompt: greeting,
        greetingPhrases: [greeting],
        interactiveService: {
          id: 'pb-ubuntu-test',
          title: 'PB 點餐測試',
          description: 'PB 內用測試；支援語音選桌與開始點餐。',
          url: 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table',
          // Shared aliases remain ambiguous across all matching products. 套餐
          // covers both A/B; it must never silently select only B.
          catalogLabels: [
            { name: '炸排骨便當', aliases: ['排骨便當', '排骨飯', '炸排骨飯'], category: '' },
            { name: '炸雞腿便當', aliases: ['炸雞腿飯', '雞腿便當', '雞腿飯'], category: '' },
            { name: '港式油雞腿便當', aliases: ['油雞腿便當', '油雞腿飯', '港式油雞腿飯', '雞腿便當', '雞腿飯'], category: '' },
            { name: '三杯雞便當', aliases: ['三杯雞', '三杯雞飯'], category: '' },
            { name: '周氏水餃(最低8顆)', aliases: ['周氏水餃', '水餃'], category: '' },
            { name: '老董紅燒牛肉麵', aliases: ['紅燒牛肉麵', '牛肉麵'], category: '' },
            { name: '椒香麻辣牛肉麵', aliases: ['麻辣牛肉麵', '牛肉麵'], category: '' },
            { name: 'A套餐', aliases: ['A餐', 'A combo', 'comboA', '套餐'], category: '' },
            { name: 'B 套餐', aliases: ['B套餐', 'B餐', 'B combo', 'comboB', '套餐'], category: '' },
          ],
        },
        surveyUrl: 'https://example.com/kiosk-feedback',
        voiceConversationOnly: false,
      },
    })
    await kiosk.publishProfileDraft({ siteId: site.id, draftId: draft.id })
    await kiosk.setSiteMediaCapturePolicy({ actorUserId: site.ownerUserId, siteId: site.id, policy: { mode: 'off' } })
  }
  console.info('PB test profile ready; existing publications preserved.')
}
finally {
  await pool.end()
}
