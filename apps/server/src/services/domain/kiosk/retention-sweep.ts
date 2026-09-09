import type { KioskService } from '.'

/** Options for the periodic visitor-record retention sweep. */
export interface KioskRetentionSweepOptions {
  /** Reports a failed sweep without allowing an unhandled rejection to stop later runs. */
  onError?: (error: unknown) => void
  /** @default `() => new Date()` */
  now?: () => Date
  /** @default 6 hours */
  intervalMs?: number
}

/**
 * Starts the server-owned sweep that removes completed visitor sessions after
 * their captured expiry. Active sessions deliberately survive even when their
 * retention deadline has passed, because their transcript remains necessary
 * to complete the current customer interaction.
 */
export function startKioskRetentionSweep(
  kioskService: Pick<KioskService, 'purgeExpiredVisitorSessions'>,
  options: KioskRetentionSweepOptions = {},
) {
  const now = options.now ?? (() => new Date())
  const intervalMs = options.intervalMs ?? 6 * 60 * 60 * 1000

  async function sweep() {
    try {
      await kioskService.purgeExpiredVisitorSessions(now())
    }
    catch (error) {
      options.onError?.(error)
    }
  }

  void sweep()
  const timer = setInterval(() => void sweep(), intervalMs)
  timer.unref()

  return {
    dispose: () => clearInterval(timer),
  }
}
