import type { SurfaceBounds } from '@proj-airi/stage-shared/kiosk-desktop'
import type { Session } from 'electron'

type PermissionCheck = Exclude<Parameters<Session['setPermissionCheckHandler']>[0], null>
type PermissionRequest = Exclude<Parameters<Session['setPermissionRequestHandler']>[0], null>
type PermissionDetails = Parameters<PermissionCheck>[3] | Parameters<PermissionRequest>[3]

/** Remote pages require HTTPS; plaintext is restricted to explicit loopback development. */
export function parsePageUrl(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password)
    throw new Error('Page URLs cannot contain credentials.')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && (url.protocol !== 'http:' || !loopback))
    throw new Error('Use HTTPS, or HTTP on loopback for development.')
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
