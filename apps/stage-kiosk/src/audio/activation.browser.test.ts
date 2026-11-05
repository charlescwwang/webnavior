import { resumeAudioContext } from '@proj-airi/stage-ui/libs/audio/activation'
import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

// Report: this chat, 2026-11-05 — Firefox can leave resume pending before interaction.
it('resumes a borrowed context and leaves it open for its audio owner', async () => {
  const context = new AudioContext()
  const button = document.createElement('button')
  button.textContent = 'Activate audio'
  button.onclick = () => {
    void context.resume()
  }
  document.body.append(button)
  try {
    const pending = resumeAudioContext(context, new AbortController().signal)
    await userEvent.click(button)
    await pending
    expect(context.state).toBe('running')
    await resumeAudioContext(context, new AbortController().signal)
    expect(context.state).toBe('running')
  }
  finally {
    button.remove()
    await context.close()
  }
})

it('rejects an already retired owner without closing its borrowed context', async () => {
  const context = new AudioContext()
  const owner = new AbortController()
  owner.abort(new Error('Retired input'))
  try {
    expect(() => resumeAudioContext(context, owner.signal)).toThrow('Retired input')
    expect(context.state).not.toBe('closed')
  }
  finally {
    await context.close()
  }
})

it('rejects a closed context instead of leaving startup pending', async () => {
  const context = new AudioContext()
  await context.close()
  await expect(resumeAudioContext(context, new AbortController().signal)).rejects.toThrow('Audio context is closed.')
})
