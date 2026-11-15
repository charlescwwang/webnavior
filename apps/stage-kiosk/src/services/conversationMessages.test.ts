import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { expect, it } from 'vitest'

import { groupConversationMessages } from './conversationMessages'

// Report: Nov14 user request; late replies must not appear to answer the interruption.
it('groups multiple late replies with their originating utterance without changing source history', () => {
  const messages: ChatHistoryItem[] = [{ role: 'user', id: 'utterance:1:user', content: '雞腿飯' }, { role: 'user', id: 'utterance:2:user', content: '改兩份' }, { role: 'assistant', id: 'utterance:2:reply', content: '兩份', slices: [], tool_results: [] }, { role: 'assistant', id: 'utterance:1:reply', content: '要幾份', slices: [], tool_results: [] }]
  expect(groupConversationMessages(messages).map(message => message.content)).toEqual(['雞腿飯', '要幾份', '改兩份', '兩份'])
  expect(messages.map(message => message.content)).toEqual(['雞腿飯', '改兩份', '兩份', '要幾份'])
})
