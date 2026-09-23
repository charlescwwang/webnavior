import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { kioskSpeechGuardLabels } from '.'

interface DatasetRow {
  id: string
  label: typeof kioskSpeechGuardLabels[number]
  requires_context: boolean
  text: string
}

async function readJsonl(name: 'prototype_examples.jsonl' | 'hard_test.jsonl') {
  const file = new URL(`../../../../../../docs/kiosk_speech_guard_zh_tw/${name}`, import.meta.url)
  const content = await readFile(file, 'utf8')
  return content.trim().split('\n').map(line => JSON.parse(line) as DatasetRow)
}

describe('kiosk speech guard dataset', () => {
  it('keeps the approved prototype and hard-test contract isolated', async () => {
    const [prototype, hardTest] = await Promise.all([
      readJsonl('prototype_examples.jsonl'),
      readJsonl('hard_test.jsonl'),
    ])

    expect(prototype).toHaveLength(685)
    expect(hardTest).toHaveLength(154)
    expect(new Set(prototype.map(row => row.id)).size).toBe(prototype.length)
    expect(new Set(hardTest.map(row => row.id)).size).toBe(hardTest.length)
    const prototypeTexts = new Set(prototype.map(row => row.text))
    expect(hardTest.some(row => prototypeTexts.has(row.text))).toBe(false)

    for (const row of [...prototype, ...hardTest]) {
      expect(kioskSpeechGuardLabels).toContain(row.label)
      expect(typeof row.requires_context).toBe('boolean')
      expect(row.text.trim()).not.toHaveLength(0)
    }
  })
})
