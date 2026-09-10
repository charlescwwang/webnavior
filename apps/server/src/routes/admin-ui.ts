import type { Env } from '../libs/env'
import type { HonoEnv } from '../types/hono'

import { Hono } from 'hono'

import { SERVER_ADMIN_UI_BASE_PATH } from '../utils/server-admin-ui'

export function createAdminUiRoutes(env: Pick<Env, 'WEB_APP_URL'>) {
  return new Hono<HonoEnv>()
    .get(SERVER_ADMIN_UI_BASE_PATH, c => c.redirect(buildLocalAdminRedirectUrl(env)))
    .get(`${SERVER_ADMIN_UI_BASE_PATH}/*`, c => c.redirect(buildLocalAdminRedirectUrl(env)))
}

function buildLocalAdminRedirectUrl(env: Pick<Env, 'WEB_APP_URL'>): string {
  return new URL('/dashboard', env.WEB_APP_URL).toString()
}
