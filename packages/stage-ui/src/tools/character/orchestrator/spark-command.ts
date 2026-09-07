import type { WebSocketEvents } from '@proj-airi/server-sdk'

import { rawTool } from '@xsai/tool'
import { nanoid } from 'nanoid'
import { toJsonSchema } from 'xsschema'
import { z } from 'zod/v4'

import { normalizeNullableAnyOf } from '../../json-schema'
import {
  normalizeSparkCommandDestinations,
  normalizeSparkCommandGuidanceOptions,
  normalizeSparkCommandMetadata,
  normalizeSparkCommandPersona,
  normalizeSparkCommandStringList,
  normalizeSparkCommandStringValue,
  sparkCommandContextSchema,
  sparkCommandGuidanceSchema,
  sparkCommandToolSchema,
} from './spark-command-shared'

export interface CreateSparkCommandToolOptions {
  sendSparkCommand: (command: WebSocketEvents['spark:command']) => void
}

export async function createSparkCommandTool(options: CreateSparkCommandToolOptions) {
  // NOTICE: We intentionally bypass `tool(...)` here so we can normalize the generated
  // JSON Schema before `strictJsonSchema(...)` finalizes it. This is required for providers
  // like Azure that reject some `anyOf` nullable forms and strict-object optional-field shapes.
  const parameters = normalizeNullableAnyOf(await toJsonSchema(sparkCommandToolSchema) as any)

  return [
    rawTool({
      name: 'builtIn_emitSparkCommand',
      description: 'Send a spark:command to one or more frontend-connected modules or sub-agents.',
      parameters,
      execute: async (rawPayload) => {
        const payload = rawPayload as z.infer<typeof sparkCommandToolSchema>
        // Provider tool schemas guide generation but do not guarantee runtime output.
        // Drop malformed optional branches so one bad guidance field cannot prevent
        // the valid command routing fields from reaching the destination.
        const guidanceResult = sparkCommandGuidanceSchema.safeParse(payload.guidance)
        const contextsResult = z.array(sparkCommandContextSchema).safeParse(payload.contexts)
        const command = {
          id: nanoid(),
          eventId: nanoid(),
          parentEventId: payload.parentEventId ?? undefined,
          commandId: nanoid(),
          interrupt: payload.interrupt ?? false,
          priority: payload.priority ?? 'normal',
          intent: payload.intent ?? 'action',
          ack: payload.ack ?? undefined,
          guidance: guidanceResult.success
            ? {
                type: guidanceResult.data.type,
                persona: normalizeSparkCommandPersona(guidanceResult.data.persona ?? undefined),
                options: normalizeSparkCommandGuidanceOptions(guidanceResult.data.options),
              }
            : undefined,
          contexts: contextsResult.success
            ? contextsResult.data.map(context => ({
                id: nanoid(),
                contextId: nanoid(),
                lane: normalizeSparkCommandStringValue(context.lane),
                ideas: normalizeSparkCommandStringList(context.ideas),
                hints: normalizeSparkCommandStringList(context.hints),
                strategy: context.strategy,
                text: context.text,
                destinations: normalizeSparkCommandDestinations(context.destinations),
                metadata: normalizeSparkCommandMetadata(context.metadata ?? undefined),
              }))
            : undefined,
          destinations: payload.destinations,
        } satisfies WebSocketEvents['spark:command']

        options.sendSparkCommand(command)

        // `destinations` may be undefined: the channel sender (stores/llm.ts sendSparkCommand) deletes
        // it to trigger broadcast-to-all-authenticated-peers. Guard the .join so we don't surface
        // "Cannot read properties of undefined (reading 'join')" back to the LLM after a successful send.
        const dests = Array.isArray(command.destinations) && command.destinations.length > 0
          ? command.destinations.join(', ')
          : 'all authenticated peers (broadcast)'
        return `spark:command sent (${command.commandId}) to ${dests}`
      },
    }),
  ]
}
