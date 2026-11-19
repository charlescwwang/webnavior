import type { SurfaceBounds } from '@proj-airi/stage-shared/kiosk-desktop'
import type { HandlerDetails, Session } from 'electron'

type PermissionCheck = Exclude<Parameters<Session['setPermissionCheckHandler']>[0], null>
type PermissionRequest = Exclude<Parameters<Session['setPermissionRequestHandler']>[0], null>
type PermissionDetails = Parameters<PermissionCheck>[3] | Parameters<PermissionRequest>[3]

/** Remote pages require HTTPS except loopback and exact operator-approved Kiosk origins. */
export function parsePageUrl(value: string, httpOrigins: readonly string[] = []): URL {
  const url = new URL(value)
  if (url.username || url.password)
    throw new Error('Page URLs cannot contain credentials.')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  // Keep the HTTP exception on this host, port and Kiosk path; vendor pages still require TLS.
  const lanKiosk = httpOrigins.includes(url.origin) && url.pathname.startsWith('/kiosk/')
  if (url.protocol !== 'https:' && (url.protocol !== 'http:' || (!loopback && !lanKiosk)))
    throw new Error('Use HTTPS, loopback HTTP, or an explicitly configured HTTP Kiosk origin.')
  return url
}

/** Native child bounds are DIP, matching CSS pixels only at the enforced host zoom of one. */
export function clipBounds(bounds: SurfaceBounds, content: { width: number, height: number }): SurfaceBounds {
  const x = Math.max(0, Math.min(content.width, Math.round(bounds.x)))
  const y = Math.max(0, Math.min(content.height, Math.round(bounds.y)))
  // Clip the original right/bottom edge: moving a negative origin must not enlarge its view.
  const right = Math.max(x, Math.min(content.width, Math.round(bounds.x + bounds.width)))
  const bottom = Math.max(y, Math.min(content.height, Math.round(bounds.y + bounds.height)))
  return { x, y, width: right - x, height: bottom - y }
}

/** Preload privileges stay on the configured Kiosk origin and path, including hash routes. */
export function isHostPage(value: string, entry: URL): boolean {
  try {
    const url = new URL(value)
    return url.origin === entry.origin && url.pathname.startsWith(entry.pathname)
  }
  catch {
    return false
  }
}

/** Admits only the named text console from the current trusted host document. */
export function isTextConsoleRequest(page: string, entry: URL, request: Pick<HandlerDetails, 'url' | 'frameName' | 'referrer'>): boolean {
  if (request.url !== 'about:blank' || request.frameName !== 'airi-kiosk-text-console' || !isHostPage(page, entry))
    return false
  // NOTICE: Real HTTPS Electron requests to about:blank can have an empty
  // referrer under strict-origin-when-cross-origin. The owning WebContents and
  // its current Kiosk route identify the host; referrer is only an extra check.
  // Electron's referrer describes delivery policy, not authenticated origin:
  // https://www.electronjs.org/docs/latest/api/web-contents/#contentssetwindowopenhandlerhandler
  if (!request.referrer.url)
    return true
  try {
    return new URL(request.referrer.url).origin === entry.origin
  }
  catch {
    return false
  }
}

/** Media belongs to the trusted Kiosk main frame; vendor pages and embedded frames have no grant. */
export function isHostMediaRequest(page: string, entry: URL, permission: string, origin: string | undefined, details: PermissionDetails): boolean {
  if (permission !== 'media' || !details.isMainFrame || !isHostPage(page, entry))
    return false
  if (details.requestingUrl && !isHostPage(details.requestingUrl, entry))
    return false
  const origins = [origin, 'securityOrigin' in details ? details.securityOrigin : undefined, 'embeddingOrigin' in details ? details.embeddingOrigin : undefined]
  // An explicit contradictory frame identity must not fall back to the owning window URL.
  // Electron may serialize securityOrigin as a root URL, with a trailing slash.
  if (origins.some(value => value !== undefined && value !== entry.origin && value !== `${entry.origin}/`))
    return false
  if ('mediaTypes' in details)
    return Boolean(details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio' || type === 'video'))
  return 'mediaType' in details && (details.mediaType === 'audio' || details.mediaType === 'video')
}

/** Clipboard writes belong to the trusted host or its explicitly owned about:blank text popup. */
export function isHostClipboardWrite(page: string, entry: URL, permission: string, origin: string | undefined, details: PermissionDetails, ownedPopup = false): boolean {
  if (permission !== 'clipboard-sanitized-write' || !details.isMainFrame)
    return false
  const admitted = (value: string) => isHostPage(value, entry) || (ownedPopup && value === 'about:blank')
  if (!admitted(page) || (details.requestingUrl && !admitted(details.requestingUrl)))
    return false
  const origins = [origin, 'securityOrigin' in details ? details.securityOrigin : undefined, 'embeddingOrigin' in details ? details.embeddingOrigin : undefined]
  return origins.every(value => value === undefined || value === entry.origin || value === `${entry.origin}/`)
}
