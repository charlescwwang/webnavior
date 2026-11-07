import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { hostToolNames } from '../../../order-menu/src/hostTools'
import { executeBrowserCartTool, executeBrowserReply } from '../services/browserCartTask'
import { interactiveServiceClient } from '../services/interactiveServiceClient'

const kioskHostOnlyToolNames: ReadonlySet<string> = new Set(hostToolNames)

/** Maps active interactive service tools into the tool format consumed by AIRI's LLM runtime. */
export function createInteractiveServiceTools(): Tool[] {
  const remote = interactiveServiceClient.tools.value
    // The host uses this read-only tool to construct Dasein's finite action
    // set. It is deliberately not an LLM capability: the Main Agent must not
    // learn an internal routing surface or use it as an alternate planner.
    .filter(tool => tool.name !== 'browser_respond' && !kioskHostOnlyToolNames.has(tool.name) && tool.name !== 'browser_recovery_context' && tool.name !== 'browser_customer_reset')
    .map(tool => rawTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async input => await executeBrowserCartTool(interactiveServiceClient, tool, input as Record<string, unknown>),
    }))
  if (!interactiveServiceClient.tools.value.some(tool => tool.name === 'browser_observe'))
    return remote
  // This is Host-owned conversation, never an advertised vendor capability.
  return [...remote, rawTool({
    name: 'browser_respond',
    description: '結束一般招呼、了解、聽到與意思不明的非操作回覆。已查資料仍不足以確認顧客詢問的條件，使用 information-unavailable 明確說無法確認；不可列全部商品假裝符合。不得代替有資料的餐點查詢、選餐確認或購物車操作。',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['greeting', 'acknowledgement', 'hearing-check', 'clarification', 'information-unavailable'] } }, required: ['kind'], additionalProperties: false },
    execute: async input => executeBrowserReply(interactiveServiceClient, (input as Record<string, unknown>).kind),
  })]
}
