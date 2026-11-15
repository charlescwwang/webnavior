import { productFragment } from './productDiscovery'

/** Parses explicit serving slots only; this never establishes purchase intent. */
export function quantityFromTranscript(transcript: string, allowBare = false) {
  const normalized = normalizeSlotNumbers(transcript)
  // A 顆 value is an option; it must not become the number of servings.
  const explicit = explicitServingQuantities(transcript, { maximum: 20 })[0]
  if (explicit !== undefined)
    return explicit
  const matched = allowBare ? /^(?:要|改成|[改再])?\s*(20|1\d|[1-9])\s*$/.exec(normalized) : null
  return matched ? Number(matched[1]) : undefined
}

/** Collects literal serving fields only; multiple counts remain ambiguous without target resolution. */
export function explicitServingQuantities(transcript: string, options: { maximum?: number, productName?: string } = {}) {
  let source = transcript.replaceAll(/\s/g, '')
  if (options.productName) {
    const name = options.productName.replaceAll(/\s/g, '')
    source = source.replaceAll(name, '')
    const fragment = productFragment({ name }, [{ name }], source)
    if (fragment)
      source = source.replaceAll(fragment, '')
  }
  // Dish names such as 三杯雞 are not three servings; 顆 is an add-on, and
  // 個人 is party size. The original utterance still owns semantic intent.
  return [...normalizeSlotNumbers(source).matchAll(/(?<![\d.負-])([1-9]\d?)(?:[份碗杯]|個(?!人))/g)].map(match => Number(match[1])).filter(quantity => quantity <= (options.maximum ?? 99))
}

/** Normalizes local numeric slots, never catalog names or the original ASR transcript. */
export function normalizeSlotNumbers(transcript: string) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  return transcript.replace(/[\uFF10-\uFF19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/[二三四五六七八九]十[一二三四五六七八九]?|十[一二三四五六七八九]?|[一二兩三四五六七八九]/g, (token) => {
      if (token.includes('十')) {
        const [tens, units] = token.split('十')
        return String((digits[tens] ?? 1) * 10 + (digits[units] ?? 0))
      }
      return String(digits[token])
    })
}
