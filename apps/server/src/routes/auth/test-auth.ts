import type { AuthInstance } from '../../libs/auth'
import type { Database } from '../../libs/db'
import type { Env } from '../../libs/env'
import type { HonoEnv } from '../../types/hono'

import process from 'node:process'

import { createHmac } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { email, object, pipe, safeParse, string } from 'valibot'

import { createBadRequestError, createNotFoundError, createUnauthorizedError } from '../../utils/error'

import * as schema from '../../schemas'

const testSignInSchema = object({
  email: pipe(string(), email('請輸入有效的 Email。')),
})

function isTestAuthenticationEnabled(env: Env): boolean {
  return process.env.NODE_ENV !== 'production' && env.WEBNAVIOR_TEST_AUTH_ENABLED === 'true'
}

function signCookieValue(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64')
  return encodeURIComponent(`${value}.${signature}`)
}

/**
 * Provides an explicit, development-only account recognition flow.
 *
 * Call stack:
 *
 * test sign-in request
 *   -> {@link createTestAuthenticationRoutes}
 *     -> Better Auth internal session adapter
 *       -> signed Better Auth session cookie
 */
export function createTestAuthenticationRoutes(deps: { auth: AuthInstance, db: Database, env: Env }) {
  return new Hono<HonoEnv>()
    .get('/status', c => c.json({ enabled: isTestAuthenticationEnabled(deps.env) }))
    .post('/session', async (c) => {
      if (!isTestAuthenticationEnabled(deps.env))
        throw createNotFoundError()

      const body = await c.req.json().catch(() => null)
      const result = safeParse(testSignInSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid test sign-in request', 'INVALID_REQUEST', result.issues)

      const user = await deps.db.query.user.findFirst({
        where: eq(schema.user.email, result.output.email.toLowerCase()),
      })
      if (!user || user.banned)
        throw createUnauthorizedError('No matching test account.')

      const context = await deps.auth.$context
      const session = await context.internalAdapter.createSession(user.id)
      if (!session?.token)
        throw new Error('Failed to create a test session.')

      // NOTICE:
      // Better Auth has no public API for minting a session for a preselected
      // development account. This mirrors its documented session-cookie shape
      // so the normal getSession path validates the server-side session row.
      // Source: better-auth/dist/api/routes/sign-in.mjs L249-259 and
      // better-call's signCookieValue recipe mirrored in oidc-jwt-bearer.ts.
      // Removal condition: remove this entire route before production launch.
      const cookieName = context.authCookies.sessionToken.name
      const cookieValue = signCookieValue(session.token, context.secret)
      c.header('Set-Cookie', `${cookieName}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax`)
      return c.json({ user: { email: user.email, name: user.name } })
    })
}
