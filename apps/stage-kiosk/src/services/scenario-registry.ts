import type { KioskInteractiveService } from '../composables/useKioskInteractiveServices'

import { computed, nextTick, readonly, shallowRef } from 'vue'

/** A customer-facing web application explicitly approved for one kiosk deployment. */
export interface RegisteredScenario {
  /** Stable ID exposed to the model. It is never a URL or arbitrary user input. */
  id: string
  /** Short customer-facing name displayed above the iframe. */
  title: string
  /** Specific customer task this page supports. Used to constrain model navigation. */
  description: string
  /** HTTPS production URL or a local development URL owned by the deployment. */
  serviceUrl: string
}

export type InteractiveServiceEvent = 'activity' | 'completed'

/** Non-personal order outcome emitted by the approved demonstration ordering service. */
export interface InteractiveServiceOrderResult {
  fulfillmentMode: 'dine-in' | 'takeout'
  id: string
  itemCount: number
  simulated: boolean
  total: number
}

/** Injectable browser event boundary used to test iframe lifecycle isolation. */
export interface CreateScenarioRegistryOptions {
  messageTarget?: Pick<EventTarget, 'addEventListener'>
}

interface InteractiveServiceEventMessage {
  orderResult?: InteractiveServiceOrderResult
  source: 'airi-interaction-lifecycle'
  type: InteractiveServiceEvent
}

function hasValidOrderResult(value: unknown): value is InteractiveServiceOrderResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const result = value as Record<string, unknown>
  return typeof result.id === 'string'
    && typeof result.itemCount === 'number'
    && typeof result.simulated === 'boolean'
    && typeof result.total === 'number'
    && (result.fulfillmentMode === 'dine-in' || result.fulfillmentMode === 'takeout')
}

function isRegisteredScenario(scenario: RegisteredScenario): boolean {
  if (!/^[a-z][a-z0-9-]*$/.test(scenario.id) || !scenario.title.trim() || !scenario.description.trim())
    return false
  try {
    const serviceUrl = new URL(scenario.serviceUrl)
    return serviceUrl.protocol === 'https:' || serviceUrl.protocol === 'http:'
  }
  catch {
    return false
  }
}

/**
 * Owns the kiosk's approved interactive pages and the active page selection.
 *
 * The registry is the navigation security boundary: callers select a known
 * scenario ID, while URLs remain deployment configuration rather than model
 * tool input.
 */
export function createScenarioRegistry(options: CreateScenarioRegistryOptions = {}) {
  const registeredScenarios = shallowRef<readonly RegisteredScenario[]>([])
  const eventListeners = new Set<(event: InteractiveServiceEvent, orderResult?: InteractiveServiceOrderResult) => void>()
  const activeScenarioId = shallowRef<string>()
  const revision = shallowRef(0)
  const iframeRevision = shallowRef(0)
  let scenariosById = new Map<string, RegisteredScenario>()
  let activeFrameWindow: MessageEventSource | null = null
  const activeScenario = computed(() => activeScenarioId.value ? scenariosById.get(activeScenarioId.value) : undefined)

  const messageTarget = options.messageTarget ?? (typeof window === 'undefined' ? new EventTarget() : window)
  messageTarget.addEventListener('message', (event) => {
    const message = event as MessageEvent<InteractiveServiceEventMessage>
    const scenario = activeScenario.value
    if (!scenario || message.source !== activeFrameWindow || message.origin !== new URL(scenario.serviceUrl).origin)
      return
    if (message.data?.source !== 'airi-interaction-lifecycle' || (message.data.type !== 'activity' && message.data.type !== 'completed'))
      return
    if (message.data.orderResult !== undefined && !hasValidOrderResult(message.data.orderResult))
      return
    eventListeners.forEach(listener => listener(message.data.type, message.data.orderResult))
  })

  function setServices(services: readonly KioskInteractiveService[]) {
    const registeredIds = new Set<string>()
    const nextScenarios = services.filter((service) => {
      if (!service.enabled || !isRegisteredScenario(service) || registeredIds.has(service.id))
        return false
      registeredIds.add(service.id)
      return true
    })
    const nextById = new Map(nextScenarios.map(scenario => [scenario.id, scenario]))

    scenariosById = nextById
    registeredScenarios.value = nextScenarios
    if (!activeScenarioId.value || !nextById.has(activeScenarioId.value))
      activeScenarioId.value = nextScenarios[0]?.id
    iframeRevision.value++
    revision.value++
  }

  async function activate(id: string) {
    const scenario = scenariosById.get(id)
    if (!scenario)
      throw new Error(`Kiosk scenario "${id}" is not registered.`)

    if (activeScenarioId.value !== id)
      activeFrameWindow = null
    activeScenarioId.value = id
    // Let ScenarioSurface create the selected iframe before returning. Opening
    // an approved page must not depend on that page implementing WebMCP: its
    // manifest only controls optional follow-up tools.
    await nextTick()
    return scenario
  }

  function reloadActive() {
    activeFrameWindow = null
    iframeRevision.value++
  }

  function attachActiveFrame(frameSource: MessageEventSource | null) {
    activeFrameWindow = frameSource
  }

  function on(event: InteractiveServiceEvent, listener: (orderResult?: InteractiveServiceOrderResult) => void) {
    const wrappedListener = (received: InteractiveServiceEvent, orderResult?: InteractiveServiceOrderResult) => {
      if (received === event)
        listener(orderResult)
    }
    eventListeners.add(wrappedListener)
    return () => eventListeners.delete(wrappedListener)
  }

  return {
    activeScenario: readonly(activeScenario),
    activeScenarioId: readonly(activeScenarioId),
    activate,
    attachActiveFrame,
    iframeRevision: readonly(iframeRevision),
    on,
    registeredScenarios: readonly(registeredScenarios),
    revision: readonly(revision),
    reloadActive,
    setServices,
  }
}

/** The kiosk's deployment-approved interaction surface registry. */
export const scenarioRegistry = createScenarioRegistry()
