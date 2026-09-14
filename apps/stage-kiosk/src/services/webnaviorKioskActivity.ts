export type WebnaviorKioskToolActivityState = 'done' | 'error' | 'executing'

export interface WebnaviorKioskToolActivity {
  error?: string
  running: string
  success?: string
}

export interface WebnaviorKioskActivityManifest {
  tools: Record<string, WebnaviorKioskToolActivity>
  version: 1
}

const manifestPath = '/.well-known/webnavior-kiosk-activity.json'
const maxActivityTextLength = 160

const fallbackActivity: Record<WebnaviorKioskToolActivityState, string> = {
  done: '已完成餐點資料處理，正在整理結果…',
  error: '正在重新確認餐點資訊…',
  executing: '正在處理餐點資料…',
}

function isActivityText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxActivityTextLength
}

function parseToolActivity(value: unknown): WebnaviorKioskToolActivity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  const entry = value as Record<string, unknown>
  if (!isActivityText(entry.running))
    return undefined

  return {
    ...(isActivityText(entry.error) ? { error: entry.error } : {}),
    running: entry.running,
    ...(isActivityText(entry.success) ? { success: entry.success } : {}),
  }
}

/**
 * Parses the optional presentation contract owned by an approved Webnavior
 * interactive service. Invalid entries are discarded independently so a menu
 * update can never block its WebMCP tools from serving customers.
 */
export function parseWebnaviorKioskActivityManifest(value: unknown): WebnaviorKioskActivityManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  const manifest = value as Record<string, unknown>
  if (manifest.version !== 1 || !manifest.tools || typeof manifest.tools !== 'object' || Array.isArray(manifest.tools))
    return undefined

  const tools = Object.fromEntries(
    Object.entries(manifest.tools)
      .filter(([name]) => /^[\w-]+$/.test(name))
      .flatMap(([name, entry]) => {
        const activity = parseToolActivity(entry)
        return activity ? [[name, activity]] : []
      }),
  )
  return { tools, version: 1 }
}

/** Returns a customer-safe progress label, even when a service has no manifest entry. */
export function describeWebnaviorKioskToolActivity(
  manifest: WebnaviorKioskActivityManifest | undefined,
  toolName: string,
  state: WebnaviorKioskToolActivityState,
) {
  const activity = manifest?.tools[toolName]
  if (state === 'executing')
    return activity?.running ?? fallbackActivity.executing
  if (state === 'done')
    return activity?.success ?? fallbackActivity.done
  return activity?.error ?? fallbackActivity.error
}

/** Builds the only manifest URL a kiosk may request for an approved service origin. */
export function webnaviorKioskActivityManifestUrl(serviceUrl: string) {
  return new URL(manifestPath, new URL(serviceUrl).origin).toString()
}

/**
 * Loads optional customer-facing tool activity text without affecting tool
 * discovery or execution when the service does not support this enhancement.
 */
export async function loadWebnaviorKioskActivityManifest(serviceUrl: string, fetchImpl: typeof fetch = globalThis.fetch) {
  try {
    const response = await fetchImpl(webnaviorKioskActivityManifestUrl(serviceUrl), {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    })
    if (!response.ok)
      return undefined
    return parseWebnaviorKioskActivityManifest(await response.json())
  }
  catch {
    return undefined
  }
}
