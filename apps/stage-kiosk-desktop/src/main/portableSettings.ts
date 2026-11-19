import { readFileSync } from 'node:fs'

import { array, boolean, check, integer, maxLength, minLength, number, parse, pipe, strictObject, string, transform } from 'valibot'

import defaultSettings from '../../kiosk.settings.example.json'

import { parsePageUrl } from './policy'

/** Operator-editable launch entries; server trust must separately admit each origin. */
export const defaultConnections = defaultSettings.connections

const kioskUrlSchema = pipe(string(), check((value) => {
  try {
    // Only this operator-owned launch list may approve a remote HTTP origin.
    // Merchant pages use parsePageUrl without this grant and still require TLS.
    const url = parsePageUrl(value, [new URL(value).origin])
    return url.pathname === '/kiosk/' && !url.search && !url.hash
  }
  catch { return false }
}, 'Use an HTTP(S) Kiosk base URL ending in /kiosk/, without credentials, query or hash.'), transform(value => new URL(value).href))

const settingsSchema = pipe(strictObject({
  kioskUrl: kioskUrlSchema,
  connections: pipe(array(strictObject({
    label: pipe(string(), transform(value => value.trim()), minLength(1), maxLength(80)),
    url: kioskUrlSchema,
  })), minLength(1), maxLength(8), check(entries => new Set(entries.map(entry => entry.url)).size === entries.length, 'Connection URLs must be unique.')),
  windowed: boolean(),
  diagnosticPort: pipe(number(), integer(), check(value => value === 0 || (value >= 1024 && value <= 65535), 'diagnosticPort must be 0 or 1024..65535.')),
}), check(settings => settings.connections.some(entry => entry.url === settings.kioskUrl), 'kioskUrl must match one configured connection.'))

/** Reads and validates launch policy synchronously, before Electron can emit ready. */
export function readPortableSettings(path: string) {
  // Windows Notepad can save UTF-8 with a BOM; it is encoding, not JSON data.
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  return parse(settingsSchema, JSON.parse(text))
}
