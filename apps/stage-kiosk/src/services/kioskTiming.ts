/** One utterance clock; phase timestamps overlap and must never be summed. */
export function createUtteranceTiming(utteranceId: number, capturedAt: number) {
  const started = performance.now()
  let revision = 0
  const seen = new Set<string>()
  const phases: { phase: string, atMs: number, detail?: string | number, channel?: 'progress' | 'reply' }[] = []
  const mark = (phase: string, detail?: string | number, channel?: 'progress' | 'reply') => {
    if (phases.length >= 100)
      return
    phases.push({ phase, atMs: performance.now() - started, ...(detail !== undefined ? { detail } : {}), ...(channel ? { channel } : {}) })
    seen.add(phase)
  }
  return {
    utteranceId,
    mark,
    /** First response remains the first event even across Jev/Main handoff. */
    markFirst(phase: string, detail?: string | number, channel?: 'progress' | 'reply') {
      if (!seen.has(phase))
        mark(phase, detail, channel)
    },
    snapshot(boundary: 'task' | 'speech', status: 'running' | 'completed' | 'cancelled' | 'failed') {
      // Repeated snapshots are revisions of this clock, never additional work.
      // Speech can finish/cancel independently from an already verified task.
      return { kind: 'utterance_timing', utteranceId, revision: ++revision, boundary, status, inputToAdmissionMs: Math.max(0, Date.now() - capturedAt - (performance.now() - started)), elapsedMs: performance.now() - started, phases: phases.map(phase => ({ ...phase })) }
    },
  }
}
