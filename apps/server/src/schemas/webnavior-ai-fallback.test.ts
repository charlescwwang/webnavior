import { PGlite } from '@electric-sql/pglite'
import { migrations } from '@proj-airi/server-schema'
import { expect, it } from 'vitest'

it('adds an optional chat backup without changing existing selections or provider credentials', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE TABLE webnavior_ai_provider_profiles (id text PRIMARY KEY, api_key_ciphertext text);
      INSERT INTO webnavior_ai_provider_profiles VALUES ('primary', 'opaque-primary'), ('backup', 'opaque-backup');
      CREATE TABLE webnavior_ai_capability_selections (capability text PRIMARY KEY, provider_profile_id text NOT NULL REFERENCES webnavior_ai_provider_profiles(id));
      INSERT INTO webnavior_ai_capability_selections VALUES ('chat', 'primary'), ('tts', 'primary');`)
    const migration = migrations.find(migration => migration.tag === '0051_webnavior_chat_fallback')
    expect(migration).toBeDefined()
    for (const statement of migration!.sql)
      await db.exec(statement)
    expect((await db.query('SELECT * FROM webnavior_ai_capability_selections ORDER BY capability')).rows).toEqual([
      { capability: 'chat', provider_profile_id: 'primary', fallback_provider_profile_id: null },
      { capability: 'tts', provider_profile_id: 'primary', fallback_provider_profile_id: null },
    ])
    expect((await db.query('SELECT * FROM webnavior_ai_provider_profiles ORDER BY id')).rows).toEqual([
      { id: 'backup', api_key_ciphertext: 'opaque-backup' },
      { id: 'primary', api_key_ciphertext: 'opaque-primary' },
    ])
    await expect(db.exec('UPDATE webnavior_ai_capability_selections SET fallback_provider_profile_id = \'primary\' WHERE capability = \'chat\'')).rejects.toThrow('webnavior_ai_capability_selections_chat_fallback')
    await expect(db.exec('UPDATE webnavior_ai_capability_selections SET fallback_provider_profile_id = \'backup\' WHERE capability = \'tts\'')).rejects.toThrow('webnavior_ai_capability_selections_chat_fallback')
    await expect(db.exec('UPDATE webnavior_ai_capability_selections SET fallback_provider_profile_id = \'missing\' WHERE capability = \'chat\'')).rejects.toThrow('foreign key')
    await db.exec('UPDATE webnavior_ai_capability_selections SET fallback_provider_profile_id = \'backup\' WHERE capability = \'chat\'')
    await expect(db.exec('DELETE FROM webnavior_ai_provider_profiles WHERE id = \'backup\'')).rejects.toThrow('foreign key')
  }
  finally {
    await db.close()
  }
})
