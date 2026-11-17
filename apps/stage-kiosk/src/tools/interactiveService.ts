import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { hostToolNames } from '../../../order-menu/src/hostTools'
import { executeBrowserCartTool } from '../services/browserCartTask'
import { createBrowserOrderingTools } from '../services/browserOrderingTools'
import { interactiveServiceClient } from '../services/interactiveServiceClient'

const kioskHostOnlyToolNames: ReadonlySet<string> = new Set(hostToolNames)

/** Publishes business operations while keeping PB's native control protocol private. */
export function createInteractiveServiceTools(): Tool[] {
  if (interactiveServiceClient.tools.value.some(tool => tool.name === 'browser_observe' || tool.name === 'browser_state_get'))
    return createBrowserOrderingTools(interactiveServiceClient)
  return interactiveServiceClient.tools.value
    .filter(tool => !kioskHostOnlyToolNames.has(tool.name))
    .map(tool => rawTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async input => executeBrowserCartTool(interactiveServiceClient, tool, input as Record<string, unknown>),
    }))
}
