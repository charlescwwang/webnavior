import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { webMcpAdapter } from '../services/webmcp-adapter'

const kioskHostOnlyToolNames = new Set(['kiosk_interaction_state', 'kiosk_fast_path_context', 'kiosk_fast_path_execute', 'kiosk_fast_path_continue', 'kiosk_dialogue_presented', 'kiosk_question_validate', 'kiosk_agent_task'])

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
