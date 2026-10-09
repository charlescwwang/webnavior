---
title: Order Menu viewport scrolling options
date: 2026-10-02
category: research
module: Order Menu
problem_type: research
tags:
  - scrolling
  - browser
  - vueuse
---

# Order Menu viewport scrolling options

The user authorized the recommended native option. Scope is one
viewport-sized UP/DOWN operation during ordering, with an outcome that distinguishes
actual movement, an existing boundary, and an unconfirmed completion. This note is
separate from the neutral external description in
[`2026-10-02-jev-decision-review.md`](2026-10-02-jev-decision-review.md).

## Existing internal behavior

[`App.vue`](../../apps/order-menu/src/App.vue) lines 178–212 already use native
scrolling to reveal an Agent action target: `scrollIntoView` centers that element,
then waits for a window `scrollend` or 420 ms. It returns no movement/boundary result.
The listener is attached after scrolling starts. This is reusable browser integration
context, but its target-centering behavior and time-based fallback do not establish
the requested viewport-step contract.

[`styles.css`](../../apps/order-menu/src/styles.css) gives `.menu-app` a minimum
viewport height without a fixed-height vertical scrolling container. Document
scrolling is therefore the likely owner of ordinary menu movement; the small-screen
category strip has its own horizontal overflow. This is a source-based inference,
not a live-browser measurement. MDN identifies `document.scrollingElement` as the
element that scrolls the document, normally its root element in standards mode.
[MDN scrollingElement](https://developer.mozilla.org/en-US/docs/Web/API/Document/scrollingElement)

[`package.json`](../../apps/order-menu/package.json) currently declares Vue and
`@moeru/std`, not `@vueuse/core`. Existing Order Menu source contains no `useScroll`
integration. Adding VueUse here would require an explicit package dependency even
though other workspace surfaces already use VueUse.

## Official API findings

Native `Element.scrollBy({ top, behavior })` expresses a relative vertical distance;
`smooth` animates it, `instant` applies it immediately, and `auto` follows CSS
scroll behavior. The current MDN page describes a Promise resolving to
`{ interrupted }`, while explicitly acknowledging browsers without promise-returning
scroll operations. Consequently, `await scrollBy(...)` alone is not evidence of
completion across an unspecified deployed browser fleet. Compatibility for that
return value must be checked independently from availability of scrolling itself.
[MDN scrollBy](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollBy)

`scrollend` means pending scroll updates and the user's gesture have completed.
It does not fire if the position never changes. Element scroll completion and
document scroll completion have different documented event surfaces. Thus a boundary
no-op cannot depend on receiving an event, and a listener must belong to the actual
scroll owner. MDN marks the event as available across current browsers since
December 2025, with older-browser limitations.
[MDN scrollend](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event)

`scrollHeight` measures total content height, while `clientHeight` measures visible
height. MDN demonstrates a one-pixel tolerance when comparing bottom position
because `scrollTop` can be fractional while the height values are rounded.
[MDN scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight)

VueUse `useScroll` exposes writable `x`/`y`, `isScrolling`, `arrivedState`, and
directions. Setting `y` scrolls to an absolute position; a relative one-step action
still needs its starting position and viewport distance. `measure()` refreshes
position and boundary state after dynamic content changes; documentation recommends
calling it after `nextTick`. It supports smooth behavior, offsets, and an `onStop`
callback. Its default idle check is 200 ms.
[VueUse useScroll](https://vueuse.org/core/usescroll/)

The current upstream implementation handles both native `scrollend` and a debounced
idle detector. Its `onStop` is not a per-request Promise, and it suppresses duplicate
stop callbacks using `isScrolling`. Boundary calculations include a one-pixel
threshold and special handling for reversed layouts. These are useful lifecycle
and geometry policies; neither the callback nor boundary state identifies which
Agent operation caused movement. Upstream `main` is not proof of behavior in a
particular installed version.
[VueUse source](https://github.com/vueuse/vueuse/blob/main/packages/core/useScroll/index.ts)

## Candidate comparison

| Candidate | Viable reuse | Limitation for this requirement |
| --- | --- | --- |
| Native scrolling | Existing App.vue browser integration; relative `scrollBy`; actual scroll-owner measurements | Application must own phase gating, boundary outcome, completion/cancellation and overlapping requests. Existing 420 ms wait cannot certify completion. |
| VueUse `useScroll` | Reactive position/boundary state, dynamic remeasurement, scoped event lifecycle and stop detection | New direct dependency in Order Menu; relative step and ordering authorization remain application policy. Stop detection is shared state rather than a correlated operation receipt. |

The requested contract needs an explicit one-step distance, measured in the Order
Menu viewport rather than the embedding host's viewport. For ordinary downward
document flow, a candidate interpretation is `±clientHeight`, limited by remaining
space. A partial final step can move and arrive at a boundary; that differs from
an operation which began at the boundary and moved zero pixels. Completion timeout,
interruption or phase change cannot truthfully be reported as completed movement
solely because the requested target was calculated. These are contract deductions
from the API semantics above, not implemented behavior.

Ordering-only eligibility belongs to the existing semantic/runtime phase boundary,
not either scrolling API. Checkout, seating, dialogs and review must have explicit
eligibility decisions before execution; an in-flight transition also requires
defined cancellation/result semantics. No such policy is selected in this note.

## Validation boundary

The existing Order Menu Vitest configuration runs ordinary `src/**/*.test.ts` and
does not configure browser mode. The repository already has a real Chromium/Vitest
browser configuration at
[`apps/stage-kiosk/vitest.browser.config.ts`](../../apps/stage-kiosk/vitest.browser.config.ts).
Browser acceptance should observe real positions, boundaries and events in the
actual scrolling document, including the embedded viewport. Replacing `scrollBy`,
layout measurements or `scrollend` with browser-platform mocks would not establish
these behaviors. Pure phase/outcome decisions can be tested independently without
claiming browser completion. No tests or typechecks were run for this documentation
research; no production files or dependencies were changed.
