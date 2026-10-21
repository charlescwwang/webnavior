import type { Plugin } from 'vite'

import standaloneCode from 'ajv/dist/standalone/index.js'

import { Ajv } from 'ajv'
import { build } from 'vite'

import { toolDefinitions } from './src/toolDefinitions'

/** Compile the owned tool contracts during Vite/Vitest loading, never with browser eval. */
export function toolValidationPlugin(): Plugin {
  const moduleId = 'virtual:menu-tool-validators'
  let compiled: Promise<string> | undefined
  return {
    name: 'order-menu-tool-validation',
    resolveId(id) {
      if (id === moduleId)
        return `\0${moduleId}`
    },
    async load(id) {
      if (id !== `\0${moduleId}`)
        return
      return compiled ??= compile()
    },
  }

  async function compile() {
    const ajv = new Ajv({ $data: true, code: { source: true, esm: true }, strict: true })
    const names: Record<string, string> = {}
    for (const tool of toolDefinitions) {
      const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
      const schemaId = `urn:airi:menu-tool:${tool.name}`
      // Capability enums are supplied by the current runtime descriptor. The compiled
      // validator stays static while POS categories/payment/fulfillment choices change.
      ajv.addSchema({
        type: 'object',
        properties: {
          input: { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { ...value, enum: { $data: `/enums/${key}` } }])) },
          enums: { type: 'object' },
        },
        required: ['input', 'enums'],
        additionalProperties: false,
      }, schemaId)
      names[tool.name] = schemaId
    }
    let code = standaloneCode(ajv, names)
    // NOTICE: Ajv 8.18 standalone ESM still emits CommonJS requires for runtime
    // helpers (`ajv/dist/runtime/equal.js:5`, `ajv/dist/runtime/ucs2length.js:23`).
    // Convert only those static helper imports for Vite before bundling them.
    code = code.replace(/const (\w+) = require\("(ajv\/dist\/runtime\/[^" ]+)"\)\.default;/g, 'import $1 from "$2.js";')
    code += `\nexport default { ${Object.keys(names).join(', ')} };`
    // Bundle Ajv's CommonJS helpers once on the build side. The browser receives
    // one ESM module with no runtime compiler, eval or CommonJS interop boundary.
    const result = await build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      build: { write: false, minify: false, lib: { entry: moduleId, formats: ['es'] } },
      plugins: [{
        name: 'compiled-menu-validators',
        resolveId(id) {
          if (id === moduleId || id.endsWith(`/${moduleId}`))
            return `\0${moduleId}`
          if (id.startsWith('ajv/dist/runtime/'))
            return this.resolve(id, import.meta.filename, { skipSelf: true })
        },
        load: id => id === `\0${moduleId}` ? code : undefined,
      }],
    })
    const output = Array.isArray(result) ? result[0] : result
    if (!('output' in output))
      throw new Error('Expected the compiled Menu validator module.')
    const chunk = output.output.find(entry => entry.type === 'chunk')
    if (!chunk)
      throw new Error('Menu validator compilation produced no module.')
    return chunk.code
  }
}
