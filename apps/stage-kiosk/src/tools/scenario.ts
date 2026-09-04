import type { Tool } from '@xsai/shared-chat'

import type { ScenarioManifest } from '../services/scenario-bridge'
import type { RegisteredScenario } from '../services/scenario-registry'

import { rawTool } from '@xsai/tool'

import { scenarioRegistry } from '../services/scenario-registry'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Converts a trusted scenario manifest into the LLM tools for its active kiosk.
 *
 * Tool schemas remain owned by the external scenario, allowing a registration
 * service, ordering service, or other domain to be swapped without AIRI code.
 */
export function createScenarioTools(manifest: ScenarioManifest): Tool[] {
  return manifest.tools.map(definition => rawTool({
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema,
    execute: async (input) => {
      if (!isRecord(input))
        throw new Error(`Scenario tool "${definition.name}" requires an object input.`)
      const bridge = scenarioRegistry.activeBridge.value
      if (!bridge)
        throw new Error('The active kiosk scenario is unavailable.')
      return await bridge.call(definition.name, input)
    },
  }))
}

/**
 * Creates the sole model-controlled kiosk navigation tool.
 *
 * Its enum is derived from the deployment allow-list, so a model cannot open a
 * URL, navigate a frame, or activate a page that has not been registered.
 */
export function createScenarioNavigationTools(scenarios: readonly RegisteredScenario[]): Tool[] {
  return [rawTool({
    name: 'kiosk_open_registered_scenario',
    description: '切換至已核准的 kiosk 互動頁面。僅在顧客需求符合該頁面用途時使用。',
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
      const manifest = await scenarioRegistry.activate(input.scenarioId)
      return { id: manifest?.id, title: manifest?.title }
    },
  })]
}

/** Describes the kiosk navigation constraint for the model's system prompt. */
export function createScenarioNavigationPrompt(scenarios: readonly RegisteredScenario[]) {
  const entries = scenarios.map(scenario => `- ${scenario.id}: ${scenario.description}`).join('\n')
  return `Kiosk 只能顯示下列已登錄互動頁面：\n${entries}\n\n僅在顧客明確需求符合頁面用途時，才可使用 kiosk_open_registered_scenario 切換。不得開啟、建議或嘗試任何未登錄網址；不得把使用者提供的網址當作可開啟頁面。點餐是主要流程，顧客要求點餐時請切回 restaurant-ordering。`
}
