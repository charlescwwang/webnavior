import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { canStartKioskVoiceTurn, useKioskInteractionTurn } from './useKioskInteractionTurn'

describe('useKioskInteractionTurn', () => {
  it('accepts a customer interruption only while listening or speaking', () => {
    expect(canStartKioskVoiceTurn('listening')).toBe(true)
    expect(canStartKioskVoiceTurn('speaking')).toBe(true)

    expect(canStartKioskVoiceTurn('hearing-speech')).toBe(false)
    expect(canStartKioskVoiceTurn('transcribing')).toBe(false)
    expect(canStartKioskVoiceTurn('thinking')).toBe(false)
    expect(canStartKioskVoiceTurn('using-tool')).toBe(false)
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
})
