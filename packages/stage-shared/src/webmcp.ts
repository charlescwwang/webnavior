import { literal, parse, strictObject, string } from 'valibot'

const challengeSchema = strictObject({ challenge: string() })

/** The host verifies both the protocol version and its own discovery challenge. */
export const webMcpHealthResultSchema = strictObject({ version: literal(1), challenge: string() })

/**
 * Side-effect-free native transport probe shared by interactive services and hosts.
 * Register with the same origin allowlist and lifetime as the service's tools.
 * This tool must never read domain state, publish UI events, or contact a server.
 */
export const webMcpHealthTool = {
  name: 'webmcp_health_check',
  description: 'Host-only WebMCP compatibility check. Echoes a challenge without reading or changing application state.',
  inputSchema: {
    type: 'object',
    properties: { challenge: { type: 'string' } },
    required: ['challenge'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: async (input: Record<string, unknown>) => {
    const { challenge } = parse(challengeSchema, input)
    return { version: 1, challenge }
  },
}
