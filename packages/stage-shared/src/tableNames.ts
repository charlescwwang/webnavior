import { normalizeSlotNumbers } from './orderingSlots'

/** Resolves one current table name; leading zeroes are insignificant within each numeric segment. */
export function resolveTableName(name: string, choices: readonly string[]): string | undefined {
  const canonical = (value: string) => {
    const text = normalizeSlotNumbers(value).replaceAll(/[\s()（）]/g, '').toUpperCase().replaceAll('吧台', '吧檯').replaceAll(/[‐‑–—－之]/g, '-')
    if (/^(?:我?(?:想要?|要)|請(?:幫我)?|幫我)?(?:外帶|自取|櫃台自取|櫃台取餐|櫃檯取餐)(?:就好|謝謝|可以嗎|嗎)?$/.test(text))
      return 'COUNTER'
    const code = text.match(/^([A-Z]+)(\d+(?:-\d+)*)(?:桌|號桌|號|吧檯|BAR|TABLE)?$/)
    // Preserve separators: A3-1 is neither A3 nor A31. Ambiguous equivalent
    // names still fail the unique-choice check below.
    return code ? `${code[1]}${code[2].split('-').map(segment => Number(segment)).join('-')}` : text
  }
  const matches = choices.filter(choice => canonical(choice) === canonical(name))
  return matches.length === 1 ? matches[0] : undefined
}
