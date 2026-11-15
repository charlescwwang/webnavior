/** Scanner text formats shared by the owned Menu and the PB field adapter. */
export type ScannedInvoiceMethod = 'carrier' | 'citizen'

/** Normalizes scanner whitespace/case only; it never guesses or repairs missing digits. */
export function invoiceCode(method: ScannedInvoiceMethod, value: string): string | undefined {
  const code = value.trim().toUpperCase()
  const valid = method === 'carrier' ? /^\/[0-9A-Z+.-]{7}$/.test(code) : /^[A-Z]{2}\d{14}$/.test(code)
  return valid ? code : undefined
}
