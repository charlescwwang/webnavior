import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

/** Resolves the same authenticated management API for JSON and media requests. */
export function kioskManagementEndpoint(path: string) {
  return new URL(`/api/admin/kiosk${path}`, SERVER_URL).toString()
}

/** Reads management JSON; successful mutations may deliberately return no body. */
export function requestKioskManagement(path: string, init?: RequestInit): Promise<void>
export function requestKioskManagement<T>(path: string, init?: RequestInit): Promise<T>
export async function requestKioskManagement<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  const response = await authedFetch(kioskManagementEndpoint(path), init)
  if (!response.ok)
    throw new Error(await response.text() || `Request failed: ${response.status}`)
  // Device actions use 204. Parsing a completed action as JSON would make it
  // appear to fail and could invite an unnecessary repeat of that action.
  if (response.status === 204)
    return undefined
  return await response.json() as T
}
