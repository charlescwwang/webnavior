import type { Tool } from '@xsai/shared-chat'

import { rawTool } from '@xsai/tool'

import { availableInteractiveServices, openInteractiveService } from '../services/interactive-services'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Creates the only tool which can navigate stage-web's single interactive iframe. */
export function createInteractiveServiceTools(): Tool[] {
  const services = availableInteractiveServices.value
  if (services.length === 0)
    return []

  return [rawTool({
    name: 'open_registered_interactive_service',
    description: '在唯一的互動 iframe 中開啟已核准的服務。僅在顧客需求符合服務用途時使用。',
    parameters: {
      type: 'object',
      properties: {
        serviceId: {
          type: 'string',
          enum: services.map(service => service.id),
          description: services.map(service => `${service.id}: ${service.description}`).join('\n'),
        },
      },
      required: ['serviceId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      if (!isRecord(input) || typeof input.serviceId !== 'string')
        throw new Error('open_registered_interactive_service requires an enabled serviceId.')
      const service = openInteractiveService(input.serviceId)
      return { id: service.id, title: service.title }
    },
  })]
}

export function createInteractiveServicePrompt() {
  const services = availableInteractiveServices.value.map(service => `- ${service.id}: ${service.description}`).join('\n')
  return `互動區只有一個 iframe，且只能切換至以下已登錄服務：\n${services}\n\n僅在顧客需求符合描述時呼叫 open_registered_interactive_service。不得開啟或建議未登錄網址，也不得將使用者提供的網址當作服務。`
}
