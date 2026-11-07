const paths = new Map([['order_session', '/order'], ['XSRF-TOKEN', '/order'], ['srvkey', '/']])

/**
 * Prepares only PB's approved retained login/routing cookies in the dedicated
 * Firefox profile. This does not disable storage partitioning or grant access;
 * the embedded page must independently prove authenticated server state.
 */
export async function prepareFirefoxIframeLogin(context) {
  const cookies = await context.cookies('https://app.esgpb.com/order/')
  const updates = cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, '')
    const allowedDomain = domain === 'app.esgpb.com' || (cookie.name === 'srvkey' && domain === 'esgpb.com')
    return paths.get(cookie.name) === cookie.path && allowedDomain && !cookie.partitionKey && cookie.sameSite === 'Lax' && (cookie.expires <= 0 || cookie.expires > Date.now() / 1000)
  })
  // Preserve host/domain, HttpOnly, expiry and values. No credentials are copied
  // to another profile or printed; Strict/unrelated/partitioned cookies stay put.
  if (updates.length)
    await context.addCookies(updates.map(cookie => ({ ...cookie, sameSite: 'None', secure: true })))
  return { prepared: updates.length }
}
