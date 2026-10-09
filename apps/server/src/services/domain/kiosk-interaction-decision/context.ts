/** Completed, session-local text. Model decisions and tool payloads are not conversational turns. */
export interface ConversationEntry {
  content: string
  kind: string
  metadata?: Record<string, unknown>
}

export interface DecisionConversation {
  messages: Array<{ content: string, role: 'assistant' | 'user' }>
}

/** Formatting only: no word deletion, numeral conversion, or minimum speech length. */
export function normalizeTranscript(raw: string) {
  // Replace controls with separators rather than concatenating adjacent words.
  // Zero-width ASR artifacts carry no spoken meaning; 嗯/對/這個 still do.
  const normalized = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
  return { raw, normalized }
}

/** Correlates a Fast Path turn escalated to Agent without merging separate identical utterances. */
export function conversationEntries(entries: readonly ConversationEntry[]) {
  const delivered = new Set(entries.filter(entry => entry.kind === 'user_text' && typeof entry.metadata?.utteranceId === 'number').map(entry => JSON.stringify([entry.metadata!.utteranceId, entry.content])))
  return entries.flatMap((entry): Array<{ content: string, kind: 'assistant_text' | 'user_text' }> => {
    if (entry.kind === 'user_text' || entry.kind === 'assistant_text')
      return [{ content: entry.content, kind: entry.kind }]
    if (entry.kind === 'asr_transcript' && entry.metadata?.decisionRoute === 'fast_path' && !delivered.has(JSON.stringify([entry.metadata.utteranceId, entry.content])))
      return [{ content: entry.content, kind: 'user_text' }]
    return []
  })
}

/** Projects recent completed turns without summarizing them with another model. */
export function buildConversationContext(entries: readonly ConversationEntry[], currentTranscript?: string): DecisionConversation {
  const turns = conversationEntries(entries)
  const messages: DecisionConversation['messages'] = []
  let remaining = 4_000
  for (let index = turns.length - 1; index >= 0 && messages.length < 12; index--) {
    const entry = turns[index]!
    const user = entry.kind === 'user_text'
    if (!entry.content.trim())
      continue
    // Omit an older oversized turn rather than making a fragment look like a
    // complete question. The newest oversized turn retains its trailing text.
    if (entry.content.length > remaining && messages.length)
      break
    const content = entry.content.slice(-remaining)
    messages.push({ content, role: user ? 'user' : 'assistant' })
    remaining -= content.length
    if (!remaining)
      break
  }
  messages.reverse()
  // The review happens after persisting the current user turn. Keep it only
  // in the dedicated transcript field instead of presenting it twice.
  if (currentTranscript && messages.at(-1)?.role === 'user' && messages.at(-1)?.content === currentTranscript)
    messages.pop()
  return { messages }
}
