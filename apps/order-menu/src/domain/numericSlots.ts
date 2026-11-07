/** Parses an integer slot; price-only trailing-place elision is explicitly opt-in. */
export function parseNumericSlot(text: string, elideTrailingPlace = false) {
  const normalized = text.normalize('NFKC').replace(/万/g, '萬')
  if (normalized === '零' || normalized === '〇')
    return 0
  if (/^\d+$/.test(normalized))
    return Number(normalized)
  const sectionPattern = '(?:[一二兩两三四五六七八九]?千)?(?:[一二兩两三四五六七八九]?百)?(?:[零〇]?[一二兩两三四五六七八九]?十)?(?:[零〇]?[一二兩两三四五六七八九])?'
  if (!new RegExp(`^(?:${sectionPattern}萬[零〇]?)?${sectionPattern}$`).test(normalized)) {
    return undefined
  }
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 萬: 10000 }
  let total = 0
  let section = 0
  let digit = 0
  let lastUnit = 1
  for (const character of normalized) {
    if (character in digits) {
      digit = digits[character]!
    }
    else if (character in units) {
      lastUnit = units[character]!
      if (lastUnit === 10000) {
        // 萬 scales the whole preceding section: 十二萬 is120000, not20010.
        total += (section + digit || 1) * lastUnit
        section = 0
      }
      else {
        section += (digit || 1) * lastUnit
      }
      digit = 0
    }
    else { return undefined }
  }
  // Taiwanese price speech omits the trailing place: 百二 means120, 千二
  // means1200. An explicit zero blocks that elision, so 百零二 stays102.
  // Apply the rule to the last written unit, including 千二百三→1230.
  const trailingPlace = elideTrailingPlace && /[百千萬][一二兩两三四五六七八九]$/.test(normalized) ? lastUnit / 10 : 1
  return total + section + digit * trailingPlace
}
