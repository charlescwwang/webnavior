import { readFile } from 'node:fs/promises'

import { boolean, check, integer, number, parse, pipe, strictObject, string } from 'valibot'

import { parsePageUrl } from './policy'

const settingsSchema = strictObject({
  kioskUrl: pipe(string(), check((value) => {
    try {
      const url = parsePageUrl(value)
      return url.pathname.endsWith('/kiosk/') && !url.search && !url.hash
    }
    catch { return false }
  }, 'kioskUrl must be an approved Kiosk URL ending in /kiosk/.')),
  windowed: boolean(),
  diagnosticPort: pipe(number(), integer(), check(value => value === 0 || (value >= 1024 && value <= 65535), 'diagnosticPort must be 0 or 1024..65535.')),
})

/** Reads the operator-owned file next to the portable executable; invalid settings stop startup. */
export async function readPortableSettings(path: string) {
  // Windows Notepad can save UTF-8 with a BOM; it is encoding, not JSON data.
  const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  return parse(settingsSchema, JSON.parse(text))
}
