import { normalizeSlotNumbers } from './orderingSlots'

/** Resolves spoken table codes to one current website name; A3 and A03 are equivalent. */
export function resolveTableName(name: string, choices: readonly string[]): string | undefined {
  const canonical = (value: string) => {
    const text = normalizeSlotNumbers(value).replaceAll(/[\s()（）]/g, '').toUpperCase().replaceAll('吧台', '吧檯')
    if (/^(?:我?(?:想要?|要)|請(?:幫我)?|幫我)?(?:外帶|自取|櫃台自取|櫃台取餐|櫃檯取餐)(?:就好|謝謝|可以嗎|嗎)?$/.test(text))
      return 'COUNTER'
    const code = text.match(/^([A-Z]+)(\d+)(?:桌|號桌|號|吧檯|BAR|TABLE)?$/)
    return code ? `${code[1]}${Number(code[2])}` : text
  }
  const matches = choices.filter(choice => canonical(choice) === canonical(name))
  return matches.length === 1 ? matches[0] : undefined
}
