import { readFile } from 'node:fs/promises'

import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

// Report: this chat Nov8 — removing delegation must preserve the running policy.
it('migrates delegated values without reviving locked values and invalidates old revisions', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE TABLE kiosk_devices (id text PRIMARY KEY, settings jsonb NOT NULL);
      INSERT INTO kiosk_devices VALUES ('existing', '{"version":7,"overrides":{"textOnlyMode":false,"greetingEnabled":true},"localControls":["textOnlyMode"],"localOverrides":{"textOnlyMode":true,"greetingEnabled":false}}'),
      ('empty', '{"version":1,"overrides":{},"localControls":[],"localOverrides":{}}');`)
    const migration = await readFile(new URL('../../../../drizzle/0048_shared_device_settings.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    const migrated = await db.query<{ id: string, settings: unknown }>('SELECT id, settings FROM kiosk_devices ORDER BY id')
    expect(migrated.rows).toEqual([
      { id: 'empty', settings: { version: 2, overrides: {} } },
      { id: 'existing', settings: { version: 8, overrides: { textOnlyMode: true, greetingEnabled: true } } },
    ])
    await db.exec('INSERT INTO kiosk_devices(id) VALUES (\'new\')')
    const created = await db.query<{ settings: unknown }>('SELECT settings FROM kiosk_devices WHERE id = \'new\'')
    expect(created.rows[0]?.settings).toEqual({ version: 1, overrides: {} })
  }
  finally {
    await db.close()
  }
})

// Report: this chat Nov10 — rehearse the old PB settings shape before switching releases.
it('preserves nested VAD, explicit false and zero values without activating locked local edits', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE TABLE kiosk_devices (id text PRIMARY KEY, settings jsonb NOT NULL)')
    const vad = { threshold: 0.65, minSpeechDurationMs: 450, maxSpeechDurationS: 30, minSilenceDurationMs: 800, speechPadMs: 200 }
    await db.query('INSERT INTO kiosk_devices VALUES ($1, $2)', ['existing', JSON.stringify({
      version: 3,
      overrides: { greetingEnabled: true, maxReminders: 2, performanceProfile: 'high' },
      localControls: ['greetingEnabled', 'maxReminders', 'voiceVadSettings'],
      localOverrides: { greetingEnabled: false, maxReminders: 0, voiceVadSettings: vad, performanceProfile: 'constrained' },
    })])
    await db.exec(await readFile(new URL('../../../../drizzle/0048_shared_device_settings.sql', import.meta.url), 'utf8'))
    const migrated = await db.query<{ settings: unknown }>('SELECT settings FROM kiosk_devices WHERE id = $1', ['existing'])
    expect(migrated.rows[0]?.settings).toEqual({
      version: 4,
      overrides: { greetingEnabled: false, maxReminders: 0, performanceProfile: 'high', voiceVadSettings: vad },
    })
  }
  finally { await db.close() }
})

it('retains shared-format overrides when inspecting a database that already uses that shape', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE TABLE kiosk_devices (id text PRIMARY KEY, settings jsonb NOT NULL)')
    await db.query('INSERT INTO kiosk_devices VALUES ($1, $2)', ['shared', JSON.stringify({ version: 4, overrides: { textOnlyMode: true, reminderWaitMs: 55000 } })])
    await db.exec(await readFile(new URL('../../../../drizzle/0048_shared_device_settings.sql', import.meta.url), 'utf8'))
    const migrated = await db.query<{ settings: unknown }>('SELECT settings FROM kiosk_devices WHERE id = $1', ['shared'])
    expect(migrated.rows[0]?.settings).toEqual({ version: 5, overrides: { textOnlyMode: true, reminderWaitMs: 55000 } })
  }
  finally { await db.close() }
})
