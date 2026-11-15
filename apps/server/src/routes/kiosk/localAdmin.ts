import type { Context } from 'hono'

import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { integer, minValue, number, pipe, safeParse, strictObject, string } from 'valibot'

import { createForbiddenError, createServiceUnavailableError, createUnauthorizedError } from '../../utils/error'
import { isLoopbackOrigin } from '../../utils/origin'

export const localAdminCookieName = 'airi_kiosk_local_admin'
const sessionLifetimeSeconds = 15 * 60
const sessionSchema = strictObject({ deviceId: string(), credentialHash: string(), expiresAt: pipe(number(), integer(), minValue(1)) })
// Fixed-size digests allow timing-safe PIN comparison without leaking its length.
const digest = (value: string) => createHash('sha256').update(value).digest()

/** Environment PIN takes priority; a private file supports service-managed deployments. */
export async function loadLocalAdminPin(pin: string, file: string): Promise<string | undefined> {
  if (pin.trim())
    return pin.trim()
  try {
    return (await readFile(file, 'utf8')).trim() || undefined
  }
  catch (error) {
    // An unconfigured installation leaves PIN access closed; other file errors
    // must be diagnosed rather than silently treating a broken secret as absent.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined
    throw error
  }
}

/** Owns the signed, expiring local settings grant, bound to one device credential. */
export function createLocalAdminAccess(options: { pin?: string, secret: string, secureCookies: boolean, origin?: string }) {
  // Include PIN identity so rotating either secret invalidates existing grants.
  const signingKey = `kiosk-local-admin:v1:${options.secret}:${digest(options.pin ?? '').toString('hex')}`
  const cookieOptions = { httpOnly: true, secure: options.secureCookies, sameSite: 'Strict' as const, path: '/api/kiosk' }

  function assertOrigin(c: Context) {
    const origin = c.req.header('Origin')
    const localDevelopment = options.origin && origin && isLoopbackOrigin(options.origin) && isLoopbackOrigin(origin)
    if (options.origin && origin !== options.origin && !localDevelopment)
      throw createForbiddenError('Untrusted local administrator origin')
  }

  return {
    assertOrigin,
    async unlock(c: Context, deviceId: string, credential: string, pin: string) {
      assertOrigin(c)
      if (!options.pin || !options.secret)
        throw createServiceUnavailableError('Local administrator PIN is not configured')
      if (!timingSafeEqual(digest(pin), digest(options.pin)))
        throw createUnauthorizedError('Incorrect local administrator PIN')
      const expiresAt = Date.now() + sessionLifetimeSeconds * 1000
      await setSignedCookie(c, localAdminCookieName, JSON.stringify({ deviceId, credentialHash: digest(credential).toString('hex'), expiresAt }), signingKey, { ...cookieOptions, maxAge: sessionLifetimeSeconds })
      return { expiresAt }
    },
    async authorize(c: Context, deviceId: string, credential: string) {
      assertOrigin(c)
      if (!options.pin)
        throw createUnauthorizedError('Unlock the local administrator PIN first')
      const cookie = await getSignedCookie(c, signingKey, localAdminCookieName)
      if (!cookie)
        throw createUnauthorizedError('Unlock the local administrator PIN first')
      let payload: unknown
      try {
        payload = JSON.parse(cookie)
      }
      catch {
        throw createUnauthorizedError('Invalid local administrator session')
      }
      const parsed = safeParse(sessionSchema, payload)
      if (!parsed.success || parsed.output.deviceId !== deviceId || parsed.output.credentialHash !== digest(credential).toString('hex') || parsed.output.expiresAt <= Date.now())
        throw createUnauthorizedError('Local administrator authorization has expired or belongs to another device')
    },
    lock(c: Context) {
      assertOrigin(c)
      deleteCookie(c, localAdminCookieName, cookieOptions)
    },
  }
}
