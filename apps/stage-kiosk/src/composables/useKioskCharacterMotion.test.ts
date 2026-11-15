import type { ToolExecution } from '@proj-airi/stage-shared/interactive-service'
import type { ServiceAvailability } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { KioskInteractionPhase } from './useKioskInteractionTurn'

import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useKioskCharacterMotion } from './useKioskCharacterMotion'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.useRealTimers()
})

function setup() {
  vi.useFakeTimers()
  const scope = effectScope()
  scopes.push(scope)
  const phase = shallowRef<KioskInteractionPhase>('listening')
  const busy = shallowRef(false)
  const availability = shallowRef<ServiceAvailability>('ready')
  const listeners = new Set<(event: ToolExecution) => void>()
  const motion = scope.run(() => useKioskCharacterMotion({
    animations: { idle: 'idle.vrma', listening: 'listen.vrma', thinking: 'think.vrma', greeting: 'greet.vrma', acknowledge: 'ack.vrma', presentRecommendations: 'present.vrma' },
    idleAnimation: undefined,
    phase,
    busy,
    client: {
      availability,
      onExecution: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }))!
  const event = (patch: Partial<ToolExecution> = {}): ToolExecution => ({
    tool: { name: 'browser_cart_add', origin: 'https://app.esgpb.com', inputSchema: { type: 'object' }, description: 'PB test' },
    input: {},
    connectionId: 'connection',
    documentId: 'document',
    operationId: 'operation',
    phase: 'called',
    ...patch,
  })
  const publish = (next: ToolExecution) => listeners.forEach(listener => listener(next))
  return { motion, phase, busy, availability, publish, event, listeners, scope }
}

it('resumes the current listening, processing and speech phase after a configured gesture', async () => {
  const { motion, phase, busy } = setup()
  expect(motion.animation.value).toBe('idle.vrma')
  phase.value = 'hearing-speech'
  expect(motion.animation.value).toBe('listen.vrma')
  phase.value = 'transcribing'
  expect(motion.animation.value).toBe('think.vrma')
  phase.value = 'speaking'
  expect(motion.animation.value).toBe('idle.vrma')
  motion.play('greeting')
  expect(motion.animation.value).toBe('greet.vrma')
  expect(motion.loop.value).toBe(false)
  busy.value = true
  await vi.advanceTimersByTimeAsync(1800)
  expect(motion.animation.value).toBe('think.vrma')
  expect(motion.loop.value).toBe(true)
})

// User request (2026-11-11): PB needs the master's character action integration.
it.each(['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'])('acknowledges only a correlated verified %s receipt', (name) => {
  const { motion, publish, event } = setup()
  const tool = { ...event().tool, name }
  publish(event({ tool }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event({ tool, phase: 'resolved', result: { ok: true, source: 'browser', status: 'verified' } }))
  expect(motion.animation.value).toBe('ack.vrma')
  expect(motion.loop.value).toBe(false)
})

it.each(['rejected', 'unknown', 'proposal_rejected'])('does not signal confirmation for a %s result', (status) => {
  const { motion, publish, event } = setup()
  publish(event())
  publish(event({ phase: 'resolved', result: { ok: status !== 'unknown', source: 'browser', status } }))
  expect(motion.animation.value).toBe('idle.vrma')
})

it('ignores internal reads, repeated receipts, wrong document ownership and retired connections', () => {
  const { motion, availability, publish, event } = setup()
  const verified = { ok: true, source: 'browser', status: 'verified' }
  publish(event())
  publish(event({ phase: 'resolved', result: { ...verified, repeated: true } }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event())
  publish(event({ phase: 'resolved', documentId: 'other', result: verified }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event())
  availability.value = 'loading'
  availability.value = 'ready'
  publish(event({ phase: 'resolved', result: verified }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event({ tool: { ...event().tool, name: 'browser_cart_review' } }))
  publish(event({ tool: { ...event().tool, name: 'browser_cart_review' }, phase: 'resolved', result: verified }))
  expect(motion.animation.value).toBe('idle.vrma')
})

it('presents only validated nonempty visual evidence and removes listeners and timers on disposal', () => {
  const { motion, publish, event, listeners, scope } = setup()
  const tool = { ...event().tool, name: 'browser_present' }
  publish(event({ tool }))
  publish(event({ tool, phase: 'resolved', result: { ok: true, source: 'browser', products: [{ ref: 'p', name: '便當' }] } }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event({ tool }))
  publish(event({ tool, phase: 'resolved', result: { ok: true, source: 'browser', presentation: { products: [{ ref: 'p', name: '便當' }], cue: 'target-unavailable' } } }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event({ tool }))
  publish(event({ tool, phase: 'resolved', result: { ok: true, source: 'browser', presentation: { products: [], cue: 'cleared' } } }))
  expect(motion.animation.value).toBe('idle.vrma')
  publish(event({ tool }))
  publish(event({ tool, phase: 'resolved', result: { ok: true, source: 'browser', presentation: { products: [{ ref: 'p', name: '便當' }], cue: 'shown' } } }))
  expect(motion.animation.value).toBe('present.vrma')
  expect(listeners.size).toBe(1)
  scope.stop()
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
