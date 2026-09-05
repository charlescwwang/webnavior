import type { Tool } from '@xsai/shared-chat'

import type { RegisteredScenario } from '../services/scenario-registry'

import { rawTool } from '@xsai/tool'

import { scenarioRegistry } from '../services/scenario-registry'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Creates the sole model-controlled kiosk navigation tool.
 *
 * Its enum is derived from the deployment allow-list, so a model cannot open a
 * URL, navigate a frame, or activate a page that has not been registered.
 */
export function createScenarioNavigationTools(scenarios: readonly RegisteredScenario[], activeScenarioId?: string): Tool[] {
  const activeScenario = scenarios.find(scenario => scenario.id === activeScenarioId)
  return [rawTool({
    name: 'kiosk_open_registered_scenario',
    description: `切換唯一的 kiosk iframe 至已核准服務。目前頁面是「${activeScenario?.title ?? '未載入'}」。只有顧客明確要求不同服務時使用；不得用於開啟已顯示的預設頁。`,
    parameters: {
      type: 'object',
      properties: {
        scenarioId: {
          type: 'string',
          enum: scenarios.map(scenario => scenario.id),
          description: scenarios.map(scenario => `${scenario.id}: ${scenario.description}`).join('\n'),
        },
      },
      required: ['scenarioId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      if (!isRecord(input) || typeof input.scenarioId !== 'string')
        throw new Error('kiosk_open_registered_scenario requires a registered scenarioId.')
      const scenario = await scenarioRegistry.activate(input.scenarioId)
      return { id: scenario.id, title: scenario.title }
    },
  })]
}

/** Describes the kiosk navigation constraint for the model's system prompt. */
export function createScenarioNavigationPrompt(scenarios: readonly RegisteredScenario[], activeScenarioId?: string, agentInstructions?: string) {
  const entries = scenarios.map(scenario => `- ${scenario.id}: ${scenario.description}`).join('\n')
  const activeScenario = scenarios.find(scenario => scenario.id === activeScenarioId)
  const defaultScenario = scenarios[0]
  const administratorInstructions = agentInstructions?.trim() ? `\n\n管理者補充的營運指示：\n${agentInstructions.trim()}` : ''
  return `Kiosk 只有一個 iframe。目前顯示「${activeScenario?.title ?? '未載入'}」（${activeScenario?.id ?? 'none'}）；預設服務是「${defaultScenario?.title ?? '未設定'}」（${defaultScenario?.id ?? 'none'}）。\n\nKiosk 只能顯示下列已登錄互動頁面：\n${entries}\n\n不要為一般招呼或顧客正在使用目前頁面而呼叫 kiosk_open_registered_scenario。只有顧客明確要求另一個已登錄服務，且目標與目前頁面不同時才可切換。不得開啟、建議或嘗試任何未登錄網址；不得把使用者提供的網址當作可開啟頁面。${administratorInstructions}`
}
