# Kiosk and table service modes

## Accepted scope

Keep the existing paid Kiosk flow. Add table service through the same Menu/Cart,
ASR/Jev/Main and tools. User chose random a01–a09 per order round for this test
environment, not a verified physical table. Device settings centrally select
kiosk/table-service and independent off/observe/enforce background policy (off
by default). Pin the order round's mode/table until explicit new session; do not
apply refreshed configuration to a nonempty cart or pending/uncertain submission.

## Existing boundaries and compatibility

- Paid Bridge /v1/orders requires an authorized payment and preserves its guard.
- Existing table scan is a test continuation; do not treat it as real table identity.
- Add an explicit unpaid table-order contract and capability. Local simulator may
  implement it; unknown external POS adapters must refuse rather than fake success.
- Use the existing authenticated identity/device settings and POS proxy allowlist.
- Keep Kiosk confirmation, invoice, payment, pickup and receipt behavior.
- Table completion has table, meals/quantities/amounts/total and no pickup number.
- Mode/context changes take effect on new-session reset, not live cart replacement.
- ASR display is provisional and keyed by utterance; Jev-complete accepted text is
  committed before tools/Agent completion, exactly once. Incomplete/ignored text
  is never promoted to durable conversational history.
- off skips background classification; observe records it without using it to
  reject speech; enforce may reject. All operation authorization remains required.

## Minimal implementation boundaries

Central policy/types in stage-shared, settings in existing device settings/editor;
per-device authenticated ordering context and unpaid submission in POS Bridge;
existing checkout_start becomes explicit confirmation/submit only in table mode.
No new provider, robot integration, package dependency or parallel order engine.

## Validation

Keep existing Kiosk payment tests. Add mode/default and invalid-mode tests,
auth/context ownership, mode latch, random table stability, unsupported adapter,
no payment invocation, stale catalog/price rejection, concurrency/retry and
uncertain-result lock; Menu voice/touch confirmation and completion visibility;
background three modes and ASR commit ordering/deduplication. Use isolated mocks
and browser tests. No real POS/payment or provider calls without new authorization.

## Implementation and acceptance

Implemented and validated; code committed in batches. Deployment package prepared, awaiting the local administrator switch. Central settings, pinned
rounds, explicit unpaid capability, table completion, independent background
policy and provisional/early-committed ASR use the existing architecture.
Host reset renews the server round before closing its old session/reloading;
refusal leaves the current customer state in place.

Acceptance archive: `/home/aimax/.local/share/webnavior/acceptance/service-modes-20261105-1840`. Six live synthetic model cases passed,125 calls;
two earlier failures are retained with fixes and reruns. Menu902 passed/202
skipped, Bridge58, routes83 plus table archive retest, routing42, settings9/2,
Host76+reset21, shared12 and browser20. Five scoped types, ESLint and both web
builds passed; no full-project typecheck. External unpaid POS is unsupported
until an adapter explicitly implements it; random tables/context receipts remain
process-local test behavior. Physical hardware, real payment/POS and a top-level
standalone-browser reset were not part of this acceptance.

Prepared release: `/home/aimax/.local/share/webnavior/releases/service-settings-20261105-192331`.
