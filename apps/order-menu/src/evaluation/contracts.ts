import type { CartSnapshot, FulfillmentMode, MenuItem } from '../domain/order-machine'
import type { MenuToolName } from '../toolDefinitions'

/** Test-only provenance; raw source files are never runtime dependencies. */
export interface EvidenceSource {
  file: string
  sha256: string
  timezone: 'UTC'
  selection: string
  redactions: string[]
}

/** Persisted projections may omit an unset fulfillment choice. */
export type RecordedCart = Omit<CartSnapshot, 'fulfillmentMode'> & Partial<Pick<CartSnapshot, 'fulfillmentMode'>>

interface EventPosition { sequence: number, at: string, sourceRowHash: string }

/** Original excerpt fields only; synthetic controls live in separate tests. */
export type RecordedEvent = EventPosition & (
  | { kind: 'user_text' | 'asr_transcript' | 'assistant_text', text: string }
  | { kind: 'tool_call', tool: MenuToolName, input: Record<string, unknown> }
  | { kind: 'tool_result', tool: MenuToolName, cart?: RecordedCart, itemIds?: string[], presentedItemIds?: string[], dataOnly?: boolean, queries?: string[], message?: string, question?: { purpose: string, text: string } }
)

/** Missing evidence cannot be accidentally counted as a replay success. */
export type HistoricalCase = {
  id: string
  reference: string
  gaps: string[]
  linkedTests: string[]
} & (
  | { status: 'partial' | 'complete', source: EvidenceSource, events: RecordedEvent[] }
  | { status: 'missing-evidence' }
)

/** Minimal checked-in evidence manifest, independently of private capture storage. */
export interface HistoryData {
  version: number
  catalogSource: Pick<EvidenceSource, 'file' | 'sha256'> & { sequence: number, projection: string }
  catalog: MenuItem[]
  quantityItem: MenuItem
  cases: HistoricalCase[]
}

/** Oracle predicates describe final authoritative facts, never model-supplied completion. */
export type Demand
  = | { id: string, kind: 'line', itemId: string, quantity: number, options?: Record<string, string> }
    | { id: string, kind: 'fulfillment', mode: FulfillmentMode }
    | { id: string, kind: 'presentation', itemIds: string[] }

/** A snapshot belongs to this case/turn; missing facts are unknown, not empty. */
export interface Observation {
  /** Enables checking that unrelated cart entries and fulfillment stayed unchanged. */
  beforeCart?: CartSnapshot
  cart?: CartSnapshot
  presentedItemIds?: string[]
  /** Set by the runner/human annotation, never by parsing arbitrary model JSON. */
  claimedComplete?: boolean
}
