import { describe, expect, it } from 'vitest'

import { selectProcessing } from './microphoneInput'

// Report: this chat,2026-11-05 — user explicitly replaced device-name gating
// with actual eight-channel routing. Prior name-specific expectations are retired.
describe('automatic capture routing by actual channels', () => {
  it('selects Mask when the Worklet receives eight actual channels', () => {
    expect(selectProcessing(8)).toBe('mask')
  })
  it.each([1, 2, 3, 6, 7, 9, 16])('keeps%i-channel input on the standard path', (channels) => {
    expect(selectProcessing(channels)).toBe('standard')
  })
})
