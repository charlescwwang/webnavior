import { expect, it } from 'vitest'

import { findTranscriptRecording } from './interactionMedia'

// Report: Nov14 kiosk review; delayed ASR/uploads can misalign chronological matching.
it('matches explicit transcript links despite reversed upload completion', () => {
  const media = [{ id: 'second', kind: 'audio_recording', interactionEntryId: 'text-2' }, { id: 'first', kind: 'audio_recording', interactionEntryId: 'text-1' }]
  expect(findTranscriptRecording('text-1', media)?.id).toBe('first')
  expect(findTranscriptRecording('text-2', media)?.id).toBe('second')
})
it('does not guess absent or ambiguous links', () => {
  expect(findTranscriptRecording('text', [{ kind: 'audio_recording', interactionEntryId: 'activity' }])).toBeUndefined()
  expect(findTranscriptRecording('text', [{ kind: 'audio_recording', interactionEntryId: 'text' }, { kind: 'audio_recording', interactionEntryId: 'text' }])).toBeUndefined()
})
