/**
 * Only an explicit, unique transcript link can identify a speech recording.
 * Collection order and timestamps are deliberately irrelevant: uploads can finish out of order.
 */
export function findTranscriptRecording<T extends { kind: string, interactionEntryId?: string | null }>(transcriptId: string, media: readonly T[]): T | undefined {
  const matches = media.filter(item => item.kind === 'audio_recording' && item.interactionEntryId === transcriptId)
  return matches.length === 1 ? matches[0] : undefined
}
