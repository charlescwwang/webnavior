/** Verifies the existing HttpOnly device credential with the owning API. */
export function createKioskAuthentication(baseUrl: string) {
  const identity = new URL('/api/kiosk/identity', baseUrl)
  return async (request: Request): Promise<string | undefined> => {
    const cookie = request.headers.get('cookie')
    if (!cookie)
      return undefined
    const response = await fetch(identity, { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5_000) })
    if (response.status === 401 || response.status === 403)
      return undefined
    if (!response.ok)
      throw new Error('Device verification unavailable')
    const body = await response.json() as { device?: { id?: unknown, siteId?: unknown } }
    if (typeof body.device?.id !== 'string' || typeof body.device.siteId !== 'string')
      throw new Error('Invalid device verification response')
    // Both keys come from a verified credential, never from caller-supplied IDs.
    return JSON.stringify([body.device.siteId, body.device.id])
  }
}
