/** Finite menu navigation; it changes the viewport, never selection or cart. */
export type ScrollDirection = 'UP' | 'DOWN'
export interface ScrollResult { status: 'MOVED' | 'BOUNDARY' | 'UNAVAILABLE', position: number }

/** Scrolls one visible page on the actual scroll owner and reports measured movement. */
export function scrollViewport(owner: Element | null, direction: ScrollDirection): ScrollResult {
  if (!owner)
    return { status: 'UNAVAILABLE', position: 0 }
  const before = owner.scrollTop
  if (!owner.isConnected || owner.clientHeight <= 0)
    return { status: 'UNAVAILABLE', position: before }
  const maximum = Math.max(0, owner.scrollHeight - owner.clientHeight)
  const destination = Math.min(maximum, Math.max(0, before + (direction === 'DOWN' ? owner.clientHeight : -owner.clientHeight)))
  // scrollTop may be fractional; height measurements are rounded by the browser.
  if (Math.abs(destination - before) <= 1)
    return { status: 'BOUNDARY', position: before }
  // Instant navigation is synchronous and measurable. A timer or uncorrelated
  // scrollend from another gesture must not certify this operation as completed.
  owner.scrollTo({ top: destination, behavior: 'instant' })
  const position = owner.scrollTop
  return { status: Math.abs(position - destination) <= 1 ? 'MOVED' : 'UNAVAILABLE', position }
}
