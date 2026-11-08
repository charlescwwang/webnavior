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
