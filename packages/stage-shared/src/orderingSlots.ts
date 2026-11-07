/** Parses explicit serving slots only; this never establishes purchase intent. */
export function quantityFromTranscript(transcript: string, allowBare = false) {
  const normalized = normalizeSlotNumbers(transcript)
  // A 顆 value is an option; it must not become the number of servings.
  const matched = /(?:^|\D)(20|1\d|[1-9])\s*[份個碗杯]/.exec(normalized)
    ?? (allowBare ? /^(?:要|改成|[改再])?\s*(20|1\d|[1-9])\s*$/.exec(normalized) : null)
  return matched ? Number(matched[1]) : undefined
}

/** Normalizes local numeric slots, never catalog names or the original ASR transcript. */
export function normalizeSlotNumbers(transcript: string) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  return transcript.replace(/[\uFF10-\uFF19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/二十|十[一二三四五六七八九]?|[一二兩三四五六七八九]/g, token => String(token === '二十' ? 20 : token.startsWith('十') ? 10 + (digits[token.slice(1)] ?? 0) : digits[token]))
}
