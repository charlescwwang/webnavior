import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { webMcpAdapter } from '../services/webmcp-adapter'

/** Maps active native WebMCP tools into the tool format consumed by AIRI's LLM runtime. */
export function createWebMcpTools(): Tool[] {
  // A host form may submit identity; a model must never invent a phone value.
  return webMcpAdapter.tools.value.filter(tool => !['kiosk_test_menu', 'kiosk_customer_phone', 'kiosk_customer_entry_start'].includes(tool.name)).map(tool => rawTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    execute: async input => await webMcpAdapter.execute(tool, input as Record<string, unknown>),
  }))
}
