import type { StreamingAssistantMessage } from '../types/chat'

import OpenCC from 'opencc-js'

const toTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' })

/**
 * Normalizes assistant-visible text to Taiwan Traditional Chinese.
 *
 * Before:
 * - "请使用自行车软件菜单"
 *
 * After:
 * - "請使用腳踏車軟體選單"
 */
export function toTaiwanTraditionalChinese(text: string) {
  return toTaiwanTraditional(text)
}

/**
 * Applies Taiwan Traditional Chinese normalization only to customer-visible
 * assistant text. Tool calls and tool results intentionally remain untouched.
 */
export function normalizeAssistantMessageForTaiwanTraditional(message: StreamingAssistantMessage) {
  if (typeof message.content === 'string')
    message.content = toTaiwanTraditionalChinese(message.content)

  for (const slice of message.slices) {
    if (slice.type === 'text')
      slice.text = toTaiwanTraditionalChinese(slice.text)
  }

  if (message.categorization) {
    message.categorization = {
      ...message.categorization,
      speech: toTaiwanTraditionalChinese(message.categorization.speech),
    }
  }
}

/** Customer ordering copy uses the restaurant term, including after OpenCC's phrase conversion. */
export function toOrderingTraditionalChinese(text: string) {
  // OpenCC's generic 虱→蝨 mapping is wrong inside the Taiwanese food name.
  // This is output vocabulary, never an alias for finding or ordering a dish.
  return toTaiwanTraditionalChinese(text).replaceAll('選單', '菜單').replaceAll('蝨目魚', '虱目魚')
}
