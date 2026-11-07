import { expect, it } from 'vitest'

import { createUtteranceTiming } from './kioskTiming'

// Report: this chat, Nov1: interim speech was recorded as final first audio,
// and partial snapshots were indistinguishable from a completed task.
it('separates progress audio from final reply and versions cumulative snapshots', () => {
  const clock = createUtteranceTiming(7, Date.now())
  clock.mark('first-audio', undefined, 'progress')
  const partial = clock.snapshot('speech', 'running')
  clock.mark('reply-text-visible', undefined, 'reply')
  clock.mark('first-audio', undefined, 'reply')
  const completed = clock.snapshot('task', 'completed')
  expect(partial.status).toBe('running')
  expect(partial.phases).toHaveLength(1)
  expect(completed.revision).toBeGreaterThan(partial.revision)
  expect(completed.boundary).toBe('task')
  expect(completed.phases.filter(event => event.phase === 'first-audio' && event.channel === 'reply')).toHaveLength(1)
  expect(completed.phases.filter(event => event.phase === 'first-audio' && event.channel === 'progress')).toHaveLength(1)
  expect(partial.phases).toHaveLength(1)
})

it('keeps the earliest visible/audio response across progress and the final reply', () => {
  const clock = createUtteranceTiming(8, Date.now())
  clock.markFirst('service-admitted')
  clock.markFirst('first-response-audio', undefined, 'progress')
  clock.markFirst('first-response-audio', undefined, 'reply')
  clock.markFirst('service-admitted')
  const phases = clock.snapshot('task', 'completed').phases
  expect(phases.filter(event => event.phase === 'service-admitted')).toHaveLength(1)
  expect(phases.filter(event => event.phase === 'first-response-audio')).toEqual([
    expect.objectContaining({ channel: 'progress' }),
  ])
})
