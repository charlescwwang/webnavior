import { describe, expect, it } from 'vitest'

import { webMcpHealthTool } from './webmcp'

describe('webMCP compatibility protocol', () => {
  it('echoes the challenge with its protocol version', async () => {
    await expect(webMcpHealthTool.execute({ challenge: 'activation:1' })).resolves.toEqual({ version: 1, challenge: 'activation:1' })
  })

  it('rejects an altered input shape', async () => {
    await expect(webMcpHealthTool.execute({ challenge: 1 })).rejects.toThrow()
  })
})
