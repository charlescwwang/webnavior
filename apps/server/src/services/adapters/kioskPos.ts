// Only owned merchant namespaces may share this proxy. Keep the original
// route and authentication policy intact beneath the supplier prefix.
const publicRoutes = /^(?:supplier\/)?(?:v1\/(?:catalog|seating)|v1\/continuations\/[\w-]{1,200}(?:\/(?:table|takeout))?)$/
const deviceRoutes = /^(?:supplier\/)?(?:v1\/(?:payments|orders|table-orders|ordering-context|seating\/holds)|v1\/(?:payments|seating\/holds)\/[\w-]{1,200})$/

/** Restricts the device proxy to POS contracts; never forwards an arbitrary URL. */
export function isPosRoute(path: string): boolean {
  return publicRoutes.test(path) || deviceRoutes.test(path)
}

/** Catalog and order continuation already have their own public/capability policy. */
export function isPublicPosRoute(path: string): boolean {
  return publicRoutes.test(path)
}

/** Forwards the verified device cookie to a fixed server-owned POS Bridge. */
export function createKioskPosGateway(baseUrl: string) {
  const base = new URL(baseUrl)
  return {
    forward: async (input: { path: string, method: string, body?: ArrayBuffer, credential?: string }): Promise<Response> => {
      if (!isPosRoute(input.path))
        throw new Error('Unsupported POS route')
      const response = await fetch(new URL(input.path, base), {
        method: input.method,
        headers: {
          'Content-Type': 'application/json',
          ...(input.credential ? { Cookie: `airi_kiosk_device=${encodeURIComponent(input.credential)}` } : {}),
        },
        body: input.body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      // Upstream cookies and credentials never become browser response headers.
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    },
  }
}
