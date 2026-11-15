import { PGlite } from '@electric-sql/pglite'
import { migrations } from '@proj-airi/server-schema'
import { expect, it } from 'vitest'

it('migrates existing providers without changing their speed and enforces the synthesis range', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE TABLE webnavior_ai_provider_profiles (
      id text PRIMARY KEY, model_id text, voice text, api_key_ciphertext text
    );
    INSERT INTO webnavior_ai_provider_profiles VALUES ('saved', 'existing-tts', 'existing-voice', 'test-opaque-ciphertext');
    CREATE TABLE webnavior_ai_capability_selections (
      capability text PRIMARY KEY, provider_profile_id text REFERENCES webnavior_ai_provider_profiles(id)
    );
    INSERT INTO webnavior_ai_capability_selections VALUES ('tts', 'saved');`)
    let applied = false
    for (const migration of migrations) {
      if (migration.tag !== '0047_webnavior_tts_speed')
        continue
      for (const statement of migration.sql)
        await db.exec(statement)
      applied = true
    }
    expect(applied).toBe(true)
    expect((await db.query('SELECT * FROM webnavior_ai_provider_profiles')).rows).toEqual([
      { id: 'saved', model_id: 'existing-tts', voice: 'existing-voice', api_key_ciphertext: 'test-opaque-ciphertext', speed: null },
    ])
    expect((await db.query('SELECT * FROM webnavior_ai_capability_selections')).rows).toEqual([{ capability: 'tts', provider_profile_id: 'saved' }])
    await db.exec('UPDATE webnavior_ai_provider_profiles SET speed = 0.85 WHERE id = \'saved\'')
    expect((await db.query('SELECT speed FROM webnavior_ai_provider_profiles')).rows).toEqual([{ speed: 0.85 }])
    await expect(db.exec('UPDATE webnavior_ai_provider_profiles SET speed = 4.1')).rejects.toThrow('webnavior_ai_provider_profiles_speed_range')
  }
  finally { await db.close() }
})
