export const SERVER_AUTH_UI_BASE_PATH = '/auth'
export const AUTH_UI_API_SERVER_URL_QUERY_PARAM = 'api_server_url'
export const DEFAULT_AUTH_UI_URL = 'http://localhost:5167'

/**
 * Builds an absolute URL inside the externally hosted auth UI.
 *
 * Use when:
 * - Redirecting server-owned auth UI entrypoints to the standalone
 *   `apps/ui-server-auth` deployment.
 * - Preserving query parameters from OIDC, verification, or reset flows.
 *
 * Expects:
 * - `authUiUrl` is the public auth UI base, usually ending in `/ui`.
 * - `path` is the route path within the auth UI router.
 *
 * Returns:
 * - An absolute URL with the auth UI base path, normalized path, and search.
 */
export function buildAuthUiUrl(authUiUrl: string, path: string, search = ''): string {
  const target = new URL(authUiUrl)
  const basePath = target.pathname.replace(/\/+$/, '')
  const routePath = path.startsWith('/') ? path : `/${path}`

  target.pathname = `${basePath}${routePath}`
  target.search = search
  target.hash = ''

  return target.toString()
}

/**
 * Resolves the standalone auth UI base for the active server environment.
 *
 * Use when:
 * - The server redirects historical `/auth/*` entrypoints to the standalone UI.
 * - A caller needs a normalized configured auth UI base.
 *
 * Expects:
 * - `authUiUrl` is the configured auth UI base URL.
 * - `apiServerUrl` is the configured API server URL.
 *
 * Returns:
 * - The configured auth UI URL.
 */
export function resolveAuthUiUrl(authUiUrl: string, apiServerUrl: string): string {
  void apiServerUrl
  return authUiUrl
}

/**
 * Maps a server `/auth/*` request to the standalone auth UI.
 *
 * Use when:
 * - The server keeps owning the historical `/auth/*` entrypoint but no longer
 *   packages the auth UI bundle.
 *
 * Expects:
 * - `requestUrl` is the incoming server URL.
 * - `authUiUrl` points to the standalone auth UI base path.
 *
 * Returns:
 * - The external auth UI URL preserving route suffix and query string.
 */
export function buildAuthUiRedirectUrl(authUiUrl: string, requestUrl: string, apiServerUrl?: string): string {
  const request = new URL(requestUrl)
  const suffix = request.pathname === SERVER_AUTH_UI_BASE_PATH
    ? '/'
    : request.pathname.slice(SERVER_AUTH_UI_BASE_PATH.length) || '/'
  const resolvedAuthUiUrl = apiServerUrl ? resolveAuthUiUrl(authUiUrl, apiServerUrl) : authUiUrl

  const target = new URL(buildAuthUiUrl(resolvedAuthUiUrl, suffix, request.search))
  if (apiServerUrl) {
    const apiServer = new URL(apiServerUrl)
    target.searchParams.set(AUTH_UI_API_SERVER_URL_QUERY_PARAM, apiServer.origin)
  }

  return target.toString()
}
