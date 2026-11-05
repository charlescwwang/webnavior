import type { CartLine } from '../domain/order-machine'
import type { Demand, HistoricalCase, Observation } from './contracts'

/**
 * Compares each demand to current authoritative facts. A line quantity is the
 * expected final quantity after applying the request to its recorded pre-state.
 * This evaluator observes effects; it does not infer consent or grant execution.
 */
export function evaluateDemands(demands: readonly Demand[], observation: Observation) {
  if (!demands.length || new Set(demands.map(demand => demand.id)).size !== demands.length)
    throw new Error('A demand evaluation requires unique, nonempty oracle IDs.')
  const results = demands.map((demand) => {
    let status: 'satisfied' | 'mismatched' | 'unknown'
    if (demand.kind === 'presentation') {
      const actual = observation.presentedItemIds
      status = actual === undefined ? 'unknown' : sameIds(actual, demand.itemIds) ? 'satisfied' : 'mismatched'
    }
    else if (!observation.cart) {
      status = 'unknown'
    }
    else if (demand.kind === 'fulfillment') {
      status = observation.cart.fulfillmentMode === demand.mode ? 'satisfied' : 'mismatched'
    }
    else {
      // Different option combinations are separate demands. Omitting options in
      // gold asserts the total across this item, not an arbitrary matching line.
      const lines = observation.cart.lines.filter(line => line.itemId === demand.itemId && (demand.options === undefined || sameOptions(line.options, demand.options)))
      const quantity = lines.reduce((total, line) => total + line.quantity, 0)
      status = quantity === demand.quantity ? 'satisfied' : 'mismatched'
    }
    return { id: demand.id, status }
  })
  const unexpectedChanges: string[] = []
  if (observation.beforeCart && observation.cart) {
    const before = quantities(observation.beforeCart.lines)
    const after = quantities(observation.cart.lines)
    // Item+sorted option pairs identify a configuration independently of private
    // line IDs. Multiple same-configuration lines still count toward its quantity.
    const lines = [...observation.beforeCart.lines, ...observation.cart.lines]
    for (const line of lines) {
      const key = configurationKey(line)
      const covered = demands.some(demand => demand.kind === 'line' && demand.itemId === line.itemId && (demand.options === undefined || sameOptions(line.options, demand.options)))
      if (!covered && before.get(key) !== after.get(key) && !unexpectedChanges.includes(key))
        unexpectedChanges.push(key)
    }
    if (!demands.some(demand => demand.kind === 'fulfillment') && observation.beforeCart.fulfillmentMode !== observation.cart.fulfillmentMode)
      unexpectedChanges.push('fulfillment')
  }
  const allSatisfied = results.every(result => result.status === 'satisfied') && unexpectedChanges.length === 0
  return { results, unexpectedChanges, allSatisfied, falseCompletion: observation.claimedComplete === true && !allSatisfied }
}

/** Reports evidence coverage separately; unavailable originals are not passing tests. */
export function summarizeCoverage(cases: readonly HistoricalCase[]) {
  return {
    complete: cases.filter(value => value.status === 'complete').map(value => value.id),
    partial: cases.filter(value => value.status === 'partial').map(value => value.id),
    missingEvidence: cases.filter(value => value.status === 'missing-evidence').map(value => value.id),
  }
}

function sameIds(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && new Set(actual).size === actual.length && new Set(expected).size === expected.length && expected.every(id => actual.includes(id))
}

function sameOptions(actual: Record<string, string>, expected: Record<string, string>) {
  return Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => actual[key] === value)
}

function quantities(lines: NonNullable<Observation['cart']>['lines']) {
  const result = new Map<string, number>()
  for (const line of lines) {
    const key = configurationKey(line)
    result.set(key, (result.get(key) ?? 0) + line.quantity)
  }
  return result
}

// Tuple encoding avoids delimiter collisions; sorting makes option key insertion
// order irrelevant while preserving the actual option values and item identity.
function configurationKey(line: Pick<CartLine, 'itemId' | 'options'>) {
  return JSON.stringify([line.itemId, Object.entries(line.options).sort(([left], [right]) => left.localeCompare(right))])
}
