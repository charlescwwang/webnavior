export interface ExpectedHostOriginInput {
  /** Build-time allowlist for the browser origin embedding this service. */
  configuredOrigin: string | undefined
  /** Browser-provided parent document referrer when the page is embedded. */
  referrer: string
  /** Whether the menu currently runs inside an iframe. */
  isEmbedded: boolean
}

function httpOrigin(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return undefined
    return url.origin
  }
  catch {
    return undefined
  }
}

/**
 * Resolves the exact browser origin permitted to discover this menu's tools.
 *
 * A port is part of a web origin. It is therefore preserved only when the
 * parent browser page genuinely uses that port; a configured public origin
 * always wins for reverse-proxy deployments.
 */
export function resolveExpectedHostOrigin(input: ExpectedHostOriginInput) {
  const configuredOrigin = input.configuredOrigin?.trim()
  if (configuredOrigin)
    return httpOrigin(configuredOrigin)

  if (!input.isEmbedded || !input.referrer)
    return undefined

  return httpOrigin(input.referrer)
}
