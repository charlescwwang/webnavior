import { expect, it } from 'vitest'

import { createCustomerTarget } from './customerTarget'

const zone = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
const side = { centre: { x: 0.25, y: 0.4 }, bodyScale: 0.12, facesCamera: true }
const front = { centre: { x: 0.5, y: 0.4 }, bodyScale: 0.26, facesCamera: true }

// Report: this chat, 2026-11-17 — seated bystander retained the main ordering target.
it('switches to a sustained better customer and follows geometry when model order changes', () => {
  const target = createCustomerTarget()
  const original = target.observe(0, [side], zone)
  expect(original.index).toBe(0)
  for (let time = 100; time < 500; time += 100)
    expect(target.observe(time, [side, front], zone).index).toBe(0)
  const switched = target.observe(500, [side, front], zone)
  expect(switched.index).toBe(1)
  expect(switched.reason).toBe('switched')
  expect(switched.revision).toBeGreaterThan(original.revision)
  expect(target.observe(600, [front, side], zone).index).toBe(0)
  expect(target.observe(700, [side, front], zone).revision).toBe(switched.revision)
})

it('rejects outside-zone and ambiguous faces and revokes continuity after disappearance or stale video', () => {
  const target = createCustomerTarget()
  const first = target.observe(0, [front], zone)
  expect(target.observe(100, [front, front], zone).index).toBeUndefined()
  const reacquired = target.observe(200, [front], zone)
  expect(reacquired.revision).toBeGreaterThan(first.revision)
  expect(target.observe(300, [], zone).index).toBeUndefined()
  const next = target.observe(400, [front], zone)
  expect(next.revision).toBeGreaterThan(reacquired.revision)
  expect(target.observe(800, [front], zone).revision).toBeGreaterThan(next.revision)
  expect(target.observe(900, [{ ...front, centre: { x: 0.99, y: 0.4 } }], zone).index).toBeUndefined()
})

it('does not switch for brief passers and prefers the configured interaction position', () => {
  const target = createCustomerTarget()
  const original = target.observe(0, [side], zone)
  expect(target.observe(100, [front, side], zone).index).toBe(1)
  expect(target.observe(200, [side], zone).revision).toBe(original.revision)
  const interaction = { x: 0.1, y: 0.2, width: 0.25, height: 0.5 }
  expect(target.observe(300, [front, side], zone, interaction).index).toBe(1)
  target.reset()
  expect(target.observe(400, [front, side], zone, interaction).index).toBe(1)
})
