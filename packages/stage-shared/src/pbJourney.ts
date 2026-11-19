import { literal, maxLength, minLength, object, pipe, string } from 'valibot'

/** A reviewed PB deployment. These are separate service policies, not login fallbacks. */
export interface PbJourney {
  readonly origin: string
  readonly store: string
  readonly flow: 'pick_up' | 'internal_use'
  readonly buyer: 'member' | 'guest'
  /** Allows Host-confirmed order creation; never grants payment automation. */
  readonly canSubmit: boolean
  readonly basePath: string
  readonly menuPath: string
  readonly cartPath: string
  readonly tablePath?: string
}

const deployments = [
  { origin: 'https://app.esgpb.com', store: '1kgJeql', flow: 'pick_up', buyer: 'member', canSubmit: false },
  // Merchant-authorized unpaid orders; final summary assent remains mandatory.
  { origin: 'https://app.esgpb.com', store: '1kgJeql', flow: 'internal_use', buyer: 'guest', canSubmit: true },
  { origin: 'https://app-205-rd.esgpb.com', store: '1kAMNok', flow: 'internal_use', buyer: 'guest', canSubmit: false },
  // Public simulator is isolated from the merchant deployment and creates TEST orders only.
  { origin: 'https://webnavior.aikcitri.qzz.io', store: '1kgJeql', flow: 'internal_use', buyer: 'guest', canSubmit: true },
  // Explicit offline simulator; other loopback ports/stores remain untrusted.
  { origin: 'http://127.0.0.1:5188', store: '1kgJeql', flow: 'internal_use', buyer: 'guest', canSubmit: true },
] as const

/** Resolves only reviewed menu/cart/table pages; never widens access to a whole PB origin. */
export function readPbJourney(value: string): PbJourney | undefined {
  let url: URL
  try {
    url = new URL(value)
  }
  catch { return }
  if (url.username || url.password || url.hash)
    return
  for (const deployment of deployments) {
    const basePath = `/order/store/${deployment.store}/${deployment.flow}/`
    const menuPath = `${basePath}menu`
    const cartPath = `${basePath}orders/create`
    const tablePath = deployment.flow === 'internal_use' ? `${menuPath}/select-table` : undefined
    if (url.origin === deployment.origin && [menuPath, cartPath, tablePath].includes(url.pathname))
      return { ...deployment, basePath, menuPath, cartPath, tablePath }
  }
}

/** Resolves a read-only result page without granting editor/checkout privileges. */
export function readPbStateJourney(value: string): PbJourney | undefined {
  const editor = readPbJourney(value)
  if (editor)
    return editor
  let url: URL
  try {
    url = new URL(value)
  }
  catch { return }
  const menu = new URL(url.href)
  menu.pathname = url.pathname.replace(/orders\/[\w-]{1,200}(?:\/choosePayment)?$/, 'menu')
  const journey = readPbJourney(menu.href)
  return journey && isPbOrderResultUrl(menu.href, value) ? journey : undefined
}

/** Host approval follows its configured service, even when another PB deployment is reviewed. */
export function isPbJourneyPage(entry: string, current: string) {
  const expected = readPbJourney(entry)
  const actual = readPbJourney(current)
  return Boolean(expected && actual && expected.origin === actual.origin && expected.basePath === actual.basePath)
}

/** Browser backup belongs only to our simulator and a reviewed Kiosk parent, never the merchant. */
export function isPbSimulatorHost(serviceUrl: string, hostUrl: string): boolean {
  const journey = readPbStateJourney(serviceUrl)
  if (!journey || !['https://webnavior.aikcitri.qzz.io', 'http://127.0.0.1:5188'].includes(journey.origin))
    return false
  try {
    const host = new URL(hostUrl)
    // Same-site embedding preserves the simulator's Strict cookie isolation.
    // The Tailscale HTTP browser has neither that cookie context nor secure media APIs.
    const approvedOrigin = host.origin === journey.origin
      || (journey.origin === 'http://127.0.0.1:5188' && host.origin === 'http://127.0.0.1:5169')
    return approvedOrigin && !host.username && !host.password && host.pathname.startsWith('/kiosk/')
  }
  catch { return false }
}

/** Submission may retire the editor for its same-store order result; this grants no automation there. */
export function isPbOrderResultUrl(entry: string, current: string) {
  const journey = readPbJourney(entry)
  if (!journey)
    return false
  try {
    const url = new URL(current)
    if (url.origin !== journey.origin || url.username || url.password || url.hash || url.search)
      return false
    const suffix = url.pathname.slice(journey.basePath.length)
    const result = suffix.match(/^orders\/([\w-]{1,200})(?:\/choosePayment)?$/)
    return url.pathname.startsWith(journey.basePath) && Boolean(result && result[1] !== 'create')
  }
  catch { return false }
}

/** Accepts only the configured table QR intermediary as a Start acknowledgement target, never as an automation page. */
export function isPbTableEntryUrl(entry: string, current: string) {
  const journey = readPbJourney(entry)
  if (!journey?.tablePath || new URL(entry).pathname !== journey.tablePath)
    return false
  let target: URL
  try {
    target = new URL(current)
  }
  catch { return false }
  // PB's published dining-tables.scan route is /order/t/{qrToken}. The token
  // stays in native navigation; it is never returned to Main or used as a tool
  // handle. Actual menu/cart execution still uses isPbJourneyPage exclusively.
  return target.origin === journey.origin && !target.username && !target.password && !target.hash && !target.search
    && /^\/order\/t\/[\w.-]{1,200}$/.test(target.pathname)
}

/** A same-store table-page navigation acknowledgement, never a selected table or cart mutation. */
export const tableSelectionReceiptSchema = object({
  ok: literal(true),
  source: literal('browser'),
  code: literal('table-selection-starting'),
  effect: literal('none'),
  customerMessage: pipe(string(), minLength(1), maxLength(2000)),
})

/** A bounded menu-entry acknowledgement; it proves no cart or order mutation. */
export const menuEntryReceiptSchema = object({
  ok: literal(true),
  source: literal('browser'),
  code: literal('table-entry-starting'),
  effect: literal('none'),
  selectedTable: pipe(string(), minLength(1), maxLength(200)),
  customerMessage: pipe(string(), minLength(1), maxLength(2000)),
})
