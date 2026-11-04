import { describe, expect, it } from 'vitest'

import { selectProcessing } from './microphoneInput'

describe('automatic microphone routing', () => {
  it.each(['UMA-8', 'miniDSP UMA-8 v2', 'UMA8 USB Audio', 'Default - UMA_8'])('uses Mask only with eight channels from %s', (label) => {
    expect(selectProcessing(label, 8)).toBe('mask')
    expect(selectProcessing(label, 1)).toBe('standard')
    expect(selectProcessing(label, 2)).toBe('standard')
    expect(selectProcessing(label, 7)).toBe('standard')
  })
  it.each(['USB Conference Microphone', 'Other eight-channel interface', '', 'UMA-80'])('keeps unknown geometry on the standard path: %s', (label) => {
    expect(selectProcessing(label, 8)).toBe('standard')
    expect(selectProcessing(label, 2)).toBe('standard')
  })
})
