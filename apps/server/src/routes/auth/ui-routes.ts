import type { Env } from '../../libs/env'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'

import { getTrustedOrigin } from '../../utils/origin'

export const SERVER_AUTH_UI_BASE_PATH = '/auth'

type AuthUiEnvironment = Pick<Env, 'ADDITIONAL_TRUSTED_ORIGINS' | 'WEB_APP_URL'>

export interface AuthUiRoutesDeps {
  /** Origins used to select the local Webnavior sign-in page safely. */
  env: AuthUiEnvironment
}

/**
 * Creates routes that redirect historical server auth UI URLs to the local
 * Webnavior login page.
 *
 * Use when:
 * - Mounting auth pages before `/api/auth/*` catch-all routes.
 *
 * Expects:
 * - A web OIDC request includes its trusted `/auth/callback` redirect URI.
 *
 * Returns root-mounted redirects for `/auth/*` without sending browser
 * credentials or OIDC request state to an external auth deployment.
 */
export function createAuthUiRoutes(deps: AuthUiRoutesDeps) {
  return new Hono<HonoEnv>()
    .get(SERVER_AUTH_UI_BASE_PATH, c => c.redirect(buildLocalAuthRedirectUrl(deps.env, c.req.url)))
    .get(`${SERVER_AUTH_UI_BASE_PATH}/*`, c => c.redirect(buildLocalAuthRedirectUrl(deps.env, c.req.url)))
}

function buildLocalAuthRedirectUrl(env: AuthUiEnvironment, requestUrl: string) {
  const request = new URL(requestUrl)
  const fallbackOrigin = new URL(env.WEB_APP_URL).origin
  const redirectUri = request.searchParams.get('redirect_uri')

  let appOrigin = fallbackOrigin
  if (redirectUri) {
    try {
      const redirect = new URL(redirectUri)
      if (redirect.pathname === '/auth/callback' && getTrustedOrigin(redirect.origin, env.ADDITIONAL_TRUSTED_ORIGINS))
        appOrigin = redirect.origin
    }
    catch {
      // The authorization server validates the original OIDC request. This
      // fallback only selects the local page that renders the sign-in form.
    }
  }

  const target = new URL('/auth/login', appOrigin)
  target.search = request.search
  return target.toString()
}
