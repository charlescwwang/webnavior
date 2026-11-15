import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { browserRecommendationLimit } from '@proj-airi/stage-shared/product-presentation'

type Workflow = 'table' | 'browse' | 'order' | 'cart' | 'checkout'

// Fixed local release assets only. Load once when this domain starts; missing
// assets fail startup rather than silently reverting to a different prompt.
const workflows: readonly Workflow[] = ['table', 'browse', 'order', 'cart', 'checkout']
const common = readFileSync(new URL('./skills/common/SKILL.md', import.meta.url), 'utf8').trim()
const assets = new Map(workflows.map((workflow) => {
  const instructions = `${common}\n\n${readFileSync(new URL(`./skills/${workflow}/SKILL.md`, import.meta.url), 'utf8').trim()}`.replaceAll('{{recommendationLimit}}', String(browserRecommendationLimit))
  const version = `2026-11-12.${createHash('sha256').update(instructions).digest('hex').slice(0, 12)}`
  return [workflow, { workflow, version, instructions }] as const
}))

/** Chooses one workflow from Host facts, without a model call or vendor-provided instructions. */
export function orderingInstructions(context?: BrowserConversation) {
  let workflow: Workflow = 'browse'
  if (context?.page === 'table')
    workflow = 'table'
  else if (context && ['choosing_product', 'collecting_quantity', 'configuring', 'confirming_add', 'ready_to_add'].includes(context.phase))
    workflow = 'order'
  else if (context?.page === 'checkout' || (context?.page === 'cart' && context.checkout))
    workflow = 'checkout'
  else if (context?.page === 'cart')
    workflow = 'cart'
  else if (context && !context.readOnly)
    workflow = 'order'
  return assets.get(workflow)!
}
