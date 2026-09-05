import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { webMcpAdapter } from '../services/webmcp-adapter'

/** Maps active native WebMCP tools into the tool format consumed by AIRI's LLM runtime. */
export function createWebMcpTools(): Tool[] {
  return webMcpAdapter.tools.value.map(tool => rawTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    execute: async input => await webMcpAdapter.execute(tool, input as Record<string, unknown>),
  }))
}
