import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useKioskInteractionTurn } from './useKioskInteractionTurn'

describe('useKioskInteractionTurn', () => {
  it('cancels a welcome for touch activity without cancelling customer work', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const welcome = interaction.begin('proactive', 'speaking')
    interaction.cancelProactive()
    expect(welcome.signal.aborted).toBe(true)
    expect(interaction.phase.value).toBe('listening')

    const customer = interaction.begin('conversation', 'using-tool')
    interaction.cancelProactive()
    expect(customer.signal.aborted).toBe(false)
    expect(interaction.isCurrent(customer)).toBe(true)
    expect(interaction.phase.value).toBe('using-tool')
    scope.stop()
  })

  it('supersedes an earlier turn so its response cannot update the current interaction', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const firstTurn = interaction.begin('conversation', 'thinking')
    const secondTurn = interaction.begin('voice', 'hearing-speech')

    expect(firstTurn.signal.aborted).toBe(true)
    expect(interaction.isCurrent(firstTurn)).toBe(false)
    expect(interaction.phase.value).toBe('hearing-speech')
    expect(interaction.isCurrent(secondTurn)).toBe(true)
    scope.stop()
  })

  it('lets a customer voice turn supersede spoken output immediately', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const spokenTurn = interaction.begin('conversation', 'speaking')

    const voiceTurn = interaction.begin('voice', 'hearing-speech')
    expect(spokenTurn.signal.aborted).toBe(true)
    expect(interaction.isCurrent(voiceTurn)).toBe(true)
    expect(interaction.phase.value).toBe('hearing-speech')
    scope.stop()
  })

  it('does not let unverified speech interrupt proactive or customer analysis', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const proactiveTurn = interaction.begin('proactive', 'thinking')
    const candidate = interaction.beginCustomerVoiceCandidate()
    expect(proactiveTurn.signal.aborted).toBe(false)
    expect(interaction.isCurrentVoiceCandidate(candidate)).toBe(true)

    const conversation = interaction.begin('conversation', 'thinking')
    expect(interaction.isCurrentVoiceCandidate(candidate)).toBe(true)
    expect(interaction.isCurrent(conversation)).toBe(true)
    expect(interaction.phase.value).toBe('thinking')
    scope.stop()
  })

  it('allows proactive interaction only when no customer turn is active', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    expect(interaction.canProactivelySpeak.value).toBe(true)

    const turn = interaction.begin('voice', 'transcribing')
    expect(interaction.canProactivelySpeak.value).toBe(false)

    interaction.complete(turn)
    expect(interaction.phase.value).toBe('listening')
    expect(interaction.canProactivelySpeak.value).toBe(true)
    scope.stop()
  })

  it('keeps a candidate separate from customer work while the model is thinking or using a tool', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const activeTurn = interaction.begin('conversation', 'thinking')
    const candidate = interaction.beginCustomerVoiceCandidate()
    expect(candidate).toBeDefined()
    expect(interaction.isCurrent(activeTurn)).toBe(true)
    expect(interaction.isCurrentVoiceCandidate(candidate!)).toBe(true)

    interaction.advance(activeTurn, 'using-tool')
    const toolCandidate = interaction.beginCustomerVoiceCandidate()
    expect(toolCandidate).toBeDefined()
    expect(candidate!.signal.aborted).toBe(false)
    expect(interaction.isCurrentVoiceCandidate(candidate!)).toBe(true)
    expect(interaction.isCurrent(activeTurn)).toBe(true)
    expect(interaction.isCurrentVoiceCandidate(toolCandidate!)).toBe(true)

    interaction.begin('voice', 'hearing-speech')
    expect(toolCandidate!.signal.aborted).toBe(false)
    expect(interaction.isCurrentVoiceCandidate(toolCandidate!)).toBe(true)
    interaction.cancel()
    expect(toolCandidate!.signal.aborted).toBe(true)
    scope.stop()
  })

  it('captures a second finished utterance while the first is still transcribing', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const first = interaction.begin('voice', 'transcribing')
    const second = interaction.beginCustomerVoiceCandidate()
    expect(second).toBeDefined()
    expect(interaction.isCurrent(first)).toBe(true)
    expect(interaction.isCurrentVoiceCandidate(second!)).toBe(true)
    scope.stop()
  })

  it('captures speech independently of an active ordering turn', () => {
    const scope = effectScope()
    const interaction = scope.run(() => useKioskInteractionTurn())
    if (!interaction)
      throw new Error('Expected kiosk interaction turn to initialize.')

    const first = interaction.beginCustomerVoiceCandidate()
    expect(first).toBeDefined()
    expect(interaction.phase.value).toBe('listening')
    const second = interaction.beginCustomerVoiceCandidate()
    expect(second).toBeDefined()
    expect(interaction.isCurrentVoiceCandidate(first!)).toBe(true)
    expect(interaction.isCurrentVoiceCandidate(second!)).toBe(true)
    scope.stop()
  })
})
