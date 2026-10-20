import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { hostToolNames } from '../../../order-menu/src/hostTools'
import { webMcpAdapter } from '../services/webmcp-adapter'

const kioskHostOnlyToolNames: ReadonlySet<string> = new Set(hostToolNames)

/** Maps active native WebMCP tools into the tool format consumed by AIRI's LLM runtime. */
export function createWebMcpTools(): Tool[] {
  return webMcpAdapter.tools.value
    // The host uses this read-only tool to construct Dasein's finite action
    // set. It is deliberately not an LLM capability: the Main Agent must not
    // learn an internal routing surface or use it as an alternate planner.
    .filter(tool => !kioskHostOnlyToolNames.has(tool.name))
    .map(tool => rawTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async input => await webMcpAdapter.execute(tool, input as Record<string, unknown>),
    }))
}
