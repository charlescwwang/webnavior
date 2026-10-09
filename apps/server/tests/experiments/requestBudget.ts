/** One local dispatch reservation; token counts are generative input tokens only. */
export interface Reservation {
  at: number
  inputTokens: number
}

/** User-supplied quota with20% headroom for this isolated experiment. */
export const experimentLimits = { rpm: 24, tpm: 12_800, requestsPerRun: 11_520 } as const

/**
 * Returns admission delay for a rolling60-second local budget. Failed requests
 * retain their reservation; tokenizer calls consume RPM but no generative TPM.
 * This is not a project-global quota ledger: unrelated traffic remains unknown,
 * so the live caller must still stop on429. No state is cleared to bypass limits.
 */
export function admissionDelay(history: Reservation[], inputTokens: number, now: number, limits: { rpm: number, tpm: number, requestsPerRun: number } = experimentLimits): number {
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || inputTokens > limits.tpm)
    throw new Error('Request exceeds the token budget or has no reliable token count')
  if (history.length >= limits.requestsPerRun)
    throw new Error('Experiment request allowance exhausted')
  const recent = history.filter(item => item.at + 60_000 > now)
  let tokens = recent.reduce((sum, item) => sum + item.inputTokens, 0)
  let requests = recent.length
  if (requests + 1 <= limits.rpm && tokens + inputTokens <= limits.tpm)
    return 0
  // Reservations are append-only in dispatch order. Expire just enough oldest
  // entries to satisfy BOTH RPM and TPM, never release them on provider failure.
  for (const item of recent) {
    requests--
    tokens -= item.inputTokens
    if (requests + 1 <= limits.rpm && tokens + inputTokens <= limits.tpm)
      return item.at + 60_000 - now + 100
  }
  throw new Error('Cannot admit request under the configured limits')
}
