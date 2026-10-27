# Codex Handoff

This is a compact transfer note for a new Codex thread, not a changelog or a
record of commands and diffs. Keep only information that source code and formal
documentation do not make quick to recover. Prune replaced entries rather than
accumulating history.

## Current State

- Oct26/27 conversation reliability repair is DEPLOYED Oct27 for FIELD TESTING,
  originally from a source snapshot, then committed Oct27 at the user's request:
  364f162 Menu controls, 5989a5e recovery/verified replies, 4d03c4a whole-utterance
  ASR, baf9f83 browser test setup, plus this audit/handoff documentation batch.
  Evidence, integrated plan and exact validation/limits are in
  `docs/research/2026-10-26-kiosk-conversation-error-audit.md`. Missing Menu tools
  no longer hand off to Main; context failures have their own reason. Same-document
  recovery inspects original operation IDs and waits for settled calls, never
  replays writes/reloads carts, and releases only the host's acknowledged/issued
  task owner. Pending/missing/failed results or replacement documents stay blocked.
  Structured information/clarification replies render fresh facts; operation and
  display receipts remain required. Offered payment labels are separate from
  phase-specific execution permission. Final VAD audio uploads use <=20s chunks,
  preserve sample ranges/one utterance UUID and reassemble fully before decisions;
  failed/empty/cancelled/expired chunks never execute partial speech.1MiB remains,
  ASR413 is explicit; Oct27 separates15s ASR inactivity (renewed only after a
  successful chunk) from15s ready-transcript queue freshness; published9999s VAD
  remains. Regression reproduced3x6s chunks expiring before the fix; whole18s
  success, stalled/empty later chunk, reset and stale queue protections now pass.
  Empty cart now exposes real fulfillment controls. Empty history pages stop.
  Initial62s field hang remains unproven. Menu757/Kiosk249/relatedServer506 unit
  tests pass; scoped types5 packages, lint
  and Menu/Kiosk builds pass. Oct27 Chrome18 transport +13 CheckoutActions/Focus/
  FieldState pass, including never-settling presentation and lost refusal receipt.
  Previous browser startup stall was root/Kiosk Vitest peer-instance mixing;
  use `pnpm -F @proj-airi/stage-kiosk exec vitest`, not root runner with app config.
  OpenCC prebundle resolves through owning stage-ui package. POS response-loss/
  checkout-domain16 pass. Two synthetic
  configured-model explanation cases pass with read-only live config/scratch cart;
  no original customer log or production POS write. Oct27 configured ASR accepts
  synthetic60s quiet-boundary and46s crossing-boundary recordings (three chunks,
  two-to-three correction, bento and no-checkout facts preserved, one complete
  queue delivery). New opt-in `tests/experiments/kioskAudioReplay.test.ts` uses a
  supplied canonical synthetic WAV and read-only audio config; credentials stay
  in env. No physical microphone/payment acceptance or Main semantic proof.
  Private logs `/tmp/webnavior-reliability-*` and configured-explanation log are
  outside Git. User authorized field deployment Oct27; matching Menu/Kiosk/Server
  are now live. API restarted11:33:56 Taipei via systemctl, PID1530427;
  livez/readyz and DB/Redis pass. Public Chrome verifies all48 HTML/linked assets:
  Menu index-CtKt2yT4.js, Kiosk index-DUYoK-kc.js. Bridge health/catalog7 pass;
  live oversized-ASR probe returns413 KIOSK_AUDIO_TOO_LARGE before auth/provider.
  Fresh unauthenticated Kiosk loads device setup; no test device/order created.
  Old frontends, verified PostgreSQL dump, changed/base sources, patch, build
  logs and release.json (deployed-verified) are at
  `/tmp/webnavior-reliability-release-20261027-e363hd7n`. Baseline HEAD eac50945;
  source hashes identify the deployed snapshot; committed non-doc sources match
  it. No dependency/schema/Nginx/management/Bridge changes or manual db:push.
  Oct27 precommit root typecheck passed once; root lint has the same2370 existing
  errors, while changed-file checks and all commit hooks pass. Retained old
  hashed assets; reload existing Kiosk after ending any unfinished transaction
  before starting field acceptance. Physical microphone/payment and original
  initial62s cause remain unproven.

- Oct22 user explicitly requested plain-language batch commits and deployment for
  FIELD TESTING. Code/test commits on no_mcp: 6666541 Menu/browse/cart/fulfillment,
  1eaf6a4 Server decisions/receipts, 2ab99ec Kiosk verified replies, 5795db6 historical
  fixtures/evaluator/configured-model tests and docs. Those Oct21/22 local changes
  below are now committed and DEPLOYED through 5795db6; old not-deployed labels
  describe their implementation-time state. Public origin:
  https://webnavior.aikcitri.qzz.io. API restarted Oct22 16:30:18 Taipei,
  PID4107684; local livez/readyz confirm DB/Redis ok. Menu index-CC4ZOIK-.js and
  Kiosk index-CLs9SjEN.js plus all 2/44 HTML-linked resources match staged SHA256.
  Public /menu-api/health and catalog7 pass. Bridge process, management frontend
  and Nginx unchanged. Backup/verified DB dump/staged artifacts/release.json:
  /tmp/webnavior-field-release-20261022-e7vo7dwm (deployed-verified).
  Deployment reused installed dependencies (no lock/dependency changes), rebuilt
  schema package/Menu/Kiosk, no manual db:push or schema change. Standard sudo
  restart required a password and direct systemctl timed out; verified owned pnpm
  launcher was terminated, and existing systemd on-failure/control-group policy
  restarted/cleaned up the service. No service policy or privilege changes.
  Precommit checks: Menu757/Kiosk233/Server482 tests, focused Chrome2, one root
  typecheck, changed-file lint and builds pass. Root lint has the same2370 existing
  baseline errors, not fixed. Known mixed add+inquiry live-pilot failure remains;
  this release supports field testing, not full model/ASR/physical POS acceptance.
  Reload existing Kiosk pages. Historical sources remain partial3/missing3;
  committed source projections are sanitized, private capture/log/DB dump are not
  committed. A follow-up documentation commit records this deployment.

- User authorized configured Jev + LLM. First live smoke run on Oct22 used
  Jev lookski Qwen/Qwen3.5-4B (runtime health confirmed) and configured Main alias
  webnavior/chat -> qwen36 (actual upstream checkpoint not independently verified).
  Existing Server `tests/experiments/kioskProviderReplay.test.ts` now has eight
  synthetic cases and current per-round task/context/tool/reply wiring. Specified
  state checks: 7 pass, 1 FAIL; not Jev semantic accuracy or DOM acceptance.
  Mixed add+price inquiry was classified INQUIRY, handed off UNCERTAIN_FILTER
  read-only with unresolved price; Main's seven menu_get calls were rejected,
  five rounds exhausted, cart empty. Do not loosen guards or increase rounds as
  a substitute for preserving both demands. Multi-add succeeded through app guard
  and Main despite Jev SINGLE; bare 對 also selected index0 but was app-blocked.
  Main's multi-add final reply names only the last dish, so reply completeness is
  not proven. No failure retry or product prompt change. Live DB read-only enforced;
  scratch visitor/health DB and POS simulator, real configured model requests.
  Run 20261022-081236 log: /tmp/webnavior-configured-multidemand-20261022-081236.log.
  Full findings/limits in the multi-demand plan's live-pilot section. No pre-run
  frozen manifest, so not formal baseline; 48x3 and fixed12 Main still pending.

- Multi-demand evaluation first historical batch IMPLEMENTED locally, no commit
  or deployment. Plan/results: `docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md`.
  Order Menu `src/evaluation` owns sanitized source projections/provenance,
  per-demand fact evaluator and offline runtime controls. R03/R04/R05 are partial
  original excerpts verified from two local captures, with source/row hashes and
  original dialogue/ASR/questions/receipts; R01/R02/R06 originals remain missing,
  explicitly unscored. R03 includes the actual customer correction to TWO total:
  truthful reporting of recorded THREE is not fulfilling that correction.
  Test-only evaluator detects omissions/duplicates/options/prose-only completion,
  missing presentation and unrelated cart writes when before-state is supplied.
  Reply tests belong to Kiosk (`historicalReplies.test.ts`); importing them into
  Menu pulled Kiosk recording/model types and was corrected at the test boundary,
  without tsconfig changes. Both apps now have `test:history`: Menu54/Kiosk5 pass,
  one known recommendation diagnosis skipped. Full Menu757/Kiosk233 pass with
  existing optional skips; both scoped types and changed-file lint pass. No new
  live inference, POS writes, DOM acceptance, root typecheck or product changes.
  The 48 synthetic cases' full model runner, baseline144 turns, fixed12 Main
  sessions and optional structure probe are still planned, not executed. Prior
  Oct7 five-question extraction failed0/26; do not revive it or equate safe Main
  handoff with semantic understanding. Keep historical contradictions, repaired
  controls and actual live model outcomes separate.

- Oct22 collective-choice fix is local, NOT committed/deployed. Separately named
  ADD subjects hand off whole requests rather than becoming one-target choices;
  shared aliases/category ambiguity still clarify. Shared negative assent guard
  prevents high-confidence provider indices from interpreting bare 對/是的/好 as
  a target. Server uses existing recipient admission then CLARIFICATION; Menu
  rejects bypassed execution while retaining the pending demand. Question copy
  explicitly asks for one name/position; 第N項 now resolves alongside 個/筆.
  Historical collective diagnostic is now a default regression. Before-fix nine
  focused assertions failed; Menu748/Kiosk231/decision422 and Chrome7 now pass.
  Menu/Server scoped types and changed-file lint pass. The effect PoC c09 current
  fixture now expects domain handoff before inference; frozen semantic gold and
  experiment results are untouched. This prevents a partial add, not proof Main
  completes every multi-dish demand. Remaining six historical families are not
  addressed. See the Oct22 investigation's follow-up section.

- Historical regression audit now covers Aug31 initial Menu/Kiosk baseline through
  Oct22: 17 dated groups in the existing Oct22 field investigation, not an audit
  of every historical production session. Added two cross-flow tests for food
  exclusions/price/catalog/reset and old-clear-confirmation isolation from a new
  same-dish cart. Menu737/Kiosk231/decision422/proactive24 pass; Chrome23 pass,
  two completion-simulator tests skipped. Nine opt-in diagnostic assertions still
  fail across seven families: collective multi-meal yes, mistaken fresh-vs-more,
  off-topic admission (two), typo/fragment candidates (two), low-filter query,
  weak-route new request and fulfillment. Conservative Main handoff and fragment
  guards are not automatically bugs; original FAST expectations need contract
  review. The first three families need priority. Two stale provider stubs now
  supply explicitly synthetic recipient/admission answers so failures reach the
  intended boundary; recorded route/relation and expected results are unchanged.
  Final diagnostics: /tmp/historical-{menu,server}-diagnosis-final.log. No product
  code, live model, POS write, deployment or commit in this audit. Cross-origin,
  management login/SW and full Scene ASR failure acceptance remain separate gaps.

- Oct22 field fixes are implemented locally, NOT committed/deployed. Source:
  `docs/plans/2026-10-22-kiosk-field-investigation.md` (investigation, plan and
  implementation validation). Its historical-regression matrix maps Oct21/22
  reports to existing tests and live-acceptance gaps, with scoped replay commands.
  Menu fieldRegression also tests browse-first/fulfillment-first sequences around
  real 1+2 merged quantities and a later add, guarding cross-flow state leakage.
  Decision payment IDs accept current linepay/jkopay;
  Menu/POS still validates execution. Unknown no-tool operation prose is rejected;
  known effects require same-turn matching receipts. JSON/SSE model text is draft
  service_event; Kiosk stores the validated assistant reply once. Service FAQs and
  bare greetings remain usable. Catalog inclusion no longer removes legal tools.
  Fulfillment uses exact visible controls; missing target fails before cart writes.
  An unpaid-checkout mode change issues one-use confirmation, then cancels checkout
  before applying the mode; pending/uncertain payment remains locked. Whole menu is
  `menu_get({scope:'catalog',display:true})`, includes seen dishes and updates actual
  grid; other recommendations release precise subject scope. Named display:false
  reads do not replace the grid. Context carries rendered item IDs/query scope,
  and Menu awaits async Vue presentation callbacks. Standalone acknowledgements
  no longer become greetings/recommendations; invoice question omits internal rules.
  Menu733/Kiosk231/Server482 tests and scoped types/lint pass; domain422 rechecked
  after final semantic edit. Chrome21 and Menu/Kiosk builds pass. Optional live
  tests skipped. No root typecheck, real-model replay, service restart or deployment.
  Prior local Oct21 Menu dialog/viewport changes below are preserved. Historical
  field evidence (25 sessions/1122 entries) is in 0600
  `/tmp/webnavior-20261022-{api.log,entries.json,decisions.json}`. Live field/model
  acceptance remains necessary; public site still runs the older deployed build.

- Oct21 post-add Menu behavior is implemented locally, NOT committed/deployed.
  User chose 「關閉選單並保留目前菜單」. Selection no longer rewrites the
  recommendation grid/category; closing restores the pre-selection viewport.
  Successful add resumes an older unadded meal's question without reopening its
  dialog. Test-only reproduction failed before the fix; Menu728 tests, scoped
  types/lint/build pass. Isolated Chrome + local simulator verified dialog count0,
  category便當, scrollY300 unchanged and one added便當. No live order/payment writes.
  Root typecheck not run. README documents the new behavior.
  Recent live session WpW9YM6aK7lDFgT-V1m3e exposes separate UNFIXED issues:
  actual order_add_item x1 then x2 (seq22/28) merged to3; later Main claims
  2/4/5/7 quantities, phone320 recorded, and displayed menu/price results without
  matching tools. Only cart writes in the bounded session through seq330 are
  those two adds. Route/serviceRequest/recovery can promote weak/background or
  incomplete speech into UNCERTAIN_OPERATION Main; no-tool Main prose is accepted
  as assistant_text and can pollute later history. Examples at15:18–15:22:
  電話號碼是320; 再用電池; 一 二 三 四 五 六 七. Some recovery rounds correctly
  ignore background; do not claim every admission has the same failure path.
  Audit artifacts (0600): /tmp/webnavior-quantity-session-audit.json and
  /tmp/webnavior-latest-parsed-decision-log.json. No new live model replay,
  semantic thresholds/prompts, history or production services were changed.

- Oct21 Kiosk OpenCC through 29962bf is DEPLOYED and verified. Public Kiosk
  index-BR-bjDae.js and all 44 HTML-linked assets match staged SHA-256 hashes.
  Clean Chrome stays at /kiosk/#/ without page errors; the deployed converter
  maps 请确认这份订单。 to 請確認這份訂單。. Backup and release.json:
  `/tmp/webnavior-opencc-release-20261021-561pnnz2` (deployed-verified).
  Frontend-only release; API PID 2642311 and its start time, Menu, management
  build and Nginx unchanged. API/DB/Redis/bridge and 7 catalog items pass.
  Reuses stage-ui's Taiwan Traditional converter for conversation/streaming
  text, errors, visible ASR, welcome/progress and diagnostic transcript headings;
  speech synthesis also receives converted text. Display copies preserve original
  model history, ASR, simulation input, tool payloads and raw diagnostic traces.
  Kiosk 228 unit tests, 7 focused Chrome tests, changed-file lint, production
  build and the once-run root typecheck pass. Root lint reports 2370 errors in
  unchanged baseline files; no unrelated cleanup. Browser tests prebundle OpenCC
  to avoid mid-run optimizer reloads. Changes are grouped into display, speech
  and documentation commits on no_mcp; no remote push. Reload existing Kiosk
  tabs to load the OpenCC frontend.
  This does not fix background admission or unverified model success claims.

- Oct21 `no_mcp` through efcce39 is DEPLOYED and verified at
  `https://webnavior.aikcitri.qzz.io`; the implementation-time "not deployed"
  notes below are superseded. API restarted at 13:37:43 Taipei, PID 2642311;
  livez/readyz report DB/Redis ok. Public Menu index-By0DmB8Z.js and Kiosk
  index-BSfgpFRX.js plus all HTML-linked assets match staged SHA-256 hashes.
  Bridge and 7 catalog items pass; Nginx, Origin-Trial and management build
  unchanged. Backup: `/tmp/webnavior-no-mcp-release-20261021-0rrftbgb` holds old
  static trees, staged builds, verified DB dump and deployed-verified release.json;
  its previousRelease records the Oct20 master release. Frozen install, builds,
  Menu/Kiosk/stage-ui scoped types, Menu725/Kiosk227/Server497 unit tests and
  Kiosk54/cross-origin15 Chrome tests pass. No root typecheck or live model,
  camera/microphone, real POS/payment acceptance in this deployment.
  Root HTTP redirects to /kiosk/; clean Chrome stays at /kiosk/#/ without errors
  or a controlling SW. User reports intermittent admin routing only in normal
  browsing, not incognito. Existing SW/cache is suspected, not proven; current
  management SW excludes root/Kiosk/Menu navigation. Suggested unregistering
  only this origin's SW, closing its tabs and reopening, preserving local device
  storage. No routing/configuration changes were made for this report.

- Oct21 service recovery is implemented and committed locally; source of truth:
  docs/plans/2026-10-21-kiosk-service-recovery.md. Valid Jev service uncertainty
  permits one fixed Main verdict, then one richer no-commerce review only for
  a valid UNCERTAIN. Invalid/provider failures cannot trigger semantic retries.
  Admitted requests hand off with the original utterance; no invented Fast Path
  action/confidence or restarting Jev. Existing finite phone resolution runs first.
  Recovery caps are 8s/12s, with a combined 20s including progress checkpoint
  waits, within the same 60s model turn. Checkpoints expire within 15s and are
  owner-bound/one-use; cancellation settles even an uncooperative provider.
  Separate typed Main progress/counters; text immediately shows receipt/time
  and a terminal state; unadmitted voice stays silent. A clarification cue is
  versioned/expiring and read-only, never an order/payment confirmation ticket.
  Metrics record stage times/request bytes/provider tokens without prompt bodies.
  The old clarificationDiagnosis failure was an incomplete serviceRequest mock;
  tests now supply every question explicitly and retain the complete two-item
  request, with valid uncertainty and invalid-response cases kept separate.
  Unit/integration: Server477/Kiosk227/Menu725 passed (optional tests skipped);
  final combined-deadline/HTTP subset25 passed. Live provider replay, target
  device/POS/payment and comparative p50/p95 remain unrun. No deployment.
  Browser: Kiosk15, cross-origin15 and ScenarioSurface1 passed separately.
  Commit gate root typecheck found Menu's virtual validator declaration missing
  in the stage-ui consumer. The owning production entry now references its d.ts;
  stage-ui scoped typecheck passes after the fix (no second root run).
  Changed TS/Vue/JSON lint passes; root lint still fails in untouched baseline
  chats/audio/provider/research/PoC files. Do not describe root lint as green.

- Oct21 Main-context integration is implemented and committed locally (not deployed).
  Source of truth: docs/plans/2026-10-21-kiosk-main-context-and-ordering.md.
  Neutral stage-shared/kiosk-conversation contract; host-only Menu snapshot with
  complete compact catalog after phone entry, fresh cart/checkout/questions/tools.
  Kiosk refreshes every model round and validates task ownership; refreshConversationState
  explicitly maps neutral ingredient/price constraints to HTTP task fields and retires
  old questions/focus. Server sends one current projection, compacts repeated menu
  receipts, intersects tools and rejects inconsistent context phase/read-only/revision.
  Runtime guards known handoff effects/line IDs and snapshot revisions; only own accepted
  writes advance a same-batch version. Unknown/fragment products cannot grant writes.
  Shared aliases; separate possibleItems; menu_confirm_item owns explicit add/replace
  consent, original constraints/replaceLineId/quantity and question validation. Fragments
  bypass old name-only Fast Path confirmation and go through Main's explicit proposal.
  Exact repeated named removal returns already-absent instead of reviving old 排骨飯.
  Removal reveals/animates the actual line control, checks revision, removes once and
  returns to menu; Main combo defers return until END. Missing control preserves cart;
  return failure retains accepted receipt, including END failure without repeated delete.
  Server main_round_metrics records real payload/section bytes, duration, SSE first
  output and provider inputTokens only if supplied; Kiosk main_task_metrics records
  orchestration time/rounds/tool count. No prompt bodies logged or extra LLM calls.
  No Jev order/threshold changes or Stage Web edits. No new external model replay
  authorization: live semantic/device/POS/payment and comparative p50/p95 remain unrun.
  The later recovery work fixes the incomplete clarificationDiagnosis mock;
  Menu now has no failure in the relevant complete suite. Real DOM removal and
  cross-origin transport checks are also covered. See both plans for validation
  and remaining live-model/device/performance acceptance.

- Oct21 attachment a553fda2: 大腸臭臭鍋一份 has no product/category match;
  recorded scores correctly recover weak INCOMPLETE through serviceRequest to
  Main UNCERTAIN_OPERATION. Same-text local session UGmY-FToOvrROt9GPBGMA
  records Main customer_skip_phone rejected INVALID_PHASE, then a requested
  menu_get without receipt. Recording loop intentionally stops on the rejected
  batch after obtaining the continuation, so the later lookup is never executed.
  General Main now never receives host-owned customer_skip_phone, including
  phase-less continuations; finite phone resolver/Fast Path still owns skipping.
  Tests cover tool exclusion, rejected-loop behavior, exact-score handoff plus
  actual unknown-name lookup/customer reply/empty cart. No live model replay;
  attachment alone has no session correlation key, so same-text DB evidence is
  not proof that every matching UI failure has the same cause.

- Oct21 attachment b0b98800: local recording confirms 鱔魚意麵3份，不要蔥花，
  一份大辣兩份小辣 incorrectly executed order_add_item beef-noodle-soup x3
  (450). The defect is unauthorized product substitution, not missing options
  on the wrong dish. No eel product matched; sole 麵食 member was
  treated as identity. Server now hands sole-category/no-product ADD to Main,
  retaining original wording; browser resolveIntent independently blocks that
  automatic target for ADD/SELECT. Multi-target category clarification remains
  available. Multiple values in one option group cannot collapse into one
  cart-line option; Main resolves splits/corrections. Existing category-one
  auto-purchase expectations changed to handoff, with named-item positive tests
  retained; requirement PoC n13 capability expectation updated, semantic gold
  unchanged. Recorded high scores and actual runtime verify zero added lines.
  Generalized at Main's task boundary: exact current products bound eligible
  selection/configuration/add IDs; category-only/possible/overflow evidence
  cannot grant a product choice, regardless of category size or successful
  alternative/full-menu lookup. Task BEGIN replaces bounds; menu revision/expiry
  invalidate them. No-lexical-evidence contextual replies retain existing flow;
  this does not claim full semantic identity/consent validation. resolveIntent
  now uses derived item constraints rather than reusing old transcript names
  that could bypass the sole-category guard. No new Jev questions or thresholds.
  Source only; no existing live cart was edited, no external model replay.

- Oct21 attachment c1d194f6: previous 「那我要排骨便當」 produced duplicate
  quantity prompts before a correctly handled 一份. Menu beginMeal returns the
  same question as customerMessage and pendingCustomerChoice; Scene’s local
  customerMessageFrom concatenated both before replyWithQuestion. Receipt
  presentation now lives in questionPresentation.replyFromReceipt, used by Scene:
  compose the explicit outcome with the validated question once; no raw pending
  fallback. Cart summary behavior remains. Actual runtime regression red -> green
  and shared composition tests cover identical/already-contained/absent outcomes.
  No intent/threshold changes, provider replay or deployment.

- Oct21 handoff audit: added short-answer cases 一份/不要辣 alongside 內用/一位
  and topic-change-to-store/menu checks. Reliable concrete answers recover weak
  routes without granting checkout consent or executing guessed actions.
  Confirmed store FAQ gap: a strong generic NEEDS_ASSISTANT with no reason/no
  food matches inherited requireMenuRead. API now uses bounded Main
  resolve_service_scope only for unclassified, non-phone, unmatched handoffs;
  SERVICE_INFO -> GENERAL_QUESTION; food/order/mixed/unknown/error retain
  the original guard. General service tasks are read-only. Trace serviceResolution
  is separate from Jev counters. API53/Kiosk209 and relevant Server domain
  tests/scoped types pass. No phrase list, live provider replay or deployment.

- Oct21 attachment e2821679: typed 略過 -> service REQUEST0.7406, phone
  SKIP0.5227, serviceRequest BACKGROUND0.3255 ended silent before the existing
  Main phone resolver. API now also permits bounded phone validation for
  customer_entry UNAVAILABLE/UNCERTAIN_SERVICE_REQUEST with an issued skip
  candidate. Only SKIP_PHONE rejoins Fast Path; all other/invalid/failed answers
  preserve the original silent result. This never admits open conversation or
  menu tools. Confirmed background/uncertain recipient still do not invoke Main.
  Exact-score segmented/nonsegmented tests cover skip/keep/uncertain, retaining
  the3 Jev counts and separate phoneResolution evidence. No live provider replay.

- Oct21 user clarified the phone gate: filling a valid phone OR explicit skip is
  required before ALL menu reads/recommendations/ordering/checkout. This
  supersedes phone-stage factual browsing. MENU and ORDER both return
  CUSTOMER_ENTRY_REQUIRED; Main at customer_entry receives only optional session
  history, no commerce tools. Menu runtime rejects reads/writes from Agent and
  manual callers; host phone controls and customer-entry questions remain. Host
  checks live phase before presenting old receipts; reset restores the gate.
  Store facts/identity/phone explanations remain available. Removed the obsolete
  once-only post-query phone reminder. Entry tests7, Server domain378/API45,
  Kiosk206 and scoped types pass. Full Menu run has684 passes and one existing
  clarificationDiagnosis expectation mismatch: UNCERTAIN_SERVICE_REQUEST vs
  UNCERTAIN_OPERATION (phase clarification, unrelated to entry gate); untouched.
  No live model replay or deployment.
  Earlier no-reply wording remains customer-facing. Internal dataOnly reads still
  do not finish a read-only presentation after entry.

- Oct21 user-provided 周氏蝦捲 service facts are saved/published in the local
  test Site profile revision52 through the existing draft/release service.
  agentInstructions:11:00–14:00, cashless payment, electronic invoice; order at
  Kiosk/online/table QR; self-pickup or robot delivery to table. No assumed
  operating days/payment brands/URLs/delivery guarantees. Other profile fields
  unchanged; prior release51 remains immutable. Sessions pin their original
  release, so new sessions use the new facts. No global store default changed.
  Jev service scope/GENERAL_QUESTION now includes store-service information,
  including weak-route relevance recovery; Main uses supplied site facts and
  distinguishes explanations from live operations. No live-model replay.

- Oct21 ordering is restored to intent-first per user accuracy preference.
  The standalone recipientAdmission.ts and its obsolete order tests were removed;
  authenticated decisions call index.ts directly. Existing per-intent recipient,
  relation/price/food checks remain. Kiosk shows progress only on confident
  service intent plus recipient checkpoints (or serviceRequest REQUEST), never
  recipient/route confidence or ASR completion alone; customer text is appended
  only on accepted final paths or real read receipts, preventing silent outcomes
  from leaving unanswered bubbles; microphone indicators/operator diagnostics remain.
  Recorded 「哈哈哈 好啊好啊」 GREET0.7487 -> greeting IGNORE0.5559
  exposed an untagged UNAVAILABLE retry. UNCERTAIN_GREETING stays silent through
  shouldShowDecisionRetry, alongside unknown recipients, IGNORE and INCOMPLETE.
  No phrase whitelist/threshold changes, live replay, commit or deployment.
  Movie traces weak IGNORE0.4215/0.4658 -> recipient KIOSK0.9931/0.9941
  exposed a second issue: recipient-only recovery promoted chatter to Main.
  Final abstention recovery now asks serviceRequest (valid Kiosk service demand
  or answer); BACKGROUND ignores, REQUEST alone admits Main, weak/unknown scope
  stays silent UNCERTAIN_SERVICE_REQUEST. Weak unfinished-speech recovery also
  rejoins this gate: recorded 「你有看過流星嗎」 INCOMPLETE0.2323 -> service
  REQUEST0.9336 -> speech REQUEST0.2382 must not borrow recipient confidence
  to admit Main. Recorded-score tests retain genuine service recovery.
  Uses current references and unexpired
  questions, never operations; intent-first order and thresholds remain.

- Oct20 recorded 「有水餃或牛肉麵嗎？多少錢？」 price INFORMATION0.359
  reproduced UNCERTAIN_FILTER handoff with unresolvedPrice blocking even Main's
  menu reads. Server now uses Main's bounded resolve_price_choice checkpoint
  before binding that task; only issued IDs survive, and the task remains
  read-only. Trace priceResolution is separate from original Jev counters.
  Mocked recorded-score replay and segmented/nonsegmented route tests pass;
  no live provider replay, commit or deployment for this change.

- Oct20 `no_mcp` Kiosk + localhost:5166 Menu migration is implemented locally,
  uncommitted and NOT DEPLOYED. Stage Web/DaMai are explicitly deferred; Stage
  Web's native adapter/health export are unchanged, but updated Menu no longer
  registers native tools. Plan and acceptance scope:
  `docs/plans/2026-10-20-webnavior-without-native-webmcp.md`.
  Eventa window-message uses exact origin/Window, connection/document IDs and
  a challenge; execution caches in-flight receipts per operation ID. Only
  discovery retries. Lost execution receipts revoke admission; no write replay.
  Kiosk keeps the `webmcp` registry namespace for existing toolset prompts.
  Menu runtime/authorization remains in webmcp.ts; static contracts moved to
  toolDefinitions.ts. Ajv8.18 validators compile/bundle at Vite/Vitest load time,
  preserving dynamic POS enums without browser eval. Tool inputs and receipts
  retain native JSON semantics (including Vue readonly inputs); no proxy cloning.
  Menu682/Kiosk195 unit and Kiosk52 browser tests pass; focused cross-origin
  suite15 passes; it covers combined add, multi-tool work, recommendation, task locks, phone,
  source isolation, dedupe, late replies and simulated checkout/payment/completion.
  Run it from root with `VITEST_BROWSER_CHANNEL=chrome pnpm exec vitest run
  --config packages/stage-ui/vitest.interactiveService.config.ts`; run Kiosk
  browser tests with its package-scoped command to share its Vitest runtime.
  Scoped Menu/Kiosk types and builds pass; no root typecheck, live Jev/Main,
  target-device, physical payment/POS acceptance, commit, push or deployment.

- Oct20 commit validation: changes are grouped by ordering, floating console,
  local presence, greeting defaults, assets and documentation. Changed-file
  commit hooks pass. Root lint reports3182 existing errors in files outside this
  change set (including test_prompt and older audio/provider tests). Root
  typecheck was attempted once, then its remaining parallel Vue workers were
  terminated to release resources; it did not complete and is not a pass.
  The earlier affected-package typechecks and targeted tests remain passing.
  No deployment or remote push is part of this commit task.

- Oct20 local camera voice admission is LOCAL, NOT DEPLOYED. With observation
  enabled, voicePresence.ts requires an in-zone candidate with quality>=0.5
  within the existing1500ms loss grace and currently observing camera status.
  First valid sample admits voice; greeting dwell/sample gates are unchanged.
  Unknown/starting/failed camera blocks voice; the user explicitly confirmed
  strict mode in the async preference reply after implementation. Observation
  now runs in standby even with greetings/reminders off. Disabled observation,
  touch and simulated text retain service. KioskScene checks before ASR, after
  ASR, on dequeue, before delayed Fast Path actions/Main handoff and proactive
  playback. Lost presence cancels proactive work only, not an issued commerce
  request or its receipt. Camera/settings resets discard old admission evidence.
  Kiosk195 unit tests, scoped typecheck/lint and production build pass; no real
  camera/microphone acceptance or deployment. README documents the policy.

- Oct20 typed 略過 trace established REQUEST0.7406 / SKIP0.4977, then
  UNCERTAIN_OPERATION -> read-only Main unable to skip. Unrelated to the camera
  gate. Server now resolves admitted weak phone meaning through Main's bounded
  resolve_phone_choice tool (SKIP_PHONE/KEEP_PHONE/UNCERTAIN), independent of the
  weak Jev proposal. Only SKIP_PHONE rejoins the original browser skip candidate;
  no general Main mutation authority or threshold/phrase-list change. Other or
  malformed results keep the read-only handoff. Original Jev counters remain
  separate from trace.phoneResolution choice/duration; no fabricated confidence.
  User explicitly authorized this exact 略過 replay to the existing Jev/Main
  endpoints. Live Jev passes; recorded weak scores + real Main/browser runtime
  skip successfully, and the three previous withdrawal/compound cases pass.
  Targeted Server domain354/routes5 and Kiosk100 tests pass, including segmented
  continuation; Server/Kiosk scoped types and changed-file lint pass. Local
  source only, not deployed. Server README documents the flow.

- Oct20 unified semantic-abstention policy is LOCAL, NOT DEPLOYED. The public
  decideInteraction boundary now hands valid low-confidence semantic outcomes
  to Main after independent recipient admission; it reuses existing admission,
  does not recheck an uncertain recipient, and respects the question budget.
  Malformed replies, confirmed background/unfinished speech and post-execution
  review/receipt recovery retain separate paths. No guessed action, price choice
  or question-answer IDs survive the new handoff. Kiosk no longer forces a menu
  read for UNCERTAIN_OPERATION; protected phases and checkout-entry questions
  remain read-only. Separate unfinished fragments can accompany Main as
  unverified context, never concatenated or treated as confirmed quantities.
  This covers the reported phone REQUEST0.8808 / ORDER0.3861 retraction too.
  Oct20 release checks: full relevant Server400, Kiosk187, Menu684,
  proactive24 and Chrome15 tests pass. An invitation integration fixture needed
  the new independent recipient answer; production logic was unchanged there.
  Server/Kiosk/Menu builds pass; Kiosk needs CHOKIDAR_USEPOLLING=1 on this Mac
  to avoid EMFILE from filesystem watchers. Scoped types and changed-file lint
  pass. Real Jev category replay and Main category replay pass. User explicitly
  authorized both reported dumpling utterances to configured Jev/Main too:
  mainScopeReplay semantic-handoff cases cover phone/order retraction and
  quantity-plus-addition against synthetic carts, then assert the actual host
  reply selection. All4 final Main cases pass (including category). First replay
  caught raw Main falsely saying an empty cart had been edited after cart_get;
  shared instructions now distinguish read receipts from successful mutations.
  Its focused16 tests pass after that change. No physical mic/VAD/noise,
  hardware payment/POS acceptance or deployment performed.

- Oct20 text-mode input/timing/trace now lives in kioskTextConsole.vue, a
  floating console composed by KioskConversation. Header-only VueUse dragging,
  collapse preserving the draft, reset position and viewport clamping; voice-only
  mode still has no text input. Local source only, not deployed. Chrome15 tests
  cover submission, drag bounds, collapse and narrow-screen resize.

- Oct20 shared initial greeting dwell is now300ms in the local source, not
  deployed. Device defaults derive dwell from the shared interaction policy;
  explicit device/local overrides retain precedence. User clarified this was
  global initial configuration, so the unintended DEV-088065 local300ms change
  was restored to its original500ms (settings revision14, audited). Sampling
  cadence, sample-count gate and enabled defaults are unchanged.

- Oct20 compound quantity/addition fix is LOCAL, NOT DEPLOYED.
  Attachment44310a20 / session kXF5nbdV-N5IZSd3okoaI: 水餃改一份好了 然後我要再一碗牛肉麵
  selected ADD0.7289, purpose OPERATION0.8458, coverage SINGLE0.3983 and stopped.
  Reliable route + operation purpose with weak SINGLE coverage now verifies
  the isolated recipient before handing the original utterance to Main as
  UNCERTAIN_OPERATION; no Fast Path action or fulfillment answer is authorized.
  Recorded-value regression and recipient/invalid-evidence contrasts pass;
  Kiosk projection retains order-edit capability. Oct20 real Jev/Main/local
  Menu replay now passes: dumpling quantity2 becomes1 and one beef noodle
  is added, without rejected tools. No deployment; thresholds unchanged.

- Oct20 category inquiry fix is LOCAL, NOT DEPLOYED. Reported
  session pNjTf7VrgOG7-0Gxp7lRZ entries19–26 shows Main called
  menu_get(category:便當,display:true), rejected by the explicit query-action
  contract; Kiosk correctly stopped its attempted retry with tool-rejected.
  Main instructions and menu_get field descriptions now route category display
  to menu_recommend(action:update). Real Main/local Menu replay passes without
  rejection or a retry. Jev also reproduced weak filterRequirement after a
  strong read route; its overlapping category/preference definitions are now
  disjoint, and the original-utterance replay passes. Server focused332 and
  Menu query-actions8 tests pass. Expanded synthetic Jev contrasts remain
  opt-in and were not run: auto-review limited external transmission to the
  supplied replay. No thresholds, rejection policy or order behavior changed.

- Oct20: the accumulated Oct19 ordering changes are now grouped into commits
  for spoken prices, checkout/phone UI, menu-query/voice routing, and docs.
  The older UNCOMMITTED labels below describe deployment-time status only.
  Commit preparation updated stale test calls to the explicit query-action
  contract and supplied the separate filter-presence checkpoint response.
  Menu 684, Kiosk 175, Server 368 unit tests and 20 Chrome UI tests pass;
  env-guarded live-provider tests were not enabled. Full-project typecheck
  and changed-file lint pass. Root lint reports existing errors outside this
  change set, including test_prompt JSON formatting; no unrelated cleanup.

- Oct19 explicit conversational query actions are DEPLOYED, UNCOMMITTED.
  Main must choose continue/update/reset/clarify for Agent menu_recommend calls;
  browser owns queryState, group changes and exclusions. Trusted host more:true
  stays internal. Plain condition updates include shown matches; explicit
  alternatives use excludeShown, continue/reset exclude history. Reset retains
  dietary/ingredient restrictions and cart. Relative words are not product names.
  Exhaustion/clarify return canonical speech without a new presentation/card;
  JSON/SSE completion settles that receipt without another provider call.
  User requested deployment. Backup: /tmp/webnavior-query-actions-release-20261019-w67wqnw1.
  Menu index-D75tOMir.js public index/bundle verified; bridge/catalog7, DB/Redis,
  unchanged Kiosk/Nginx verified. User restarted API at22:19:54 Taipei, PID603743;
  active/livez/readyz, DB/Redis and public bridge verified; release deployed-verified.
  Existing Menu tabs should reload because Agent action is now required.
  See order-menu/server/stage-kiosk READMEs and queryActions.test.ts.
  Local Menu684, Kiosk77 and Server51 tests, all three scoped typechecks,
  changed-file lint and Menu production build pass. No root typecheck.
  User explicitly authorized existing credentials and synthetic conversations
  to the configured Main/Jev endpoints after auto-review initially rejected it.
  Final real-provider suite: all41 pass (22:15:12 Taipei, 110.57s), log
  /tmp/webnavior-main-scope-live.log. First full run reproduced stale other-dishes
  intent leaking into a plain changed-price query via excludeShown:true. Tool
  description and Main instructions now require that request in the CURRENT
  utterance; all41 pass after the fix. No phrase whitelist or threshold change.
  Main qwen36: https://syqvzpveyn.aikcitri.qzz.io/v1;
  Jev: http://projev.aikcitri.qzz.io/v1/systemone.
  Test: apps/stage-kiosk/src/services/mainScopeReplay.test.ts, env guarded;
  isolated synthetic sessions only, no real orders or payments. Scoped lint and
  Menu production build rerun after prompt change; pass. Deployment verified above.

- Oct19 price-handoff context isolation is DEPLOYED, UNCOMMITTED (API only).
  User requested deployment. Backup and API-before state:
  /tmp/webnavior-budget-api-release-20261019-qc279oms.
  User restarted API at21:19:20 Taipei, PID521926. Source hash matches release;
  livez/readyz DB/Redis and public bridge pass. Public Menu/Kiosk and Nginx hashes
  unchanged. Release deployed-verified. No frontend/schema change.
  Visitor KW8V27ebW…: after SHOWN120 returns none, then catalog120 returns dumplings,
  一百三以下呢 reaches price but UPPER_INCLUSIVE confidence0.5368 (0.5181 with 的),
  so UNSUPPORTED_PRICE caused the misleading unsupported-budget response.
  Prior live tests covered a different conversation order. Expanded live cases
  first reproduced both new-order failures. handoffMenu now sends original current
  utterance + literal amounts only to the finite price checkpoint; old budgets,
  scope answers, dish references and unrelated state remain outside that decision.
  No lowered thresholds or phrase whitelist. Live regression also exposed weak
  RANGE vs RANGE_MAX_EXCLUSIVE for explicit102–104 after isolation. Price question
  now explicitly distinguishes inclusive defaults from exclusions stated in the
  current utterance, and explains literal amounts are not separate budgets.
  All6 live Jev/Main/Menu cases pass: both conversation orders, both wordings,
  120–140 and102–104. Correct bounds apply and cart stays empty. Server317 tests,
  scoped Server/Kiosk types and changed-file lint pass.
  This changes the handoff checkpoint only, not finite action/filter checkpoints.
  Above/strictly-above boundaries have unit coverage but were not live-tested.

- Oct19 short budget-follow-up recovery is DEPLOYED, UNCOMMITTED (API only).
  User requested deployment. Source/state backup:
  /tmp/webnavior-budget-api-release-20261019-mv7b6bgi.
  User restarted API at21:09:10 Taipei, PID508956 (previous497185).
  Source hash matches prepared release; livez/readyz DB/Redis and public bridge pass.
  Public Menu/Kiosk index hashes and Nginx unchanged. Release deployed-verified.
  Visitor wu0beMfO… entries26–30: 一百三以下的呢／一百三以下呢 parsed130,
  but Jev chose recommend-more at0.5906/0.5351, then weak OPEN_REQUEST and
  UNAVAILABLE before price. Fixed-value tests reproduce both failures first.
  Existing weak read recovery now includes recommendation routes without an
  owned pending question. Independent strong recipient + pure menu inquiry are
  required; price is qualified before read-only Main handoff. No lower thresholds,
  automatic batch change or mutation; invitation answers retain their own checks.
  Server decision-domain316 tests pass. Live2 real Jev/Main/Menu replays retain
  reported dialogue, replace120 with130, include125/130 items after catalog scope,
  and leave the cart empty. API restart verified above; no frontend change.

- Oct19 meal-confirmation floating card removal is DEPLOYED, UNCOMMITTED.
  Menu index-DHBGGZSD.js and Kiosk index-CJRtGvLN.js published with backups at
  /tmp/webnavior-voice-ui-release-20261019-ata1w7qx. Public hashes, bridge/catalog7,
  unchanged Nginx and Origin-Trial checked. User restarted API at21:00:16 Taipei,
  PID497185; livez/readyz and DB/Redis verified. Release state deployed-verified.
  User chose launch simplicity: remove the extra Yes/No meal card while retaining
  the owned voice question, conversation text, expiry and repeat limits. No direct
  ordering shortcut. Phone, item configuration, idle protection and completion
  windows remain unchanged. Removed the component and click-only browser tests;
  repeated unclear speech no longer instructs customers to use removed buttons.
  meal_confirmation remains a business phase; interactionState reports the actual
  screen. Menu48 focused tests, scoped typecheck, lint and production build pass.
  Menu publication and selective voice recovery API restart are complete.

- Oct19 selective voice recovery is DEPLOYED, UNCOMMITTED. User clarified that
  surrounding speech is not necessarily the customer; do not make every failure
  produce a spoken retry. Broad UNAVAILABLE/error speech, repetition caps, phone,
  invoice/scanner capabilities and checkout timing remain unchanged in this task.
  Main decision-guidance no longer forces clicking. Persisted/wire touch_preferred
  is retained but now pauses unsolicited prompts and serves directed voice requests.
  An unresolved cart-target clarification no longer consumes its cancel candidate
  or tells the customer to use touch: Kiosk keeps the owned question/deadline.
  Server now admits this spoken retry only with strong CLARIFICATION + separately
  qualified KIOSK recipient; OTHER→IGNORE, weak/unknown→UNAVAILABLE. No confidence
  reduction. Target instructions compare full attributes/negation, allowing omitted
  names when uniquely identified. Live 不辣那一份 first failed (weak CLARIFICATION),
  then passed after this general instruction; customer re-question + companion case
  also pass (live3). Unit recipient matrix5 and host unresolved→bound answer test
  verify no premature mutation/cancellation. Server317 + Host76 pass; scoped
  Server/Kiosk types, changed-file lint and Kiosk build checked. Kiosk publication
  and API restart verified above. No new customer controls or real payment/POS effects.

- Oct19 Taiwanese spoken prices are DEPLOYED, UNCOMMITTED.
  Public Menu index-CehhbAJB.js index/bundle hashes verified; Kiosk unchanged.
  Backup: /tmp/webnavior-taiwan-price-release-20261019-ensyulmp.
  API restarted at20:11:12 Taipei, PID448038; livez/readyz and DB/Redis pass.
  Public Menu hashes, unchanged Kiosk and bridge/catalog7 verified; Nginx unchanged.
  Origin-Trial was verified at publication. Price handoff repair is loaded.
  Session tVUWid2B_4UvHrFMVl-x2: 一百二到一百四 had empty amounts because
  pricing.ts deliberately rejected omitted trailing places. Existing amountFrom
  now resolves 百二→120, 千二→1200, 千二百三→1230, 萬二→12000; explicit零
  preserves102/1002/10002. Optional leading一, 兩/两, 萬/万 and NFKC supported.
  Full token spans include unsupported higher units, avoiding partial extraction.
  Approximation, unsupported mixed notation and spoken fractional currency remain
  non-executable; 十二塊五 must not become12, and 元兩份 stays a quantity.
  Real Jev exposed a separate low-confidence COVERED handoff missing priceChoiceId;
  it now uses existing handoffMenu to qualify prices before read-only Main.
  Fixed-value regression first reproduced that missing qualification. No thresholds
  lowered. Menu focused119 + decision-domain299 pass. Live2 real Jev/Main/Menu
  cases verify120–140 inclusive vs explicit102–104 after previous119, empty cart.
  Scoped Menu/Server/Kiosk types pass; targeted lint/build checked. Menu publication
  and API restart verified. No schema/lockfile change or POS submission/payment.

- Oct19 natural scope replies + floating-panel removal are DEPLOYED, UNCOMMITTED.
  Public Menu index-DKDaE4FB.js index/bundle hashes verified; Kiosk unchanged.
  Backup: /tmp/webnavior-scope-voice-release-20261019-2_lrhdcy.
  API restarted at19:55:27 Taipei, PID430265; livez/readyz and DB/Redis pass.
  Public Menu hashes, unchanged Kiosk and bridge/catalog7 verified; Nginx unchanged.
  Origin-Trial was verified at publication. Scope prompt is loaded.
  Session -IQxJ9IOqXiIewQHNA86c reproduced Main SHOWN for 剛才推薦 but ASK for
  剛才的 / 剛才的推薦. Prior local prompt change binds omitted nouns/temporal
  references to the active question's two search universes, without a whitelist.
  Expanded live replay now starts with recommendations, real Jev price admission
  and Main read before answering the scope question. All27 scenarios pass, with
  strict automatic acceptance for clear replies and holdout phrasing only in tests:
  剛剛的, 前面的, 你之前介紹的, negated corrections, fresh price100 and background.
  No new prompt/phrase rule was needed for these additional forms.
  Unclear spoken replies now explain the two universes (not repeat the initial
  question); original question ID,120s expiry, revisions and conditions remain.
  ASK-without-speech context/validation probes remain read-only. Unit17 pass;
  after this clarification change, targeted live4 unclear→natural answer flows
  pass with120 preserved. Other27 live results: /tmp/webnavior-scope-generalization-all.log
  and -all-results.json; latest4 results use /tmp/webnavior-scope-clarification-final.log.
  Menu/Kiosk scoped types, changed-file lint and Menu build pass; no root types.
  App no longer mounts/imports the floating scope UI; handler/busy state, component
  and obsolete3 touch browser tests removed. Owned voice question remains. Menu
  build index-DKDaE4FB.js has no floating-panel styles and is published. API
  restart is verified; reload the full Kiosk to obtain the updated Menu.

- Oct19 unsolicited recommendation expansion and weak search recovery are DEPLOYED.
  Public Kiosk index-Cv8z9P3a.js matches staged index/bundle hashes; Menu unchanged.
  Website/source/database backup: /tmp/webnavior-recommendation-release-20261019-2zjh0v9n.
  API restarted at19:33:58 Taipei, PID405914; livez/readyz, DB/Redis, public
  bridge/catalog7 and Origin-Trial pass; Nginx unchanged. Both Server repairs loaded.
  Same session entries14–21: `推薦幾個餐點` caused menu_recommend(limit3), then
  unsolicited more:true; menu reply aggregation narrated6 dishes plus6 prices.
  Kiosk recording now owns one recommendation presentation per send() turn.
  After an accepted recommendation receipt it withdraws recommendation/show
  tools from continuation definitions; repeat recommendations and broad visible
  menu_get calls receive a correlated data-only acknowledgement, without tool
  execution or customer receipt. Same-batch repeats are also suppressed. Named
  comparisons, internal evidence and authorized operations continue normally.
  Next customer send resets the budget, permitting an explicit request for more.
  Server instructions also constrain more:true and decision-guidance to prevent
  unsolicited expansion. This is separate from weak-price-entry repair below.
  Kiosk focused55 + Server26 pass; real Main/Jev replay12 pass, including the new
  completed-recommendation continuation (no second tool request). Scoped Kiosk
  types/lint and Kiosk build pass. Kiosk and API deployment are verified.
  Reload the full Kiosk to activate its per-turn guard.

- Oct19 post-deployment weak search recovery is DEPLOYED in the release above.
  Session -_n4bX6MRFcoRGilxK9-_ entries22–23: `120以下有什麼？` selected
  search-menu at0.597; filterRequirement OPEN_REQUEST at0.3999 then returned
  UNAVAILABLE before Main or the query-scope question. Weak finite search now
  uses the existing independent recipient + pure menuInquiry qualification
  before a price-qualified read-only Main handoff. No threshold lowered and no
  mutation permission added. Fixed-value reproduction fails before the change;
  recipient/background, mixed-operation and uncertain inquiry cases stay closed.
  Decision-domain298 tests and live Jev/Main/Menu11 pass; new live case starts
  before price interpretation with the reported bento conversation and reaches
  pendingCustomerChoice. Original10 live cases only started after scope creation.
  Server types/lint pass; this recovery needs no extra frontend change.
  API restart verified above. No POS order or payment.

- Oct19 query-scope flow and price-handoff repair are DEPLOYED, UNCOMMITTED.
  Menu index-R0AKYPEi.js remains current; initial Kiosk index-f7hMuxg8.js is
  superseded by index-Cv8z9P3a.js in the recommendation repair above.
  API restarted successfully; livez/readyz, DB/Redis, public bridge and7 catalog
  items pass. Nginx unchanged; Origin-Trial present; old assets retained.
  Verified website/source/database backup: /tmp/webnavior-scope-release-20261019-ne9ul3yh.
  New broad price/dietary reads after a visible recommendation ask once whether
  to filter the shown batch or the whole catalog. Menu owns a120s revision-bound
  queryScope question and immutable conditions; the original floating UI is now
  removed locally as described above.
  Pending voice goes through the real Main chat model checkpoint in authenticated
  /interaction-decisions (SCOPE_CHOICE, temperature0), not Jev. Only question text,
  ordered option labels and confirmed conditions reach that checkpoint; opaque
  IDs/expiry remain browser authority. ASK retains the pending question; NEW_REQUEST
  clears the old question and reruns ordinary Jev on the entire current utterance.
  Price evidence forces fresh qualification even if Main misses the new amount.
  Complete labels/ordinals use the existing bound-reference parser; real Main
  still proposed SHOWN for 第二個, and application correctly resolved CATALOG.
  Do not call this100% model accuracy. Invalid/unavailable interpretation falls
  back to conversational clarification. Provider/activation failure cannot grant normal chat
  writes while a scope question remains pending.
  Scope execution has a private per-call admission, not a global bypass flag.
  Confirmed item universe is separate from food exclusions, retained on more,
  reset by fresh queries; UI title/reply names the selected scope. Stale answers,
  order changes and resets retire the question. Main cannot invent a named scope
  for a customer-wide price query: BEGIN now requires the source transcript.
  All BEGIN fixtures and KioskScene are updated. Host-only tool names are shared
  in order-menu/src/hostTools.ts so kiosk_query_scope never reaches Agent tools.
  Recording stops at an owned scope question without another model continuation.
  Real qwen36 + real Jev + production route/host/Menu replay10 pass including
  120→100 and synthetic add2. Some earlier paraphrases required touch fallback;
  acceptance permits preserved ASK + explicit click, not wrong automatic scope.
  Menu648, Host69, HTTP3 and Chrome13 checks pass; Menu/Kiosk/Server scoped types,
  changed-file lint and both frontend builds pass. No root typecheck, POS order,
  payment or commit. Physical microphone/scanner remains unverified.
  See research section17 and READMEs. Menu + Kiosk + API are released together;
  reload the full Kiosk because the BEGIN contract changed.
  The older ordering release below is retained as deployment history.

- Oct19 price-handoff fix is DEPLOYED with the query-scope release above,
  UNCOMMITTED. Reported
  session `7hsfZq4mzTs1YZvCTCdXg`: after a99 recommendation, `120以下有什麼`
  made Main Agent correctly call menu_get(maxPrice120), but unresolvedPrice
  blocked it; ordinary empty receipts prompted retries119/115/110/109.
  Menu handoffs now qualify the browser-issued priceChoiceId before host task
  creation, retaining existing contextual price input. A reliable read route
  can hand off uncertain filter scope read-only, with independent price
  qualification; weak route plus weak scope still abstains. Price-only changes
  are distinguished from food preferences in scope instructions. Menu's
  unresolved-price refusal returns ok:false to stop the tool sequence.
  Real Jev→Kiosk→Menu synthetic replays99→120 and120→99 pass with exact bounds,
  including the120 boundary; six existing food-preference live replays pass.
  These replay actual tools with synthetic dishes, not full live Agent speech.
  No threshold reduction, schema change or commit. Menu and API deployment
  are verified in the query-scope release above.

- Earlier Oct19 ordering release (superseded by the scope release above) deployed to
  `https://webnavior.aikcitri.qzz.io`: scanner focus, checkout cursor, scroll
  destination and open preference queries. Menu serves index-pOjsIocX.js;
  Kiosk serves index-BphV_JC4.js. Both public bundle SHA-256 hashes match the
  staged builds. User restarted API at16:25:42 Taipei, PID199010; livez/readyz
  pass with DB/Redis ok. Public Menu Bridge and all7 catalog items are readable.
  Nginx configuration hash is unchanged, Origin-Trial header remains present,
  and older assets are retained for already-open clients. Static trees,
  working-tree patch, new builds and a pg_restore-list-verified database dump
  are backed up at `/tmp/webnavior-ordering-release-20261019-bm1wpslt`;
  release.json records verification. Host pg_dump has no installed client, so
  backup used the existing matching postgres:16 container and configured DB
  role. No schema/lockfile change, commit or push. Changes remain uncommitted;
  physical scanner and full Agent/voice acceptance remain unverified. No order
  or payment was executed during deployment checks.

- Oct19 scanner-focus follow-up: carrier/citizen invoice fields now autofocus
  on mount, option selection/reselection and Agent unlock. App passes the same
  lock as its inert main; locked fields disable/blur before regaining focus
  after DOM updates. Tax-ID output is now a labelled digit input, retaining the
  touch keypad, eight-digit validation, draft and explicit confirmation. Its
  scanner Enter suffix does not confirm; invoice valid-form Enter keeps existing
  behavior. Tax-ID cursor target registration is cleaned up on unmount. Chrome
  keyboard-wedge simulation and checkout-animation regression10, checkout
  unit14 pass. Physical scanner remains unverified. Deployed in the ordering release above; changes remain
  uncommitted. No scanner SDK, new dependency or global keyboard interception.

- Oct19 open food-preference follow-up: Jev routes the whole utterance to Main
  Agent via read-only MENU_QUERY rather than adding phrase/category candidates.
  A finite-read hypothesis first checks whole-request scope; OPEN_REQUEST exits
  before ingredient-slot questions. Direct reads retain bounded validation.
  Main Agent instructions preserve negation, combinations, corrections and cart
  state, clarify ambiguity, then use catalog-grounded query tools. menu_get and
  menu_recommend accept validated excludeItemIds; batches retain/extend them on
  more:true and reset on a fresh request. Existing dietary/ingredient/price
  filters intersect with exclusions. Internal menu_get(display:false) receipts
  now carry dataOnly:true and are not narrated by Kiosk. Server tool-result
  compaction preserves composition facts intact. Deployed with Menu, Kiosk and API together in the release above;
  changes remain uncommitted. Real Jev replay: five
  clear preferences reach MENU_QUERY; ambiguous 不想吃飯 reaches Agent for
  clarification without executing a filter. Focused tests, all six live routing
  cases, Menu/Server/Kiosk scoped types and changed-file lint pass; no root
  typecheck. Agent end-to-end speech/hardware validation remains outstanding.
  Candidate pruning and follow-up timing remain
  separate pending work.

- Oct19 checkout cursor follow-up: runtime checkout announcements lacked
  control IDs and checkout components did not register targets. Registered the
  real review/invoice/tax-ID/payment controls and wired them through App; checkout
  start first reveals review, then animates confirmation. Transitions wait for
  animation and execute once without a synthetic DOM click. Tax-ID dictation
  targets the draft; explicit skip/donation and return-to-order touch actions now
  match supported voice transitions. Unpaid QR pages retain payment-method
  buttons; pending/authorized/uncertain states still lock navigation. Deployed in the ordering
  release above; changes remain uncommitted. Chrome regression covers target registration,
  pre-transition ordering, switching unpaid QR method, touch actions and locks
  (11 browser tests, including existing review regression); Menu93 unit tests,
  Menu/Kiosk scoped typechecks and changed-file lint pass. No root typecheck.
  Actual microphone/hardware remains unverified.

- Oct19 scroll content-destination follow-up: original session
  NOSb3gdRfHaSE-uu_s7wB selected UP .8065 for 往下一點 at viewport0. Public
  direct DOWN moved0→720, so the owner is functional. Menu candidates now name
  earlier content near its beginning / later content near its end, not finger
  motion. Jev verifies EARLIER/LATER before mapping to an offered UP/DOWN action.
  Actual generated-candidate replay still chose initial UP .7481 for 往下一點;
  verification corrected it with LATER .9298, so the extra one question remains.
  Six clear position commands execute correctly; two composite gestures may
  abstain, never execute opposite (8 acceptance cases pass, not 8 successes).
  Bare finger-only probes remain inconsistent; do not claim general gesture
  interpretation is solved. A gesture-only fourth choice degraded core commands
  and was removed. No lexical executor, threshold change, new tool or dependency.
  Server83/Menu41 tests, scoped types/lint pass; prior real Chrome viewport test
  passed and geometry is unchanged. Deployed in the ordering release above;
  changes remain uncommitted. See `research/2026-10-02-menu-scroll-options.md`.
  Open preference/exclusion support is described above; candidate pruning and
  checkout-question timing remain separate pending work.

- Oct19 invoice skip follow-up: moved **略過，捐贈發票** below invoice entry,
  above Back. Retained session zloUV_0YpdMnMhQlGEFvp entries7/9 recorded literal
  略過 as INCOMPLETE .621 while already in checkout_invoice with no presented
  question; a real-provider synthetic replay reproduced it. Invoice routing now
  uses a concise current-phase instruction and sanitized checkout summary rather
  than stale meal/cart context. Other checkout phases retain their prior route.
  No lexical execution shortcut, threshold change, donation-code invention or
  payment initiation. Regression covers summary privacy, no-question routing,
  UI footer order and weak-choice refusal. Final live invoice8 + payment1 pass;
  Menu36/Server116 unit tests, scoped types and changed-file lint pass. An earlier
  broader live replay routed 走走走 去那邊 to NEEDS_ASSISTANT in ordering; that
  unchanged ordering case is outside this invoice fix. Actual microphone/touch
  hardware remains unverified. Menu frontend deployed Oct19 as index-BsE53J15.js;
  public bundle matches the build. User restarted API Oct19 at14:07:42 Taipei;
  new PID60954 is active/running. `/livez` and `/readyz` pass with DB/Redis ok,
  and the public Menu still serves the expected release. Both invoice UI and
  Server routing changes are now deployed. Backup:
  `/tmp/webnavior-invoice-deploy-20261019-3snye5oy`. Changes remain uncommitted.

- Oct19 voice-entry UI is deployed, with local changes still uncommitted. Public
  Kiosk now serves index-C00sQvW4.js: saying “略過” is the primary entry cue,
  phone/touch controls are secondary, VAD readiness drives the microphone label,
  and the existing idle hint gives spoken-order examples. Browser component11,
  Kiosk types and changed-file lint pass. Kiosk-only build/publish preserved
  the WebMCP Origin-Trial header; API readiness reports DB/Redis ok. Previous
  Kiosk assets and the source patch are backed up under
  `/tmp/webnavior-voice-entry-20261019-nc7fru6x`. No API restart or real speech,
  order or payment test was needed for this static UI release.

- Oct19 release: four code commits through 5f2c5f1 are deployed to
  `https://webnavior.aikcitri.qzz.io`; API restarted via systemd at11:17 Taipei
  (PID584043). Public `/` and `/kiosk/` serve index-0t8K34cR.js, `/menu/`
  index-9m9pfTsn.js, and admin index-Bd2h2EYE.js. Browser smoke: unregistered
  Kiosk shows device setup without errors; Menu loads all7 actual dishes and
  no cart/order/payment was attempted. API readiness reports DB/Redis ok.
  Root typecheck passed once; root lint reports3184 pre-existing errors in16
  unchanged files. All staged-file commit hooks and focused Shared21/Kiosk74
  tests pass. Old static assets and a pg_restore-list-verified database dump are
  retained in `/tmp/webnavior-release-20261019-rpf1ss90` (ephemeral backup; move
  to managed storage if longer retention is needed). No remote push, real login
  round trip, voice/hardware or payment acceptance test.

- Oct19 cart replacement (same session, entries76/78): 牛肉麵幫我改水餃 chose
  ADD .5474, purpose OPERATION .5638, coverage HANDOFF .5137, then UNAVAILABLE.
  Independent recipient and replacement-semantic checks now recover weak HANDOFF
  coverage and weak MULTI_ACTION before inquiry-only recovery. No threshold was
  lowered; Agent still validates targets and uses atomic replaceLineId. Live
  configured-provider replay completes noodle→dumplings and reverse replacements;
  eight cart-change controls pass, including absent pizza preserving the cart,
  add/quantity/remove and companion speech. Server decision268 tests pass
  (75 opt-in skips), Server scoped types and changed-file lint pass. Released
  Oct19 as recorded above; no voice/hardware test.

- Oct19 food hallucination (session hIHA3DAvjhrG8x0RjggBa): read-only DB audit
  confirms 我不想吃飯 received invented 麻醬麵/酸辣湯麵 without any tool call.
  Plain Agent handoffs now require menu receipts even with zero catalog matches;
  GENERAL_QUESTION explicitly admits identity/service dialogue. Reprojection
  retains requireMenuRead. Both prompts prohibit inferring a substitute from an
  ambiguous refusal. Host regression reproduced the gap before the fix; Kiosk73
  and Server140 targeted tests pass (2 skipped), scoped types checked. Oct19
  continuation used `/etc/webnavior/server.env` for the actual deployed provider
  configuration. Local `.env.local` REDIS_URL now matches that authenticated
  connection; standard apply:env Redis authentication/PING passes. The food-refusal
  replay chose IGNORE, producing no invented menu reply. Host evidence-guard
  regression independently verifies rejection if an Agent does generate prose.
  Released Oct19 as recorded above; voice/hardware remains unverified.

- Oct18 routing/auth follow-up: public HTTPS `/` and deployed entry bundle already
  redirect to `/kiosk/`; local Nginx agrees. Preserved pre-existing root/PWA edits
  and added the missing root redirect to the deployment script. Oct19 correction: API 401 after
  failed token refresh automatically starts local Webnavior OIDC login; the
  previously added opt-out/banner was removed at user direction. The callback
  restores the original safe local route instead of `/`.
  Entry/login changes were deployed Oct19. Third-party non-WebMCP control remains a
  pending choice (Chrome extension / Electron / local CDP); see
  `plans/2026-10-18-webnavior-routing-and-browser-control.md`. Public Maifood
  HTML was read only; no cart/order/payment or real browser validation.

- Oct18 test-release commit cut: current work is grouped into shared contracts,
  continuation Bridge, ordering/Jev core, welcome administration, Kiosk host,
  and deployment documentation. User explicitly authorized these commits; no
  push or deployment was requested. Full root typecheck passed once. Root lint
  fails on pre-existing unmodified research/other-module files; every commit
  still runs the normal staged-file hook. Menu626, Bridge37 and Kiosk162 unit
  tests pass. Server profile/HTTP53 pass after updating old recipient/price mocks
  and verifying the staged route's four actual questions. Old experiments now
  follow current payment-method selection and bounded query contracts rather
  than expecting removed confirmation behavior or unsafe partial actions.
  Broad parallel checks caused substantial load and database-test timeouts;
  subsequent checks use one worker/package at a time. No check remains running
  after completion. Python cache and unused phone-modal screenshots are left
  untracked. Before deploying, read the test-release section in
  docs/ubuntu-webnavior-kiosk-server-deployment.md: static deployment scripts
  do not start the Order Menu Bridge or preserve an additional proxy by magic.
  Configure its service, allowed origin and public HTTPS URLs first. Payments,
  post-order table binding and pickup changes remain simulated/test-only;
  continuation tokens remain in memory for30min and vanish on Bridge restart.

- Oct18 unfamiliar menu-query recovery (attachment a4c50e1a): 有魚排便當？
  while fulfillment was pending chose NEEDS_ASSISTANT .3454; recipient KIOSK
  .9987 still hit the unconditional weak-handoff refusal. Ordering now separately
  qualifies a pure menu inquiry after recipient verification; weak mutations,
  compound operations, unrelated speech and invalid/weak verification still
  receive no operation authority. No dish-name branches or threshold changes.
  Product-resolution none now distinguishes UNRESOLVED_SUBJECT from category,
  general recommendations, price numbers and ingredient requirements. An
  unfamiliar named dish must retain its literal subject for Agent lookup.
  MENU_QUERY and unresolved filter reads require fresh menu evidence even with
  no known product/category match. Query/filter/price handoffs carry readOnly;
  Kiosk binds it to the existing Agent task and resends inquiry context on every
  continuation. Ordinary mutation/checkout snapshots remain first-request-only
  to avoid stale phases. Server offers read tools only; owned Menu independently
  blocks writes, fulfillment and question effects, even after successful lookup.
  Its read-only cart snapshot creates no new question; new customer tasks reset
  authority. Tests first reproduced the refusal, missing task guard and dropped
  continuation context. Actual configured Jev/Main replay passes four unfamiliar
  queries with/without old fulfillment and four category/general/price/ingredient
  controls; each unfamiliar reply says 查不到 the original name, cart unchanged.
  Server domain267, focused HTTP/coverage50, Kiosk97 plus3 no-evidence guard cases,
  and Menu43 pass; scoped Server/Menu/Kiosk types and changed-file lint checked.
  Live commands use a90s whole-process watchdog, not unbounded provider waits.
  No browser/hardware/voice test, root typecheck, dependency or commit. Routing
  remains probabilistic; the read-only task boundary is enforced independently.

- Oct18 first-order regression correction: attachment aa9a2bda's 水餃一份
  correctly chose ADD .9676, then the combined read/coverage guard misread it as
  READ_ONLY .5171 and refused. Prior live replays seeded carts directly through
  tools, so their claimed coverage missed the first spoken Jev order. Split
  literal requestPurpose (inquiry/operation) from original four-way cartRequest
  coverage. Browser-matched subject supplies balanced purchase/query examples;
  quantities and word order are contrasted without dish-specific code/settings.
  Weak purpose grants no authority and does not veto independently reliable
  route+coverage checks; a weak original route still only hands off after verified
  recipient/coverage. This preserves cancellation and replacement support. Thresholds stay
  unchanged. The extra binary question costs 0.29–0.74s in this replay; twelve
  first orders total1.63–2.24s Jev, excluding TTS. New opt-in provider tests now
  actually skip phone then run the first speech through Jev and inspect the cart,
  with realistic menu candidates and both default/current saved prompt policies.
  All22 first-order/inquiry cases pass (three dishes, one/two/three/five servings,
  Chinese/Arabic numbers, reversed order, explicit 我要, price and variety queries).
  Server252 unit tests pass;
  Kiosk31/Menu81 targeted tests, Server scoped types and changed-file lint pass.
  Final eight-case cart replay also passes: plain add/quantity/remove, whole
  swaps, unknown target preserving original, and companion speech. Actual Main
  completes both swap phrasings; browser guard blocks its attempted deletion
  after missing pizza. One earlier run correctly handed off 水餃換牛肉麵一份
  but Main only queried menus and retained dumplings; the final replay passed
  without Main production changes. Keep this probabilistic execution limitation
  visible; routed requests and mocked tests do not prove completed swaps. No browser/hardware/voice test,
  full-project typecheck or commit.

- Oct18 menu-query / hallucinated-variety repair: reported session
  McJ8clPpBKvNt_XMYWFRq had no-tool invented noodle examples; its later variety
  question was a weak refusal, not literal IGNORE. All current-product/category
  ordering handoffs now project requireMenuRead, beyond MENU_QUERY; old cart
  references alone and non-factual phone fallbacks do not. Shared intent rules
  distinguish dish mention from purchase, and names from extra ingredient filters.
  Proposed ADD/REMOVE/quantity/option effects now check whole-request authority
  even for the first item. READ_ONLY recovers through existing search/conditions,
  never a quantity draft. Recipient qualification uses isolated literal speech;
  conditions retain their original contextual state (isolating prices too caused
  live regressions). Valid question answers/recovered reads do not repeat scope.
  Weak handoff scope may only silence companion speech, never promote a weak
  action; relation NEW_REQUEST verifies recipient before admission. No thresholds
  lowered, per-dish branches, dependencies or merchant settings. Extra finite
  checks add latency (first-item guard superseded by the correction above); reads add
  recipient qualification before conditions. Main also once removed an old dish
  after a failed replacement lookup: existing browser Agent task now latches a
  missing/unavailable named subject and blocks partial order edits until the next
  customer task; late old reads cannot latch a successor. Runtime tests cover
  mixed queries, sold-out targets, fresh-task release and task replacement.
  Live synthetic replay passes30 Jev cases across four tests (including14 prices,
  food varieties with/without history/cart, companion speech and cart changes),
  with six real Main/SSE/owned-Menu flows. Provider replay now initializes accepted
  Fast Path receipts through the actual entries endpoint and binds Agent tasks,
  matching the real host. Targeted Server247, Menu81 and Kiosk31 pass; scoped types
  and lint checked. Browser automation remains disabled; no hardware/voice test,
  full-project typecheck or commit. Arbitrary model wording remains probabilistic;
  the browser guard prevents the reproduced partial deletion independently.

- Oct18 waiting-feedback trial: Kiosk now shows neutral localized progress as
  soon as idle ASR/simulated speech enters Jev, including weak first routes.
  This is display-only; it never admits speech, takes a turn or displaces an
  active Agent/spoken reply. Main progress takes over and retains real tool
  status across SSE continuations/drafts until receipt-grounded presentation.
  useKioskWaitSpeech starts fixed-copy live TTS concurrently for admitted Agent
  work (and deliberate typed retries); playback requires one second still
  pending plus ready audio, once per turn. Fault/disabled-System-One fallbacks
  have no verified recipient and stay text-only. Optional output owns a child
  abort signal, not the order signal: final results, cancellation, new turns,
  manual handover and disposal cancel stale synthesis/playback without touching
  order phase/authority. TTS failure leaves text and execution intact, no retry
  within the turn. Shared existing player now settles/cleans on interruption;
  final audio takes priority. No new settings, dependencies, model calls for
  wording, prepared audio bank or service startup; uses current Site TTS voice.
  User says TTS service is OFF and wants live synthesis once enabled. Unit35,
  scoped Kiosk types and changed-file lint pass; existing Vite scene transform
  HTTP200. Browser UI automation remains disabled; no actual voice/hardware test
  or root typecheck/commit. To preview, refresh Kiosk :5169, skip phone, add
  水餃一份 then say/simulate 水餃不要，改牛肉麵. Visual feedback works with TTS
  off; enabling the existing speech service enables the optional phrase.

- Oct18 cart replacement: attachment 8a3a6bcd's 水餃不要，改牛肉麵 chose
  ADD .3114 while dumplings were already in cart. Previous tests covered draft
  switching, not this whole-request gap; Oct7's similar diagnosis is superseded.
  Existing-cart ADD/REMOVE/quantity/option routes now check single-effect coverage
  before execution, adding one small Jev call. Verified replacement/weak-route
  handoffs additionally isolate recipient (one call); thresholds stay unchanged,
  background speech stays silent, original trace and fulfillment survive. First
  item originally added no calls (superseded by the first-order guard above). Real Jev needed explicit effect descriptions and contrast
  examples: generic proposal descriptions misread 換 as SINGLE; combined recipient
  scope admitted 小王. Final eight synthetic Jev contrasts pass, including pronoun,
  unknown replacement, plain add/edit/remove and companion speech. Main initially
  exhausted the existing host budget because only the latest tool result survived.
  Server now retains paired compact tool exchanges of the latest customer turn
  (four batches/sixteen calls), clearing payloads on a new utterance. Prompt-only
  add-before-remove still failed, so existing order_add_item gained replaceLineId:
  validates both targets/options, retains omitted quantity, synchronously commits
  once and merges matching destination lines. Missing/unavailable/selection-failed
  replacements, invalid config, stale cart/menu/checkout or ambiguous old variants
  cannot remove the original. Receipt contains replacedLine; no extra Jev intent
  or new tool, round-budget increase, third-party transaction guarantee or commit.
  Actual Jev/Main/SSE/owned-Menu replay passes two swap phrasings and absent pizza
  (original retained); one earlier run hit a transient Jev provider failure, then
  the full eight-case replay passed. Server services235, HTTP context regression1,
  Menu85 + machine9, scoped Server/Menu types and changed-file lint pass. Broader
  HTTP suite has an unrelated old price assertion expecting maxPrice in initial
  state although the current contract carries literal amounts; not changed. No
  full-project typecheck, browser/voice/hardware test. Arbitrary compound commands
  remain probabilistic; this fixes bounded routing plus owned-page whole-line swaps.

- Oct18 continuation pickup change: the order-continuation page now offers
  改為自取 before/after table binding, with explicit confirmation and 保留內用.
  POST /v1/continuations/:token/takeout requires confirmed:true and atomically
  changes the test snapshot's required fulfillmentMode to takeout, clearing its
  table. Original POS receipt/payment/order ID/items/total/expiry stay intact;
  this is explicitly a test-only override, with no external POS mutation or
  additional submission/payment. Replays retain pickup; stale table writes get
  409, expired/unknown tokens404. UI updates only after success, clears its own
  pending table-scan token, hides binding controls and keeps pickup on reload.
  Lifespan stays30min/in-memory. Client/SSR9 and backend22 tests, Menu/Bridge
  scoped types and changed-file lint pass. Browser access remains disabled;
  no real DOM interaction test, dependencies, commits or full-project typecheck.

- Oct18 missing table-binding QR after repeated demos: browser gateway kept one
  idempotency key for its entire lifetime, so a later paid dine-in received an
  earlier pickup/expired receipt, showed rewards but got no continuation. Keys
  now correlate with payment IDs and retain late-retry identity. Real in-memory
  Bridge/simulator regressions cover pickup→dine-in, expired dine-in→new dine-in,
  and lost accepted response/replay without duplicate POS submission. Targeted17
  and Menu scoped types/lint pass. Browser completion test now waits for the
  automatic five-second payment and asserts both reward and order QR; browser
  access is disabled, so it was not run. Pickup intentionally has no table QR.
  User later confirmed their reported order was pickup, so its display was
  expected; the independently reproduced repeated-order bug was still fixed.

- Oct18 order-item display focus: 「炸排骨便當2份」 → fulfillment question →
  「還要一份水餃」 added correctly but retained the old visible lookup. Shared
  revealItem now validates operability, focuses the actual catalog card before
  cursor movement and retains it after adding; visible-dialog continuations
  still skip reopening. Display focus updates conversational references without
  resetting recommendation filters/seen history or answering fulfillment.
  Voice/Agent/stepwise contrasts cover dumplings and noodles. Targeted80, Menu
  scoped types and lint pass. Broader recommendationFlow still has the known
  review cursor assertion omitting order:view; unrelated to this change. No
  extra model requests, dependencies, browser/hardware verification or commits.

- Oct18 direct payment-method selection: LINE Pay / 街口支付 now select
  immediately through voice or Agent, without a second confirmation. Latest
  demo shows a genuine QR encoding plain TEST ONLY metadata (no payment URL),
  labels it non-payment, then counts five seconds after image generation and
  requests the existing simulator automatically. No physical scan/button is
  needed. usePaymentSimulation owns cancellation on method/amount changes,
  ineligibility or scope disposal; stale QR work cannot restart it. QR failure
  does not pay; rejected/uncertain results do not auto-retry. Only verified
  simulator/order results advance completion/rewards. Selection still returns
  `selected`, retires the method question and preserves execution/phase locks.
  Follow-up14 (including real QR generation), total targeted96, scoped Menu
  types and changed-file lint pass. Earlier configured-Jev2/host69 also passed.
  Checkout's separate 30s timer returns only an unselected payment page to
  review; invoice/tax-ID never auto-skip. Kiosk idle is 3min then 15s confirmation;
  question-ticket30s expiry grants no choice. Known broader Menu expectations
  still omit clarify/order:view and use the old ingredient-filter title. No
  browser UI, real scanner/payment/hardware test, dependencies or commits.

- Oct18 price evidence and semantic scope: unitless comparisons such as
  `有價格130以下的嗎？` now issue literals alongside unitless ranges; Jev still
  owns interpretation, and the browser owns amounts/execution. Coverage includes
  inclusive/exclusive upper/lower bounds, exact price, independent range ends,
  ascending order, currency/Chinese/full-width forms, new budgets and empty
  batches. Quantity/clock literals remain excluded. Approximation, relative/total
  budgets and unsupported descending order cannot supply executable conditions.
  Key model failure: repeating proposed price descriptions in customer state
  made 不到 choose the inclusive proposal confidently. State now carries literal
  amounts only; alternatives belong to their own question, and food capability
  checks do not repeat them. Food-filter presence explicitly excludes pure
  prices. Exact/range/sorting contrasts use clear finite criteria; thresholds
  were not lowered. A factual phone MENU_QUERY qualifies prices before handoff,
  and host presentation permits its read-only recommendation tools while still
  blocking order edits/skip authority. Configured Jev/Main replay passes14 cases
  through actual runtime and fresh-phase host presentation; Menu123, decision207
  (75 opt-in skips), host68, scoped Menu/Server/Kiosk types and changed-file lint
  pass. Browser UI access is disabled; verified presentation IDs/replies, not DOM
  automation. No voice/hardware, dependencies, commits or root typecheck.

- Oct18 reactive phone-stage greetings: the entry scope now distinguishes
  HELLO_ONLY / REQUEST / BACKGROUND. Reliable HELLO_ONLY maps to existing GREET
  and fixed host “您好！” after one Jev call, without phone skip, question
  acknowledgement or Main Agent. Mixed greetings follow their request. Small
  contrast examples were necessary: adding GREET to the later phone classifier
  diluted order confidence, and broad greeting criteria confused identity
  questions/companions. Final configured-Jev replay passes 22 synthetic phone
  cases, including identity, recommendation, factual menu, skip and companion
  contrasts. A companion may also fail closed as UNCERTAIN_RECIPIENT; the test
  accepts only this quiet refusal, never provider errors or greeting responses.
  Phone unit14, host51, scoped Server types and changed-file lint pass. No voice
  or hardware testing, dependency changes, commits or full-project typecheck.

- Oct18 phone recommendation/ordering prerequisite: phone classification now
  separates factual MENU from ORDER (recommendation, more recommendations or
  ordering). ORDER returns CUSTOMER_ENTRY_REQUIRED, and Kiosk presents fixed
  localized fill/skip guidance plus test number0912345678 without Main Agent or
  WebMCP execution. Explicit skip remains its own authorized transition; factual
  food/identity/phone queries remain available. Agent fallbacks reread live entry
  phase before presentation: recommendation/order tools while pending show the
  same hint, including empty recommendations and blocked writes, not “no matching
  dishes”. Completed entry retains its real result. New diagnostic route labels
  entry waiting explicitly. Jev12 synthetic contrasts, decision199 (75 skips),
  host67 and Server/Kiosk scoped types/lint pass; no voice/hardware test.

- Oct18 category ellipsis / unfinished speech repaired: shared scope understands
  category names with 呢／的有嗎／之類的 as complete browsing. In ordinary
  ordering, an INCOMPLETE with weak confidence or current category evidence
  gets small recipient then speech checks. Only a reliable QUERY can rejoin the
  existing SEARCH/filter/price path; background/unknown recipient grants no
  read, admitted unclear/complete needs reach Agent, and reliable unfinished
  speech still waits. Original route remains rawAnswer; semanticCheck/exchanges
  explain recovery. No fulfillment answer, cart mutation or changed thresholds.
  The first recovery prompt overlapped REQUEST with genuine unfinished speech;
  tightening the mutually exclusive criteria fixed its live contrast. Six real
  Jev category cases plus background/unfinished and three recorded-first-route
  recovery contrasts pass (11 cases total) through the owned runtime. Cart and
  pending fulfillment are retained. Server decision195 (75 opt-in skips), host50,
  Server scoped types and changed-file lint pass. A background contrast can
  take the existing UNCERTAIN_OPERATION refusal instead of IGNORE; both forbid
  read/Agent/old-question effects. The test checks that safety contract without
  lowering thresholds. No ASR/TTS/hardware test.

- Oct18 simulated-ASR trace copy: its expandable System One trace offers
  localized full-source copying with success/failure feedback, following the
  shared error panel's native clipboard pattern. New trace clears old status;
  an in-flight write cannot label a replacement trace copied. Existing panel
  browser10 and Kiosk scoped types pass. No dependency change.

- Oct18 optional phone query reminder: the Kiosk appends fixed localized copy
  once after a verified successful factual menu reply if a fresh service-state read still
  reports customer_entry. Fast Path and Main Agent share this presentation
  policy; identity replies, pending operation questions and failed lookups do
  not consume it. Customer reset clears it; skipped/filled entry during a lookup
  suppresses stale reminders. Acceptance-test modal and reminder now offer
  0912345678 without pre-filling or submitting it. Unit15 and Phone browser9 pass;
  no new model request or voice/hardware testing.

- Oct18 hallucinated menu / ignored corrections: a scoped read of the reported
  local test session confirmed that its second recommendation had NO tool call;
  Main Agent invented three names. A completed no-tool answer was previously
  trusted as dialogue. Phone routing now distinguishes MENU from ordinary ASK;
  normal ordering also admits a MENU_QUERY handoff for disputed menu claims.
  Host projection carries requireMenuRead, JSON/SSE gateway requests require a
  fresh menu_get/menu_recommend call, drafts stay service events, and Kiosk
  rejects no-receipt food prose as a retryable error. Identity/phone FAQs remain
  natural. menu_get verifyClaim with named queries gives an explicit correction
  for absent names or real page availability for present ones; copy is in i18n.
  Current-meal “不要水餃” and “不是要點，只是問有沒有” were both wrongly
  rejected as background by the clerk-context recipient prompt. Classification
  now isolates customerUtterance; current-meal purpose choices are mutually
  exclusive CANCEL/INQUIRY/CONFIRM/NEW_REQUEST. configure:<id>:inquiry consumes
  the live answer, drops only that unadded draft, reads the same dish and never
  revives its quantity question. Other cart lines/drafts remain intact.
  Seven correction/subject-switch contrasts and ten phone/menu/identity live
  contrasts pass with synthetic data, without lowered thresholds. Menu74,
  host82, browser12, Server decision112 (3 skips) and related HTTP cases pass.
  Older route/flow provider mocks were updated to the existing service/purpose
  and phone question contract. Scoped Menu/Kiosk/Server types and changed-file
  lint pass. Configured-provider replay now passes six synthetic cases through
  actual Jev, Main Agent (webnavior/chat -> qwen36), SSE route, owned Menu tools
  and host reply validation. Alternatives call menu_recommend(more:true), disputed
  names call menu_get(verifyClaim:true), and corrections/cancellation leave cart
  empty without returning to quantity. Initial four menu turns took 2.5–4.6s.
  A fresh timing replay separates phone-stage Jev flow (two service/phone calls,
  1.18–1.54s), Main Agent (two SSE round trips, 1.32–2.71s), local tools (1–4ms)
  and total (2.69–4.27s). These include network/application time, exclude speech,
  and are individual samples rather than a latency SLA. Opt-in replay is documented in
  Server README; cross-app fixture belongs in tests/experiments, not Node-only
  src. User excluded voice testing; ASR/TTS/hardware remain unverified. No
  dependency changes, commits or full-project typecheck.

- Oct18 page-availability acceptance trials: development Kiosk admin now has
  **點餐體驗情境測試**, using host-only `kiosk_test_menu` on the development
  owned Menu. Four in-memory states share touch and voice evidence: available,
  sold-out, unknown, selection-failure. No counts or inventory/POS integration.
  Selection failure keeps other cart lines, becomes unknown and produces a known
  item-selection receipt; Kiosk speaks that explanation rather than an uncertain
  write-failure message. Unavailable names remain valid read targets.
  Meal-confirmation availability follow-ups use `inquire-meal:<questionId>`;
  Jev classifies READ and the browser consumes only that live revision-bound
  proposal for a lookup, without purchase/quantity prompts. Different named
  items/categories and conditions cannot inherit this shortcut. A combined
  prompt misread corrections as NO and companion questions as queries. Corrective
  wording now routes correctly; READ additionally verifies recipient using only
  customerUtterance (two calls); ordinary YES/NO stays one call. Background/weak
  recipient results stay silent without lowered thresholds. Synthetic live
  contrasts9, Menu104, Server124 (3 skipped), browser11, Menu/Server/Kiosk scoped
  types and changed-file lint pass. The broader order-machine suite exposed three
  older expectation mismatches (clarification tool list, review cursor action,
  recommendation title); not changed here. Real microphone/ASR/TTS acceptance and
  third-party pages without WebMCP remain unverified/deferred. Reload Menu to
  reset fixture states; admin refresh only rereads them. No new dependencies,
  commits or full-project typecheck.

- Oct18 phone entry now renders as a local host overlay in Stage Kiosk's
  ScenarioSurface ordering region, not a restyled Menu page. Document-wide
  showModal blocked the upper controls; nonmodal show plus a region-local mask
  now keeps avatar/conversation interactive. The 25% mask has no blur and keeps
  the underlying catalog visible/inert. Old Menu phone page is removed; standalone
  Menu opens catalog directly. Host-only kiosk_customer_entry_start offers entry
  for an untouched order, never reopening after phone choice/cart activity.
  The dialog scrolls within short regions. Browser regressions8 cover bounds at
  500/240px and upper clicks. useKioskCustomerEntry observes
  admitted WebMCP discovery/execution and reads phase; submit/skip close only
  after entry advances. Replaced documents/disposal revoke old reads and drafts.
  Host-only kiosk_customer_phone uses phase/10-digit validation
  and callback to its existing transaction phone storage; no phone is echoed
  into decision state. Kiosk and Web exclude this tool from Agent tools.
  Deploy Menu/Kiosk/Server together; no original full-page entry remains.
  Phone-stage food queries now allow Agent menu_get/menu_recommend/
  menu_show_recommendations without consuming the phone choice. A reported
  identity question worked but “我想吃飯” failed: both the broad-exploration
  guard and the entry tool/authorization gates blocked reads after a correct
  NEEDS_ASSISTANT handoff. All those gates now admit menu browsing only;
  selection/cart/checkout still require explicit phone/skip choice. Regression
  covers broad/named queries, recommendations and presentation, preserved phase
  and rejected order writes. Synthetic Jev handoff and phone browser regression
  pass; no model prompt/threshold change or automatic skip.
  Live reproduction: generic entry routing classified a short skip as INCOMPLETE;
  single combined phone classifiers also misread negation/companion speech.
  Final entry uses separate small recipient and SKIP/ENTER/ASK/MENU questions, with
  only customerUtterance as classification data so the clerk's invitation cannot
  be mistaken for consent. Existing confidence gates are not lowered. Seven
  synthetic Jev contrasts pass, including permission questions and negation;
  phone modal browser cases8 plus existing meal cases2, Menu49, Kiosk45 and
  Server107 pass. Physical microphone/ASR-to-TTS acceptance remains unverified.

- Oct18 owned-menu simple clarification implemented: browser issues a unique
  real-item proposal, host-only kiosk_fast_path_clarify creates a 30-second
  confirm-meal question, and voice/touch consume the same revision-bound ticket.
  YES/NO only resolves that item and continues slot collection; no payment or
  guessed quantity. Jev's subject-switch/fragment path separates service admission
  and purpose; ambiguous recipient stays silent. Confirm-meal uses short YES/NO
  in one call. This replaced an unsuccessful broad new-choice prompt in synthetic
  tests; no confidence thresholds were lowered. Normal price evidence stays on
  its bounded path. Unadded meals suspend/resume with their own slots, including
  returning to an already queued item; reset/clear/checkout revoke confirmation.
  Repeated unclear replies stop speaking after one repeat, keeping controls.
  Agent writes cannot bypass an active meal confirmation. New standalone copy
  lives in packages/i18n/src/orderingMessages.ts. Synthetic Jev contrasts and
  touch browser tests passed; real customer histories were not exported.
  Physical kiosk/complete ASR-to-TTS acceptance remains unverified. No new
  dependency, model changes, commits, or full-project typecheck.

- Oct18 welcome modes: existing effective `proactiveVlmEnabled` now selects
  fixed (false) or VLM-generated (true) welcomes, exposed as an explicit admin
  selection alongside its text under **互動體驗 → 開場招呼**. Device overrides
  keep precedence. The selected bank is shown; switching preserves unsaved text.
  Fixed bank and VLM guidance remain independently editable/retained.
  Profile `greetingPhrases` contains 1–50 spoken openings, 500 characters each;
  shared Server/editor constraints show an inline count and block invalid saves.
  A reported 12-phrase save reproduced the former five-phrase limit; its original
  payload was restored to the local draft only, without publishing. Profile
  persistence/boundary tests21 and welcome editor browser tests3 pass.
  Dashboard content editing/publication retains them. Unset uses localized
  generic openings. Kiosk prepares entry/menu audio sequentially and reuses a
  scene-owned in-memory bank across visitors; locale/phrase/device changes or
  disabling/VLM selection/unmounting abort prior preparation. Reload after Server
  TTS changes. Fixed entry welcomes append optional-phone/skip guidance. VLM
  welcomes use the current frame, published `greetingPrompt` and entry/menu phase
  through assistant-actions. Neither mode appends recommendation invitations;
  reminder image policy remains controlled by the same setting.
  Entry/menu/question guards are checked before session start and again after
  cold TTS; real touch cancels proactive work. No persistent/offline audio cache.
  The local test Site has a new immutable release with three 周氏蝦捲 openings;
  its other published settings and prior drafts were preserved. Existing Kiosk
  tabs need reload to fetch this assignment and prepare audio. Current effective
  policy remains fixed on all local test devices; no mode settings were changed.
  Fixed/cache/turn/recording tests31, Server route tests28 and the admin mode
  selector browser tests2 pass (including retained drafts/template banks);
  Server/Web/Kiosk scoped types and changed-file
  lint pass. Prior Profile persistence tests19 and real Vite transforms passed.

- Oct18 ordering presentation now animates before opening the item dialog and
  uses the actual visible item identity to avoid replaying its selection after
  quantity/options answers. Review entry animates **查看訂單** before opening
  fulfillment controls; existing review/checkout reads preserve their surface.
  Synthetic runtime regressions70 and Menu scoped types pass; live Jev/voice
  replay was not performed for this presentation fix.

- Oct18 owned-menu kiosk test: optional phone entry/explicit skip precedes ordering;
  `customer_entry` phase/screen and `customer_skip_phone` support both Jev and
  Main Agent; skipped phone stays absent and host reset restores entry. Invoice input has
  mobile/citizen carriers, tax ID and donation, no paper or timeout donation.
  Donation is now an explicit **略過，捐贈發票** action: touch/Jev/Main Agent
  proceed to payment selection without code input and clear prior personal
  invoice identifiers. Actual recipient/issuance belongs to the future POS
  integration; this fixture does not invent a code or claim an issued invoice.
  Donation/checkout/question regressions74 and embedded mock-payment browser
  cases2 pass (carrier and skip/donation); Menu scoped types and changed-file
  lint pass. The prior label-only change left the code-required state unchanged;
  the domain transition now advances directly, and donation has no input form.
  LINE Pay/街口支付 selection is separate from explicit mock payment. Default
  dev runner uses after-order table binding in Bridge and simulator; reservation
  policy remains separately testable. Accepted test dine-in receipts issue an
  in-memory 30-minute bearer continuation; QR and desktop link share its URL.
  Phone confirms fixed demo A08 after simulated scan; neither UI has a table
  picker. No real camera/POS membership/invoice/payment/robot integration.
  Native-camera tab handoff uses an expiring same-origin pending capability.
  Paid acceptance immediately notifies the embedding host: configured reward/
  survey and a separate continuation QR/link share the completion screen.
  Standalone menu retains its receipt until acknowledgement. The transient
  continuation URL stays outside archived order metadata and clears on session end.
  Jev common scope admits assistant identity/capability questions; plain Agent
  side replies revoke old answer tickets via host-only interruptsQuestion.
  Checkout model context excludes prior chat, preserving durable history and
  current structured cart/browser evidence. Third-party DOM hiding is deferred.
  Focused tests: menu73, Bridge33, Server126 (2 skips), Kiosk54 pass;
  four affected package typechecks and changed-file lint pass. Expanded menu
  suite retains the known recommendation-title mismatch (107 pass/1 fail).
  Browser verified phone entry, both payment brands, QR/link continuation,
  cross-tab table scan confirmation and refresh after binding. Live Jev/model
  and physical-device acceptance remain unverified; no full-project typecheck.
  Reward timing regression reproduced before the fix and passes with the actual
  embedded menu + isolated test payment Bridge. Lifecycle/session tests15 and
  Menu/Kiosk/Web/StageShared scoped types plus changed-file lint pass. Both hosts
  validate the shared interaction-lifecycle envelope; deploy with the updated menu.
  Kiosk/Web Vite now use StageShared package exports, without the old prefix-to-src
  alias. Actual dev-server lifecycle imports reproduced500 before and return200
  after this fix; Vitest alone did not exercise those app-specific aliases.
  Optional-entry regressions: Menu65, Server38, browser2 pass; Menu/Server/Kiosk
  scoped types and changed-file lint pass. Active Jev correctly selected the
  synthetic phone-skip candidate. A synthetic no-history recommendation replay
  used three segmented provider calls (route/filterRequirement/filterPresence);
  keep provider round-trip measurements separate from UI/animation latency.

- Oct17: master now includes the three existing WebMCP commits from
  `to_damai_website`: object-input native API, iframe lifecycle/geolocation,
  and health-check admission. Host and own menu must deploy together. Services
  without the version/challenge probe remain manual-only; there is no generic
  cross-origin DOM automation bridge or automatic retry of ordering writes.
- Remaining work is grouped by behavior: per-provider Main Agent Thinking
  (migration0046, OpenAI-compatible chat only); exact POS category validation;
  Main Agent/customer control handoff with retained settled receipts and distinct
  failure reasons; third-party iframe loading diagnostics; research documents.
  Runtime/setup contracts live in the affected app READMEs.
- Browser evidence: user confirmed physical clicks in Firefox responsive mode
  at1080x1920 with MaiFood. Chrome155/macOS15.5 Device Toolbar cross-site iframe
  input remains unresolved: native coordinates sometimes reach parent IFRAME
  while child receives none; stable rect samples and outer DOM hit stack do not
  establish compositor routing. Device Toolbar OFF with DevTools ON works.
  Minimal wrapper overflow change helped only the minimal reproduction. No
  high-z-index/fixed workaround was shipped; no Windows Edge/hardware acceptance.
  Further browser tests must use trusted coordinate/physical input and isolated
  fixtures; do not inspect the user's Google meeting or submit another order.
- Validation for this batch: Server87, Kiosk recording18/presentation11, menu21
  and Python HAR analyzer5 tests pass. Server, Kiosk and menu scoped typechecks
  pass. Commit hooks run
  changed-file lint. Full repository lint/typecheck from the earlier attempt did
  not complete; do not report a clean full-project gate. Prior broader menu tests
  had known failures (see existing validation notes), not repaired in this batch.
- The System One behavior discussion and model options remain proposals, not
  approved production behavior or measured improvement. Keep frozen experiments
  separate from current application acceptance. Temporary browser target/session
  IDs and raw diagnostic paths are deliberately omitted here.

- Oct9 cross-machine Git baseline saved as four local commits on master, no push.
  User authorizes separate local snapshot commits despite recorded check failures.
  Completed: be4e15c IME (2 files), 68fcf84 Ollama (6), 010bc24 Kiosk (144).
  Fourth group preserves benchmark/evidence (114 files including lint scope config);
  find its hash with git log. No separately packaged portable export yet.
  Installed pre-commit hook runs nano-staged/moeru-lint --fix. First three groups
  used the normal hook. User requested the last group be committed without changing
  data; its hook is skipped for this invocation only, preserving frozen input/result
  bytes and recorded hashes. Global hook configuration unchanged. Do not silently
  format or regrade frozen evidence. No new branch; unused earlier codex baseline
  branch points at22603c2. Remote state not refreshed; no external writes.
  Snapshot preparation repaired diagnostic test assertions against unknown trace,
  screen location, and ASR cart fixture fulfillmentMode, without weakening runtime
  contracts or changing decision behavior. Server and Menu scoped typechecks pass.
  Root typecheck was run twice; second exposed the subsequently fixed ASR fixture,
  not rerun globally. Server selection123pass/6 opt-in skips, Ollama9pass,
  Kiosk116pass, MenuServer30pass, ASR diagnostics10pass/2 opt-in skips.
  Server experimental timeouts under concurrent heavy checks did not recur in the
  sequential rerun. Full Menu suite458pass/156skip/2fail: recommendation title
  expectation and historical resolver query-to-add probe. Keep failures visible.
  Root lint16060 errors included12861 ignored Python dependency errors; scoped
  ignores reduced last measured count to3199, mainly old scripts/frozen inputs/docs.
  Local downloaded models now also ignored, not remeasured. Not a clean release.
  Temporary browser attachments ignored, maintained screenshot baselines committed;
  heuristic key scan has no matches, not a privacy audit. Portable export package
  still planned. Group manifest/logs /private/tmp/airi-git-preparation.3x3Cdy/.

- Oct9 user-authorized retry of four interrupted tool-agent cases COMPLETE,
  separate from first-attempt scores. Fresh synthetic runtimes, same Google26B,
  dataset/prompt/recorded production hashes, guard and max4 rounds; no tuning.
  a03 query/noadd, a04 bento1, a15 correctsecond bento1 complete; no provider/tool
  errors. a11 retains full replace plan but executes cart_get/remove/menu_get/
  cart_get, reaches4-round cap with emptycart and no beefADD/finalreply: partial
  change, not proof more rounds cannot finish. Completion/atomicity seam remains.
  No extra party/mode/payment changes; a15 rawfinal has thought, Host/UI untested.
  Original48 first attempts/four interruptions and missing a04 receipts retained;
  do not pool retry into original scores or infer restart caused improvement.
  results/assistant-gemma4-retry-oct09{.jsonl,Summary.json}, report retry section.
  USER_RETRY=1 metadata only, human-approved fresh-run subset, no automatic replay;
  README documents this exception. 9offline controls/lint pass, live recorder10pass
  is not model4/4 completion. No full typecheck, production writes/customerlogs.

- Oct9 Gemma actual-prompt/tool comparison ALL48 PAIRS ATTEMPTED, NOT ADOPTED.
  First attempts: frozen16 synthetic turns/3arms, no retries/rescoring: Jev front16 settled/
  6 automatic non-safeOnly completions, proposal16/9, actual-prompt tool agent
  12/6 plus4 infrastructure interruptions. Two safety-only cases per arm excluded
  from completion, not accuracy or full deployed pipeline comparison. a09 two
  meals: Jev ADD.8661 -> two-item OR clarification; proposal/tool agent add both1.
  a06 aside then 一位 succeeds all3; agent 改兩份/改內用 succeeds, no extra changes.
  a05 all3 actualnextbatch; a16 UNKNOWN answered honestly, no invented dish.
  Repair a12 fails all3: Jev INCOMPLETE; proposal ADD/nullqty -> reasks quantity;
  agent reasks consent despite prior explicit1. Agent a10 no mutation but binds
  eel's cilantro condition to beef; proposal blocks all unsupported conditions.
  Proposal4 schema rejects (3root arrays/1empty requirements), plus summaryCount/
  contextual flag issues. Agent a13/a14 reply without tools, not silent; UI not
  tested. a05 same-turn newreceipt IDs reenter no-repeat prompt; long thought
  debates ambiguity, finalbatch correct; no causal prompt ablation/fix.
  Actual createKioskRoutes prompt/tool history + scratch development PGlite,
  real Menu invokeForAgent, max4 rounds. No browser/Host task-constraint lifecycle/
  POS/payment; proposal binder experimental/non-atomic, Jev no Main continuation.
  Explicit stored Google26B profile read-only, models/gemma-4-26b-a4b-it; active
  production chat remains gemma4-31b on amdllm.iservmeta.net. No production writes,
  customerlog transfer, prompt retuning/model switch. a03 Oct8 scratch500 cause
  unknown; a04 Oct8 connecttimeout has missing execution receipts, never infer
  its cart. Oct9 a11 connecttimeout onlycart_get, oldbento preserved; a15 Google
  HTTP500 after correctsecond-item menu_get, cartempty. Failures retained.
  46successfulGoogle/3failedgeneration/49preflight +20Jev; recorded quota wait
  1453.09s distinct from251.99s successful generation. Per-turn tool mean14.19s
  generation vs106.95s wall (12settled only); not production performance claims.
  Provider24RPM/12.8K reservedTPM, countTokens serialized proxy+512+1536output,
  no globalRPDledger. Initial CASE_IDS/MODES select unmeasured pairs; batches separated
  by >60s quota window. Raw source hashes retained; report/commands existing
  test_prompt/turnClassifierPoc/{report,README}.md, results assistant-gemma*-oct09
  plus Oct8 profile/rest. Tests apps/server/tests/experiments/assistant* and
  summarizeAssistant.ts. 59offlinepass/1liveskip, changed-runner lintpass; no full
  typecheck. Do not integrate from tiny frozen16 or add more same-model gates.
  Next seam is whole-demand/source/condition ownership + authorized demand vs
  actual receipt reconciliation + explicit per-demand completion/clarification/
  failure contract, validated on independent holdout. Not implemented; proposal
  necessity/Main Agent or Jev replacement remains unproven.

- Oct8 Fast Path off/provider fallback IMPLEMENTED. Kiosk reads authenticated,
  uncached interaction-decisions/status every turn before candidate/direct
  resolution. No active profile -> SYSTEM_ONE_DISABLED handoff; unhealthy active
  profile stays enabled (normal readiness recovery). Jev PROVIDER_FAILURE and
  decision transport rejection -> same guarded Main Agent flow, retaining
  original utterance, pending question, session/history and completed read
  receipts. Semantic uncertainty/IGNORE/INCOMPLETE/clarification remain distinct;
  browser execution failures still require checking screen, never mutation replay.
  No prompts/models/new WebMCP tools changed. Changes apply next turn, not
  retroactive cancellation. Core locations existing kiosk-fast-path.ts,
  kiosk-device.ts, KioskScene.vue and server kiosk/system-one modules.
  Scoped Vitest63 Kiosk +39 Server pass; changed-file lint and Kiosk vue-tsc
  pass. Diagnostic test typing blockers were repaired during Oct9 snapshot
  preparation; Server-scoped typecheck now passes. No browser E2E or live model
  tests during snapshot preparation; see current state for global check limits.

- Oct8 real decision + candidate partition comparison COMPLETE, REJECTED.
  New44 synthetic turns/11families,88 paired modes,129HTTP, all measured with
  openjev/Qwen/Qwen3.5-4B. Existing decideInteraction/code-default prompt + real
  isolated Menu resolver/compiler/guard, NOT saved merchant prompt/host lifecycle.
  Test-only7-group route then finite leaf at.60; no extractor/reviewer/new tools.
  Contract17/44 baseline vs13/44 partition; UNAVAILABLE8 vs28; bothrepair0/4 and
  compoundhandoff0/4. Mean5724.3 vs2535.1ms,57 vs72HTTP; faster often means early
  refusal, not equal completed work. p29groupCHANGE.911/ADD.8309 -> two-meal OR
  clarification; p31group.9103/REMOVE.7478 deletes old bento, never adds noodle.
  p24candidate absent for 總共一個人而已; preserve as parser finding.
  Raw wrongMutation5/2 includes configuration/clarification phase changes;
  receipt audit actual partial cartchanges2/1, wrongpreparation3/1. Background
  rawadmission1 is INCOMPLETE assent, not proven UI/Main admission. p07 gold
  SEARCH vs SELECT ambiguous, but observed ADD preparation wrong either way.
  Screenunknown/artificial5-item menu/saved overrides untested; not production
  accuracy or general4B-size proof. Scoped tests6offline/7live recording controls
  pass,4TS lint pass; no full typecheck/productionwrites/customerlogtransmission.
  Files apps/order-menu/src/experiments/partitionDecision.ts,partitionScenarios.ts,
  partitionReplay.test.ts; command/config README; frozen raw/summary/audit at
  test_prompt/turnClassifierPoc/results/partition-frozen44*. Report existing
  test_prompt/turnClassifierPoc/report.md Oct8 partition section. No tuning or
  integration. Next substantive seam: whole-demand/each-demand completion
  contract; if testing Gemma again use actual Main Agent prompt+isolated tool
  loop, not prior new extraction prompt. Do not add more same-model gates from
  this negative result or silently treat assistant handoff as completed service.

- Oct8 missing-dish complaint reconciliation remains PARTIAL. Attachments600f4a56
  /a6f483f0 retained original multi-dish dialogue, beef alias evidence, pork-only
  cart and fulfillment question. Oct18 now recovers the weak INCOMPLETE family;
  corresponding fixed-choice cases are permanent regressions, not live complaint
  accuracy evidence. A low-confidence ADD (.2836) still refuses safely, and no
  per-demand completion ledger reconciles all requested versus added dishes.
  Do not infer missing items were added, lower mutation thresholds or repair the
  cart from a mention. Live multi-demand complaint recovery remains unverified.

- Oct8 Gemma4 26B extraction follow-up COMPLETE, NOT ADOPTED. Explicit test-only
  override `models/gemma-4-26b-a4b-it`; same frozen40-case prompt/gold hashes as
  prior Gemini, reordered compound/context first, output cap2048. All40 HTTP200;
  34 schema/evidence valid,18 strict exact; compound5/6; mean4431.7ms/P957884.9ms
  excludes token preflight/pacing. Six format failures =5 root arrays +1 empty
  requirements. True risks: checkout「好」->CHAT, 我想吃便當->RECOMMEND loses
  category, bento queries lose target scope, duplicate REMOVE+REPLACE. 一位
  recognized PARTY_SIZE1 but contextRequired false. Other mismatches include
  annotation/flag ambiguities; audit at
  test_prompt/turnClassifierPoc/generativeRequirements-gemma4-26b-pacedReport.md.
  No frozen regrading/tuning or model superiority claim (Gemini only9cases).
  Quota RPM30/TPM16K/RPD14.4K: experimental requestBudget admits24RPM/12.8K input
  TPM via countTokens+128 reservation.80 measured calls incl40preflights, no429;
  actual40,324 input/5,356 output,43.9s pacing.11,520 per-run cap is NOT global or
  persistent RPD ledger; other project traffic/daily remaining unknown. Live
  catalog/pilot precede run.49 targeted tests, scoped lint, strict pure-budget
  typecheck pass; no full typecheck. Runner requires explicit Gemma override
  rather than assuming its quotas for Gemini. Production Gemini/Jev prompts,
  model/session/menu/tools/flows unchanged. Next: sharpen generic proposal/atom
  contract + independent application binding, not direct production integration.

- Oct8 independent generative requirements experiment PARTIAL, NOT ADOPTED.
  Active profile + compiled chat are `models/gemini-3.5-flash` at Google's
  compatibility endpoint. New advisory-only extraction prompt/schema and40
  frozen synthetic cases/50 demands; no gold/menu/customer logs/tools sent.
  Full schema and nullable-union attempts HTTP400 before inference (exact field
  cause unknown); minimal chat/schema probes succeed. JSON-object run received9
  valid outputs before g10 HTTP429 and stopped without retries/key/model changes.
  All9 effects/counts correct, frozen strict-field match4/9; manual audit finds
  g05 gold omits explicit query quantity1 and other mismatches are annotation
  ambiguities/redundant query tags, not proven unsafe operations. Core compound,
  delayed party-size, replacement, retraction cases remain UNMEASURED: no model
  or architecture conclusion. Source of truth:
  test_prompt/turnClassifierPoc/generativeRequirements-json-objectReport.md;
  raw JSONL/summary preserved.45 offline evaluator tests + scoped lint pass;
  full typecheck not run. Isolated modules at apps/server/tests/experiments;
  README documents opt-in command (reruns40, NOT resume), unique artifact labels,
  provider stop rules and credential isolation. Production flow/prompts/models,
  menu, session and tools unchanged. Next: clarify provider availability and
  independently tighten annotation contract/gold before future held-out tests;
  do not regrade or tune frozen run to claim improved accuracy.

- Oct 8 還是內用好了 DIAGNOSED, NOT FIXED. Attachment1842461e follows
  dine-in -> takeout -> checkout-entry question; dine-in candidate is present.
  Jev route incorrectly selects start-checkout .4665; concrete checkout relation
  incorrectly selects defer-question .3911. Relation confidence<.6 correctly
  returns UNAVAILABLE/UNCERTAIN_OPERATION, preventing wrong execution but losing
  the intended fulfillment change. History remains in supplied trace. Minimized
  replay without conversation reproduces; correct dine-in route .95 goes FAST in
  one call. Correcting only relation to NEW_REQUEST .95 still hands off, as in
  the prior beef-noodle recovery finding. fulfillmentDiagnosis.test.ts has3
  passing diagnostic controls; expected recovery probe is known red under
  KIOSK_FULFILLMENT_DIAGNOSIS=1. No production/prompt change or live provider call.

- Oct 8 multi-meal clarification DIAGNOSED, NOT FIXED. Attachment fedc8278
  begins with 對 AFTER original three-meal utterance became item-clarification
  (pendingIntent ADD_ITEM). Display says 您指的是炸排骨便當、紅燒牛肉麵？
  but legal choices are pork OR beef OR cancel, not both. Captured route selects
  pork .8694 and concrete relation repeats pork .7259; Server trusts it and
  runtime resolves/executes only that one target. Full original utterance remains
  in history: not evidence of lost context. Missing initial decision trace means
  initial Jev misrouting is NOT confirmed. Reconstructing the observed ADD path
  with real simulator catalog reproduces the same question and one cart line;
  minimized 牛肉麵一碗，還要一個排骨便當 does too. UNCERTAIN relation control
  leaves cart empty. clarificationDiagnosis.test.ts has3 passing diagnostics;
  expected-safe collective-yes probe is known red under KIOSK_CLARIFICATION_DIAGNOSIS=1.
  No production/prompt change or external provider call; omitted eel/options have
  no execution evidence in the supplied trace.

- Oct 7 有水餃嗎 UNCERTAIN_FILTER DIAGNOSED, NOT FIXED. Attachment
  73501877 has empty history/no question, exact 水餃 reference, correct SEARCH
  route .9657 and COVERED .9523. NO_FILTER probability .746 is not its confidence
  .4919; the final filterPresence guard requires confidence>=.5 and hands off
  NEEDS_ASSISTANT even for this plain dish query. Minimized public decision replay
  retains the symptom without screen/history/other candidates. Holding choices
  and probabilities fixed, .4919/.4999 hand off and .5 passes SEARCH. Three local
  diagnostic assertions pass; expected-safe query remains known red under
  KIOSK_FILTER_DIAGNOSIS=1 in filterDiagnosis.test.ts (run separately).
  Actual trace has 3 sequential provider calls totaling~6.9s; local decision mock
  batches condition questions, so modelCalls differs while modelQuestions=3.
  No production/prompt/threshold/session change and no live provider call.

- Oct 7 牛肉麵一碗 NEW_REQUEST handoff DIAGNOSED, NOT FIXED. Attachment
  9b8c37b5 includes exact beef-noodle alias evidence and ADD candidate, screen
  menu. Jev first selects dine-in .2975; concrete question relation chooses
  NEW_REQUEST .6718, and questionEffect returns NEEDS_ASSISTANT directly rather
  than recovering the independent ADD route. Minimized local replay without
  dumplings/history still reproduces; first-route ADD .95 control passes.
  Opt-in expected-safe probe: KIOSK_NEW_REQUEST_DIAGNOSIS=1 in questionRouting.test.ts
  remains known red. The quoted no-verifiable-menu reply comes from host
  current-turn receipt grounding; its unfinished suffix means Agent send returned
  incomplete (rejection, exception, deadline/limits or duplicate calls can do so).
  No Agent tool/result trace supplied, so exact downstream cause unknown. Do not
  blame the dumpling screen, invent execution success or clear old questions.
  This task only changes Kiosk idle trigger to180s; confirmation remains15s and
  continuing retains all session context. Kiosk27 + Server14 focused tests pass;
  expected-safe diagnostic was separately run red. No live provider replay.

- Oct 7 post-500 ASR stall REPORTED, NOT REPRODUCED OR FIXED. User sees later
  ASR text but no decision requests; failed endpoint/body not yet supplied.
  Two new local probes cover queued handler rejection and queued runFastPath
  decision rejection: later ASR still reaches decision (including after idle).
  These exercise the queue/Fast Path, not the full KioskScene lifecycle; do not
  claim the incident is fixed or that all host waits release. Asked for failed
  request URL/body and following browser/server state. No production change,
  session reset, context clearing or live provider call.

- Oct 7 System One service scope and low-confidence handoff IMPLEMENTED.
  Initial NEEDS_ASSISTANT/MULTI_ACTION/FOLLOW_UP_ACTIVE require finite numeric
  confidence in [.6, 1], otherwise UNAVAILABLE/UNCERTAIN_OPERATION before any
  invitation supersession. Attachment 7e0c1850's raw MULTI_ACTION .2911 is now
  a regular passing regression; traces keep the original answer. Already-admitted
  read-result reviews retain their distinct handoff policy. Prompt/criteria now
  constrain assistant requests and compound actions to ordering service;
  unrelated unfinished discussion is IGNORE, not INCOMPLETE. A fixed scope rule
  follows editable/store instructions without rewriting saved policy and also
  applies to active-question routes. No extra classifier, forward, lexical gate,
  tool, UI, ASR/FIFO or session cleanup change. Server177 + Kiosk60 relevant tests,
  Server typecheck and scoped lint pass; no root typecheck. Eight synthetic live
  contrasts added under KIOSK_SYSTEM_ONE_REPLAY_URL but NOT RUN/exported.
  HIGH-CONFIDENCE OFF-TOPIC MISCLASSIFICATION IS NOT PROVEN FIXED: fb20874f
  (.8784) and 2c567045 (.6155, empty history/no question) still demonstrate that
  reliable-looking scores do not prove relevance. Frozen-provider expected-safe
  probes remain opt-in known red under KIOSK_OFF_TOPIC_DIAGNOSIS=1; they cannot
  measure the changed prompt's real accuracy. Do not claim a Gemini defect or
  fix this by clearing session context or adding same-model review untested.


- Oct 7 ASR dish typo DIAGNOSED, NOT FIXED. 蕉麻雞便當來一份 discovers
  椒麻雞便當 only as fragment 麻雞便當; possible evidence suppresses ADD before
  Jev. Real simulator has no 蕉麻 alias; raw menu_get typo returns no items while
  canonical query works. Test-only alias restores exact/ADD; adding 咖哩雞便當
  yields two fragment candidates, so discovery is not correction authority.
  Displayed-item, selected-item and recent-cart context controls still suppress
  ADD for the typo, isolating candidate gating rather than absent context.
  Oct 7 排骨的一份 trace has the recommendation dialogue but only fragment 排骨
  and no ADD candidate; Jev chooses INCOMPLETE despite its completed-demand rule.
  Presentation/no-presentation controls both suppress ADD. A fixture-only 排骨
  alias restores ADD and parses quantity 1, isolating target evidence gating;
  this does not establish how live Jev would choose with corrected candidates.
  asrNameDiagnosis.test.ts:10 local diagnosis assertions pass; known-red expected
  order-candidate tests gated by KIOSK_ASR_NAME_DIAGNOSIS=1. No production change,
  external transcript export or live Jev test; cannot claim observed model choice.

- Oct 7 price-qualified reads implemented through existing SEARCH_MENU/RECOMMEND
  and menu_get/menu_recommend, no new intent/tool/classifier/review layer. Menu
  pricing owns integer single-dish bounds, exclusivity, ASC ordering and literal
  finite evidence; shared wire types are server priceContracts (no tsconfig hack).
  Browser validates priceChoiceId from one-use context; Server asks optional price
  with existing read conditions, retaining thresholds. Appended capability rule
  applies to saved prompts without database overwrite. Price/category/food filters
  intersect before 3-item batches; alternatives retain conditions and seen IDs,
  empty results clear UI, cards keep actual prices without mandatory speech.
  Agent task bounds cannot widen; unresolved/approximate/relative/total budgets
  clarify, with read/mutation guards. Focused mock/runtime/API/host regressions
  pass; six synthetic priceReplay provider cases remain opt-in, not accuracy proof.
  Ordinary questions/cart/session lifecycle retained. This does NOT fix the
  separately recorded Jev fresh-vs-more semantic misclassification below.

- Oct 7 Stage Kiosk text mode now has only the simulated-ASR input; the duplicate
  direct-chat composer/events/styles were removed, not Agent escalation/retry.
  Browser regressions cover single input, forwarding and unchanged voice-only
  mode plus IME behavior (12 passed with VITEST_BROWSER_CHANNEL=chrome).
  Stage Kiosk package typecheck and scoped ESLint pass; no root typecheck.
  Browser config uses the production Info plugin for shared build metadata.
  User clarified completion CAN reset: confirmed
  completion clears chat/menu/customer after the existing completion screen
  finishes. Explicit new-order/staff reset still clears. Unconfirmed or repeated
  old completion dismissals cannot reset an active next-customer session.
  Actual Menu accepted-order -> host completion -> runtime reset regression,
  continue/new-order and approved-origin tests pass (Kiosk13); Menu7 focused
  submission/confirmation tests pass. No Jev/prompt/tool/payment-policy change.
  Attachments 3c641513 (水餃再一份好了) and bc54ac01 (略過 membership,
  UNCERTAIN_OPERATION) do not contain a successful submission receipt.

- Oct 7 repeated alternatives DIAGNOSED, NOT FIXED. Attachment196c07ec says
  還有其他推薦嗎; previous batch/dialogue + recommend-more candidate are present,
  but Jev chooses recommend confidence.942 (.9454 vs more.0182). New recommend
  compiles without more and resets seenIds, reproducing dish0/1/2 with recorded
  finite answers against synthetic real runtime. No customer trace exported.
  Opt-in known-red test in recommendationFlow.test.ts via
  KIOSK_RECOMMENDATION_DIAGNOSIS=1 (see decision-review9.1); default14 batch tests
  pass. New artificial live 無cart「還有沒有其他推薦」passes once, NOT customer fix
  or evidence error is impossible. Formal route/prompt/model/tools unchanged;
  no automatic semantic-review layers or threshold changes. Customer trace lacks
  execution receipt; local replay proves mechanism, no live DOM claim.

- Oct 7 candidate-blind requirement PoC completed; NO production integration.
  `requirementScenarios.json` freezes26turns/32hypotheses (24new wordings plus
  n13麵一碗/n16一位 known regressions). Extractor sees utterance, dialogue and
  question TEXT only; no menu/candidates/plans/targets/slots/classifier. Five
  finite questions: first/second effects, count, information, reference. Two-atom
  capacity is bounded; multi/overflow/contextual/unknown requests refer.
  Real4B57HTTP/0failures:26blind+31unchanged matched reviewer calls. All26 profiles
  INCONSISTENT, exact0/26;24repeat first as second, NONE never chosen for second;
  all5multi turns countedONE. No usable coverage/false-admit0 is NOT success.
  Blind mean4181ms/P95=4532ms; matched reviewer2494ms/P95=3292ms, falsely accepts9/19
  unsupported hypotheses and retains12/13 supported. Do NOT silently deduplicate
  repeated effects: n22 genuinely has ADD+ADD. n13 firstADD correct but inconsistent
  second; n16 receives retained question yet firstREFERENCE, not lost session data.
  Published lookski core.py includes instructions and independently answers each
  question against unchanged state, no shared extraction/dependency; deployed
  commit/backend not inspected. Both model/task fit and ontology/prompt remain
  confounded; this rejects this extractor, not all layered architectures.
  Offline40passed/26guarded skipped, live66passed (harness, not accuracy), Menu
  typecheck/scoped ESLint and summary/fingerprint checks pass; no root typecheck,
  prompt/threshold retuning, new deps/settings/restart/tools/payment/commit.
  PoC report phase4/raw+summary/README are source of truth. Stop here; any further
  extraction design comparison needs another independent test, no auto integration.

- Oct 7 isolated effect/whole-request review completed; NO production integration.
  Frozen32 synthetic good/bad hypotheses (not classifier predictions) reuse real
  resolver/compiler/guard via `apps/order-menu/src/experiments/effectCoveragePoc.ts`.
  Six finite diagnostic outcomes cannot produce target/slots or execution rights.
  Jev Qwen3.5-4B29HTTP/0failures; fixed threshold.60 falsely promotes9/18 bad
  hypotheses, retains13/14 good;3preflight rejects included in bad rejection9/18.
  Same price question approves both SEARCH(.9793) and ADD(.9679); compound partial
  effects also approved above.95. Four unknown ingredient/nutrition queries safely
  referred, but this does not establish general safety. Additional HTTP mean5270ms,
  P95=6848ms; no upstream decision or production latency measured.
  Same-model approval layer REJECTED for adoption; no prompt/threshold retuning.
  No cart writes/tools/payment; fresh-revision and separate payment-confirmation
  tests hold. Live79tests passed means runner contract, NOT semantic accuracy.
  Offline47passed/32guarded skipped, Menu typecheck and scoped ESLint passed.
  See PoC report phase3 and raw/summary artifacts; no root typecheck/commit.
  Candidate-blind follow-up is recorded above; still not authorized for production.

- Oct 7 independent resolver challenge completed; NO production integration.
  `test_prompt/turnClassifierPoc/resolverScenarios.json` freezes40 new synthetic
  contexts; `apps/order-menu/src/resolverPoc.test.ts` reuses real Menu runtime and
  Server finite decision interfaces in memory, with no POS/payment gateway.
  Frozen/SetFit checkpoint+validation temperatures unchanged, both29/40 turn labels.
  Real Jev40/55HTTP/0provider failure, semantic mean5292ms; not eight-class latency.
  Original raw summary retained; separate audit excludes r23 (identical dumplings
  merged, intended multi-line fixture never established). Other39 yield19 effect
  matches, not request-completion/production accuracy. Two wrong draft/clarification
  phases, no claim of accidental cart additions in these live cases. Forced wrong
  query→ADD and compound→single ADD tests prove legal target/slots cannot repair
  semantic mistakes. Stale-revision/payment-confirmation guards hold; query+55s
  idle→一位 works, but 總共一個人而已 has retained question and missing numeric slot.
  Experimental read-only singleton bypass REJECTED: SetFit .70 accepts3/39 but
  peanut question only returns dish name; .80 still accepts it, .90/.95 accepts0.
  No finite topic match is not proof of complete request coverage. Projection
  effect-match gain20/39 is that unanswered fact query, not a quality improvement.
  Contextual referrals still use finite Jev; independent Reference Resolver is
  NOT implemented. Full raw/audit/report in PoC; no retuning/production exports/
  settings writes/restart/customer export/commit. Live runner135 tests passed,
  subsequent focused offline161 passed/40guarded skipped, Menu typecheck+TS lint
  passed; no root typecheck. Subsequent effect/query-scope/full request-coverage
  experiment is recorded above; still no automatic integration or phrase patches.

- Oct 6 independent Turn Classifier PoC completed at `test_prompt/turnClassifierPoc/`:
  user explicitly requests no production integration. 400 hand-authored synthetic
  utterances, 8x50, frozen240 train/80 validation/80 held-out. Dependency-free Python
  audit/Jev benchmark/metrics/referral simulation runner plus local `runLocal.py`.
  User approved MiniLM frozen head + similarity baseline + SetFit. Isolated Python3.13
  venv/cache/models ignored; root dependency graph untouched, pins and full freeze saved.
  Jev8-class turn-only baseline80 valid,47 correct,macroF1.5742,HTTP mean1682ms,
  P952063ms,raw confidence ECE.1768. NOT production Kiosk accuracy. Outputs/report
  retained in PoC. Fixed seed42/C1, SetFit60 steps, validation-only temperatures:
  frozen58/80,similarity54/80,SetFit59/80; warmCPU1thread~8ms on AppleM4/16GiB;
  fresh-process imports+load3.35–3.85s,peakRSS1171–1214MiB,weights448.81MiB.
  Jev validation80 completes; calibrated test ECE.1243 vs raw.1768, choices unchanged.
  SetFit calibrated ECE.1079; .70 mixed class error27.5%/projected1000ms vs allJev
  41.25%/1682ms BUT2compound turns wrongly domain-referred. .95 accepts11 correct
  labels (4contextual/7nonexecution),ZEROdomain coverage. No model/threshold adopted;
  NOT safe to integrate merely from these scores. Full comparison/reliability/raw
  outputs recorded. Referrals are not oracle-resolved domain operations. Initial
  Python default-UA403 batch retained separately; explicit `airi-turn-classifier-poc/1`
  UA succeeds. Only new artificial speech transmitted; other relevant threads read
  for design/failure families, never exported. No production edits/config writes,
  service restart/root typecheck/commit. See decision-review section12 and PoC report.

- Oct 6 authorized synthetic Jev prompt comparison completed against
  `openjev/Qwen/Qwen3.5-4B`: 26 fixed scenarios, 18 development/8 holdout.
  Frozen reported policy baseline15/26, candidate-only15/26, instruction-only15/26,
  combined13/26. Instruction-only fixed named add but regressed invitation refusal;
  combined also regressed colloquial add. NO proposal adopted or persisted.
  Baseline standalone existence query chose ADD confidence0.8199; isolated runtime
  replay entered configuration/cart0 (not immediate purchase). Some improved read
  routes still stop at UNCERTAIN_FILTER: NO_FILTER0.6213 conflicts with
  beef=INCLUDE0.2644 in a follow-up probe. `apps/order-menu/src/semanticReplay.test.ts`
  preserves opt-in comparisons and full case reports; see decision-review section11.
  Only new synthetic dialogue/menu/state was transmitted, never customer traces.
  Local90 passed/26 guarded skipped; Menu typecheck and touched ESLint passed.
  Live failures remain intentionally visible; no root typecheck or commit.

- Oct 6 finite question answers implemented for eda15e0f「好啊」route0.5289:
  the invitation-specific early confidence gate and generic ANSWER are replaced
  by one concrete-answer check at the existing decision seam. Selected question
  effects resolve current owner-supplied choice IDs or NEW_REQUEST/BACKGROUND/
  UNCERTAIN. Route is a hypothesis; answers can correct consent/refusal and use
  their own confidence >=0.6. Independent route thresholds remain unchanged.
  State/criteria consistently use DECLINE_INVITATION; Server no longer guesses
  party/tax-ID answer IDs from purpose. The existing `relation` key is preserved
  for diagnostics; questionRelation records the questionId and actual choice.
  Uncertainty returns UNAVAILABLE, preserving context without Agent fallback or
  even a guessed deferral. Known independent new demands use the existing handoff.
  Financial/destructive one-use confirmation stays separate. Local runtime tests
  cover retained invitation→55s idle→recommend3/cart0, corrected refusals, slot
  answers and payment-method→confirmation→one payment. Guarded synthetic Jev
  invitation replays were added but NOT run; remote accuracy remains unverified.
  Validation: 239 focused local tests passed (Server128/Kiosk47/Menu64), ten
  guarded live replays skipped; three package typechecks and touched ESLint passed.
  Root typecheck was not run.
  No new tool/UI option, live settings write, restart, customer export or commit.

- Oct 6 question-context routing implemented: d913b030「排骨便當一份」regression
  previously stopped at invitation ACCEPT confidence0.4568 before route (high
  confidence also failed because recommend was not offered). All utterances now
  route first; invitation and ordinary speech/relation pre-gates are removed.
  Only selected question effects validate ANSWER/NEW_REQUEST/BACKGROUND, including
  next-turn party-size/tax-ID slots. Configuration/clarification NEW_REQUEST uses
  the existing one-ticket host reroute without pre-relation. Unfinished speech
  continuation is an optional route, not a compulsory context gate. Candidate
  shaping preserves explicit state-legal operations while blocking implicit meal
  mutation from a bare acknowledgment. No new tool or customer-facing option.
  Invitation acceptance is consumed only after successful decision validation;
  verified independent demands return supersededQuestionId. Scene checks the
  current ticket and invitation ID, retaining answered/superseded history without
  letting later「好」revive an old invitation. Ordinary unanswered meal/service
  questions still survive queries and idle; reset requires successful completion
  or an explicit new order.
  Independent route thresholds, destructive/payment confirmation and revision/ticket
  validation remain intact. Local deterministic provider mocks cover the captured
  error and actual runtime alias/seat/draft flows, including「我想吃麵，一碗」and
  「這裡吃」→query→55s idle→「一位」. Validation: 214 focused tests passed
  (Server105/Kiosk45/Menu64); six guarded live replays skipped. Three package
  typechecks and touched ESLint passed. Remote Jev accuracy is not verified; no
  customer export, live settings write, restart, root typecheck or commit.

- Oct 6 Ollama residency implementation: AI binding compiler sets upstream
  `ollamaKeepAlive: -1` only for Ollama chat/vision profiles; schema preserves it
  and router sends `keep_alive: -1` per upstream attempt, streaming or unary.
  Other providers/fallbacks stay unchanged. Stage UI Ollama provider's prior
  value 1 also becomes -1. Existing persisted Kiosk bindings need re-Apply in
  Webnavior AI after Server loads this code; restarting alone doesn't recompile.
  Latest official Ollama openai.go accepts/forwards this extension, despite older
  docs/issues reporting unsupported. Deployed Ollama version/residency not checked;
  old versions may ignore it, requiring OLLAMA_KEEP_ALIVE=-1 on Ollama itself.
  No preload, service restart, live config write or remote inference performed.
  Validation: 60 focused tests passed, Server typecheck and touched ESLint passed;
  no root typecheck or commit.

- Oct 6 five approved fixes implemented: recording shares finite metadata routes
  (fast_path/execution_failed/unavailable) and preserves questionId; failed ASR is
  diagnostic, not completed dialogue. Proactive actions issue host-owned
  recommendation-invitation receipts, retained through idle until successful
  completion or an explicit new-order reset;
  Menu questions/active Agent/configuration/checkout have priority. Confident
  acceptance selects existing intent:recommend only, no new WebMCP tool/payment
  authority. Main Agent ordering prose is an internal draft; Scene renders all
  distinct same-turn menu receipts and factual base-price comparison, or a safe
  no-evidence message. Cart-only replies use actual cart data. Free-form model
  explanations are not preserved as verified facts; omitted/wrong query filters
  still require investigation rather than blaming the renderer. Runtime person
  count reveals/registers the select and awaits visual cursor before one update,
  with no second DOM click. Pose uses shared configured dwell/empty-reset/minimum
  people policy plus geometry/quality/cooldown gates; one pose candidate cannot
  meet minimum >1. Customer-specific vegetarian trace still unavailable.
  Local red/green regressions, targeted unit tests and four actual Chrome browser
  tests passed. Kiosk/Menu/Server package typechecks passed; touched ESLint checked.
  Guarded live replays skipped; no remote inference/customer export, root
  typecheck, settings mutation or commit. Checkout 「好」 intermittent failure
  remains unconfirmed; correlate its next captured question/decision/tool receipt.
  Greeting-generation latency explicitly remains out of scope.

- Oct 6 effective-settings diagnosis: latest-used device DEV-088065
  persisted v10 resolves to observation/greeting on, presence trigger, 500ms
  dwell, pose_plus_conditional_face, confidence0.8, VLM off. Delegated local
  overrides beat admin pose_only/467ms; audit records the local mode change at
  2026-10-06 05:19:08 Asia/Taipei, not an unexplained default reset. Browser
  current loaded browser snapshot was not inspected. Current source syncs every
  15 seconds; the earlier five-minute note is superseded. Presence trigger does
  not require gaze/face checks. Persisted settings were not changed by this task.

- Same-order retention (Oct 7 corrected idle expiry): Stage Kiosk uses shared
  `resetPolicy: confirmed-completion` with three-minute inactivity and a 15-second
  confirmation countdown. Showing the dialog retains all context; continuing
  cancels reset and preserves the same customer/chat/visitor/menu, pending questions
  and requirement state. Unanswered expiry resets to a new standby chat and ends
  the durable visitor; next activity creates a new customer. Late/premature idle
  callbacks cannot reset a resumed session. Pending work/presence protection unchanged.
  Confirmed completion followed by its screen's
  dismissal/countdown, or explicit new-order/staff action clears customer/chat/menu
  and ends the durable visitor session. Stage Web keeps its default45s+15s policy.
  Host/runtime regression covers continue at194.999s -> retained party question ->
  一位, interrupted order draft, actual expired reset and guarded completion.
  Order Menu read tools/plain replies/defer no longer clear ordinary `waitingFor`;
  repeating the same fulfillment is idempotent and has its existing candidate.
  Question records retain statuses in host-only `questionHistory` until reset;
  same unmet needs rebase on revised state without reviving old execution tickets.
  Recommendation conditions/seen IDs and displayed item focus no longer have an
  idle TTL; catalog changes still require revalidation. Local regression covers
  「這裡吃」→lookup/defer→55s idle→「一位」 and new-order clearing.
  Jev semantic selection has not been replayed remotely; retained context is not
  a guarantee against model misclassification. Browser reload/process restart
  does not restore these in-memory menu records. No customer data exported.
  Validation: Order Menu201 passed/15 guarded live skipped before the final
  focus/batch TTL changes; afterward42 directly affected tests passed. Kiosk53
  targeted lifecycle/recording/fast-path/question tests and both package-scoped
  typechecks passed, as did touched-code ESLint. No root typecheck or commit.

- Oct 6 scope correction: the user requested removal of customization options
  from the menu data, NOT deletion of configuration decisions or ingredient
  conversion capability. The earlier mistaken filter/result/prompt edits were
  restored. The seven-dish JSON now has empty optionGroups throughout; noodles
  remain NT$150, dumplings are fixed at 10 pieces/NT$80 per serving. Quantity,
  configuration tools and safety validation are retained. Configuration tests
  use explicit test-only POS options rather than the active store declarations.
  Reload/restart the simulator/POS Bridge when JSON watching has not refreshed,
  then reload menu/Kiosk for a fresh session. This does not fix the separate
  hallucinated recommendation output gap addressed above. Validation: Order Menu191
  passed/15 guarded live skipped, POS30 passed, both package typechecks and
  touched ESLint passed. No remote Jev replay, full-project typecheck or commit.

- Oct 6 category/name and pending-question fixes are implemented across Order
  Menu, Server decision service and Kiosk Fast Path. `catalogEvidence` separates
  full names, merchant aliases, possible fragments and category member counts.
  Inferred suffix uniqueness no longer grants mutation authority. Category-only
  preferences browse even singleton categories; explicit quantity preserves
  ordering, tested for both 「我要吃麵，一碗」 and 「我想吃麵，一碗」. Category
  clarification displays eligible dishes without selecting/adding one and asks
  「您指的是…？」. The reported per-item repeated 「操作」 was never reproduced;
  user will supply a new occurrence. The known application phrase is removed.
  Configuration/clarification first establish actual-question relation. One
  same-utterance/question-ticket host reroute handles a new request: queries
  retain the old draft, verified new meals replace it without inherited slots.
  A query's own clarification takes foreground priority before resuming the meal.
  Bare exact choice/ordinal shortcuts remain; embedded query words cannot select.
  Same-session idle/continue retains drafts and questions; per-turn 30s/15s
  answer tickets expire without wiping valid context. New order/reset,
  cancellation/replacement and relevant revisions still revoke the demand.
  High-risk confirmation and confidence thresholds are unchanged; the later
  same-order correction above replaces idle auto-end and ordinary-question
  clearing behavior. No new Agent-facing tools, remote Jev configuration changes or
  customer-log export. User says PROVIDER_FAILURE was their resolved network issue.
  Local mock-model/runtime flow and stale-ticket regressions pass; remote Jev
  semantic accuracy has not been revalidated for this change. Reload Kiosk/Menu
  and ensure Server watch has loaded the new code for a fresh test session.
  Validation: Order Menu185 passed/15 guarded live skipped; Kiosk46 targeted
  session/fast-path/question tests passed; Server82 decision/route tests passed
  (25 guarded live skipped). Three package-scoped typechecks and touched ESLint
  passed. No full-project typecheck or commit.

- Oct 5 broad menu exploration is bounded: `SEARCH_MENU` without an explicit
  product/category/food condition compiles to existing `menu_recommend`, max
  three dishes. A valid batch becomes `more:true` with its recommendation
  revision; filters/budget/strategy and seen IDs persist, batches replace rather
  than accumulate, and exhaustion never recycles. Broad reads have no extra
  recommendation continuation. Explicit searches retain `menu_get`; its Agent
  default/display:true broad reads apply the same policy, while display:false
  permits internal full-catalog lookup. Broad presentation cannot escape checkout
  or payment locks. No new tool, candidate ID, button or Server/Jev prompt change.
  Reload Order Menu + Kiosk. Local validation: Order Menu172 tests, Kiosk32
  relevant flow tests, Order Menu typecheck and touched-code ESLint passed;
  existing native-listener warning remains. After explicit approval to send
  simulated catalog/runtime state and artificial dialogue to
  openjev.aikcitri.qzz.io, one live three-turn regression passed (3/3/1, no
  repeats or continuation). This is fixture coverage, not whole-UI acceptance.
  No customer history was exported, no root typecheck or commit.

- Oct 5 bounded catalog shaping now caps model targets/clarification at five;
  overflow hands off, never top-N selects. Order Menu keeps exact names distinct
  from literal-fragment possible products and ingredient mentions; possible
  products only become read queries after finite product/filter interpretation.
  No new mutation authority or fixed extra question. Existing condition gate
  distinguishes product/filter/both/uncertain, and skips polarity forwards for
  product lookups. Combined/uncertain requests hand off intact. Final read review
  contrasts original speech, tentative understanding and actual results;
  SATISFIED (confidence >= .6) maps to COMPLETE, DEVIATED/UNCERTAIN hand off with
  receipts but without rejected mandatory filter authority. No automatic restart.
  New 7/50/200 catalog, runtime and handoff regressions cover the policy. Two
  artificial live OpenJEV cases passed (product query, single-dish drift review);
  broader semantic/whole-UI acceptance remains unproven. Restart 5168 Server and
  reload Kiosk + Order Menu; no remote model change or commit.
  Validation: Order Menu163 tests/14 guarded skips, Kiosk89, Server scoped77;
  three package typechecks and touched-code ESLint passed. Final bounded-result
  preview change passed51 relevant Order Menu tests. Existing listener warning
  remains; no root typecheck or whole customer UI acceptance claim.

- Oct 5 Application target resolution now records reference provenance and named
  item/category eligibility constraints in Order Menu `kiosk-intents.ts`.
  New categories supersede conflicting prior fragments/presentation focus;
  category purchases expand only to real available category dishes and clarify
  ambiguity before configuration. Mutation targets cannot bypass explicit
  item/category restrictions; verified composition filters qualify ADD/SELECT,
  while unknown/customization-needed facts hand off rather than invent matches.
  Option edits keep the existing POS slot path. `resolveIntent.targetResolution`
  exposes origins, constraints, eligible refs and rejections in execution traces.
  No Jev engine/prompt/threshold change or live customer replay. Unit regressions
  and a real local runtime lookup→category clarification→configuration test cover
  the reported wrong continuity; remote semantic selection is still independent.

- Oct 3 approved staged flow is implemented in Server decision `stages.ts`,
  Kiosk device/Fast Path/Scene and Order Menu. `segmented:true` starts an owned
  decision; authenticated POST continuation IDs are one-use, device/session-bound
  and expire after 15s. Every Jev question is a separate request/checkpoint, with
  physical exchange timing and modelQuestions; filter questions follow read route
  selection only. No generic second classifier/prompt-example expansion. Context
  shaping and revision/confirmation/payment authority stay in application code.
  Qualified route shows one user bubble; speech-only/background does not. Real
  read receipts display before optional review; at most one extra read then final
  COMPLETE/Agent decision. Whole utterance ceiling24 questions. Error envelopes
  are rejected, execution transport loss is unknown with no auto mutation retry.
  Three-second INCOMPLETE relation uses separate fragments bound to state; one
  unresolved clarification answer ends its issued session, background does not.
  RETURN_MENU/menu_open preserves cart and rejects checkout/payment locks.
  Main Agent tools serialize, cap four rounds/16 calls/60s model wait, preserve
  rejected receipts and report incomplete without generated success/retry.
  Source-of-truth section5 of `docs/research/2026-10-02-jev-decision-review.md`
  retains the before/after flow and integration limits. Live artificial segmented
  replay passed menu lookup/card (2/3); background phrase returned INCOMPLETE
  instead of IGNORE, no mutation. Strict failing regression remains; do not
  weaken it or claim semantic acceptance complete. No actual visitor export,
  remote model configuration change, root typecheck or commit. Restart Server and
  reload Kiosk/Order Menu for these transport/runtime changes.
  Validation: Kiosk88 Node tests; Order Menu152 passed/14 guarded live skipped;
  Server scoped decision/context/stages/routes74 passed, followed by the final
  tool-name-redaction regression in the49-test decision suite; Chrome20 passed.
  All three package-scoped typechecks and touched-code ESLint passed. Scoped
  diff whitespace check passed; inherited CRLF warnings in unrelated UI files
  were left untouched. Whole Scene/customer/POS/payment acceptance remains a
  separate integration exercise, not proven by these component/fixture tests.

- Oct 3 approved catalog/decision changes: source POS option groups now reach
  the browser. Beef noodle is 紅燒牛肉麵 (牛肉麵 alias), required 大辣/小辣/微辣,
  no bowl sizes. Dumplings are 8 per piece with 10/15/20-piece serving options
  priced 80/120/160. Missing ADD_ITEM servings/options ask using a revision-bound
  session-owned pending domain plan with 30s answer tickets; 顆 never becomes serving quantity. Configuration answers
  remain finite Jev choices, finish through compile/authorize, reject stale/expiry/
  replay, and new requests revoke this unadded plan before Agent handoff. Required
  options are not defaulted in touch UI. The generic post-route speech qualifier
  is removed; relation/greeting/filter checks and deterministic safety remain.
  User explicitly deferred token/candidate/output pruning and latency attribution.
  No remote Jev/Ollama configuration or live customer replay was performed.

- Oct 3 POS composition now records shrimp/fish instead of generic seafood for
  the two relevant dishes. Shared food-group matching preserves seafood filters
  and vegetarian contradiction checks. Generic seafood facts do not prove shrimp
  or fish absence; group customization requires removing all matching facts.
  Spiciness was discussed as taste/configuration, not added as an ingredient;
  no unverified per-dish heat levels or remote Ollama settings were written.

- Oct 3 visible screen context now flows from Order Menu's actual Vue state
  through WebMCP snapshots, validated Kiosk transport, every Jev gate and Agent
  handoff. `interactionState.screen` is menu/cart_review/item_configuration/
  checkout, independent from business phase and never execution authority.
  RETURN_MENU and truthful error receipts are now added by the staged work above.
  AIRI calls remote Jev `/v1/systemone` with state/questions; no Jev-to-Ollama
  adapter or remote residency configuration is available in this repository.
  Missing keep_alive on AIRI's Jev request is not evidence of Ollama unloading.

- Oct 3 customer traces expose unresolved non-greeting issues: supported pork
  exclusion slots were correct but route chose Agent; shorthand 牛 lacked a beef
  ref; missing ADD_ITEM quantity and generic qualifier are fixed as above;
  我還要點菜 now has RETURN_MENU. Previous checkout speech reported a generic success
  while the next real snapshot remained ordering. Native runtime returns ok:false
  error envelopes; Fast Path now rejects these without reporting completion.
  The exact original checkout error is still unknown. The ASR test panel
  now shows the measured utterance, cumulative API wait, actual call count and
  Server/Jev exchange time (network included), excludes queue/flush/tools/TTS,
  and marks incomplete accounting unknown. Do not attribute latency to input or
  output tokens without provider usage/profiling, and do not export these actual
  customer trace histories to Jev under the earlier artificial-fixture permission.

- Oct 3 GREET is implemented as a non-operation semantic result, distinct from
  companion/background IGNORE. A finite recipient/purpose check verifies GREET
  choices; no keyword intent classifier or relaxed confidence gate. Greetings
  do not answer clarification/high-risk confirmation, mutate orders, consume an
  ordinary pending question or interrupt an existing Agent task. Kiosk replies
  “您好！” with ordinary TTS and the existing configured greeting motion; the
  inspector labels it separately from webpage execution. Live artificial Jev
  replay passed directed greeting, greeting during checkout-entry question,
  companion greeting and greeting plus ADD_ITEM (4/4). User will perform whole
  Kiosk integration testing. Budget/strategy Fast Path extension is deferred,
  not a required gap. Existing animation wiring is present; do not call it absent.
  Partial unexecuted Jev interpretations are not a required Agent constraint:
  preserve the full user request/context and verified facts/read receipts instead.

- Oct 2 bounded-decision improvements are implemented locally, not all six
  approved stages complete. Every Jev gate receives phase/role context; trace
  retains exchanges, durations, actual call counts and refusal reasons even on
  later provider failure. Conservative normalization preserves short speech,
  numerals and pronouns. Read continuation now uses the whole-utterance question
  ceiling and one-extra-read/final-review bound described above.
  Pending-confirmation NEW_REQUEST revokes that exact confirmation before Agent
  handoff, never executes it. Host-only kiosk_agent_task binds known read filters
  to a task ID/menu revision for five minutes; older cleanup cannot clear a newer
  task. Main handoff includes completed read receipts and conditions. Agent read
  and presentation tools intersect task conditions; stale catalog tasks reject.
  Recommendation maxPrice limits dish base price; optional finite POS ranking
  evidence enables strategy only while valid, without fabricated fixture ranks.
  Batches retain budget/strategy. POS Bridge coalesces concurrent submission keys
  within one process; restart/multi-instance durability remains adapter work.
  User authorized native scrolling and fixture-only external Jev replay. Native
  menu_scroll now reports actual MOVED/BOUNDARY/UNAVAILABLE outcomes, is hidden
  without a controller, and is phase/slot authorized. Chrome tests verify actual
  movement, boundaries and hidden owners; no scrolling dependency was added.
  Latest local suites: Order Menu 140 passed/14 guarded live tests skipped,
  Kiosk 76, POS 29, server scoped routes/decision/context 61; browser 16 passed.
  Scoped server/Order Menu/Kiosk typechecks passed. No commit/root typecheck.
  Whole Scene lifecycle and real Main Agent network flow are not yet fully
  integration-validated; do not call all six stages or production rollout done.

- Ingredient-filter follow-up now has live fixture replay coverage. POS accepts a
  positive vegetarian label; shared search/recommendation intersect every
  condition, retain dietary filters across batches, and distinguish NONE from
  UNKNOWN/customization. Empty lookup has no recommendation continuation.
  Server receives finite dietary refs and checks filter coverage/polarity before
  returning a read action; the fixed System One prompt is unchanged. Application
  supplies finite mentioned unavailable-condition refs (nutrition/allergy/strict
  diet topics); Jev distinguishes requested requirements from mere mentions.
  Requested unsupported conditions hand off rather than executing partial reads.
  Active-question speech/relation questions share one provider exchange, but
  relation observations cannot prune legal independent new actions. Every gate
  receives role/phase context with the current utterance last. Final live runtime
  replay passed 14/14 against openjev.aikcitri.qzz.io. Broader Server replay passed
  15/16 (complete feeling statement safely unavailable); the final qualifier
  change then passed the three affected feeling/acknowledgement/acceptance cases.
  No subsequent whole-suite live rerun; do not present those as one 16/16 run.
  Real provider load has caused request/snapshot expiry in earlier runs; stale
  snapshots still reject. Confidence gates and expected results were not relaxed.
  Main Agent receives the full original request and unavailable-condition refs,
  not binding partial interpretations from an unexecuted decision. This remains a
  bounded fixture check, not universal semantic accuracy.

- Seating no longer polls for unset/pickup/completed rounds. Active dine-in
  background sync is 30s (was 5s); semantic context/execution and Agent writes
  only refresh seats for dine-in. Reset without a hold is local. Explicit reads,
  POS atomic reservation and dine-in payment preflight remain authoritative.
  Browser regressions cover activation/cadence/stop/unmount/manual refresh and
  no-hold reset; runtime tests cover pickup omission and dine-in refresh. Reload
  Order Menu/Kiosk to apply; no backend change. Real Jev recommendation replay
  again passed four choices (3/3/1, then filtered exhaustion), not full-menu
  lookup. Recommendation and menu search remain deliberately distinct.

- Recommendation now defaults to up to three distinct available POS dishes;
  catalog order is not claimed as popularity. A two-minute recommendation
  session retains verified conditions and all delivered item IDs. A separate
  bounded `intent:recommend-more` compiles to `menu_recommend(more:true)`,
  preserves conditions and never recycles exhausted items or searches all menu.
  Recommendation/menu revisions reject stale batches; reception reset clears
  them. Fresh recommendations do not inherit old diets. Contrastive candidate
  descriptions distinguish lookup, initial recommendation and alternatives;
  the fixed System One prompt is unchanged. Server also validates finite food
  slots for the alternative choice. Cart reads default to showing review
  (`display:false` reads data only); both fulfillment modes reveal controls
  before animation and update visible selection afterward. Live checkout screens
  are not replaced by cart reads. Restart Server and reload Kiosk to apply.
  Four real Jev decisions passed through actual POS/runtime replay; two browser
  tests verified actual Review controls exist before selection animation.
  Validation: Order Menu 128 and server decision 28 unit tests, all ten Kiosk
  browser regressions, three scoped typechecks and changed-code lint passed.
  Existing Order Menu native-listener warning remains; no root typecheck or
  commit. Related contracts and deployment behavior are in Order Menu README.

- Duplicate-input investigation found that IME commit Enter and held Enter
  could submit the upper ASR text draft prematurely. Browser component tests
  reproduced `要3` being submitted during composition; shared BasicTextarea
  now ignores composition (including the keyCode 229 boundary) and repeat
  Enter. Upper input consumes its draft before emitting, without text dedup or
  blocking later speech. Eight browser regressions and 28 scoped Node tests
  pass; UI and Kiosk package typechecks and changed-code lint pass. Browser test
  dependencies are explicit in Kiosk's manifest/lockfile; no root typecheck or
  commit. Run with `VITEST_BROWSER_CHANNEL=chrome` to use installed Chrome.
  Historical Oct 1 15:17 session records two different inputs/IDs, each with one
  menu_get and one assistant reply; their originating keyboard events were not
  recorded, so that specific incident's cause is not proven. No Jev/ASR change.

- Customer operation dialogue now has one owner: POS labels flow to screen,
  semantic choices, host state and both model transports. `order_ask_question`
  accepts purpose only; Agent-written question text is rejected. The host shows
  canonical tool outcomes plus one validated question, not competing model
  prose or streaming drafts. Server stores operation drafts as service events;
  host records the actually presented reply as customer history. Model-only
  receipts omit environment/provenance, while raw system records retain it.
  Customer order completion/status messages are environment-neutral; pending,
  rejected and uncertain states remain explicit. Diagnostic/staff-only screens
  retain their test labels. Restart POS/server and reload frontends to apply.
  Validation: Order Menu 121, POS Bridge 25, server routes/domain 55 and host
  presentation/fast-path/retry 23 tests passed (224 total). Ten real Jev replays
  passed; four package typechecks, changed-code lint and diff checks passed.
  No root typecheck, no commit; existing native-registration listener warning
  remains unrelated to this change.

- Ingredient filtering is implemented in the uncommitted tree. POS composition
  records actual ingredients, completeness, source/revision and verified removal
  options; no absent-ingredient tags. The seven-dish source JSON declares complete
  simplified simulation facts (primary food, egg, vegetables; not sauces/broth).
  Browser catalog validation requires these facts. Both menu_get/menu_recommend
  share include/exclude intersection, separate customization/unknown results,
  display applied conditions, and clear stale empty displays. Customer dialogue
  omits test-source wording; composition source metadata remains intact.
  Jev receives only mentioned finite ingredient references and answers
  EXCLUDE/INCLUDE/NONE after selecting a read intent; no polarity regex.
  Browser rejects unoffered slots/stale plans; removal ignores food
  conditions. Read continuation retains filters; fresh utterances do not inherit
  a permanent diet profile. Shared product aliases retain all real matches for
  search; mutations still require a unique target. Stage/server use the neutral
  decision contracts so finite ingredient slots are not lost in transport.
  Validation: 208 unit/route tests passed; four scoped typechecks and changed-code
  lint passed. Four live Jev → actual POS → WebMCP replays passed on the final
  version in 12.8s total. No root typecheck or commit. Initial sandbox DNS failure was resolved by approved network
  access; it was not a model failure. Main Agent timeout remains undiagnosed:
  no failing visitor trace was supplied, and this change does not claim to fix it.
  See Order Menu/POS Bridge READMEs for deployment contract and scope.

- Mock dine-in seating is implemented in the uncommitted tree: five four-person
  tables, 10-minute unpaid holds, explicit minimal-capacity split consent, party
  size 1–20, revision-bound selection, and a POS-owned atomic inventory shared
  by HTTP/in-memory adapters. Order Menu touch and semantic WebMCP share one
  seating controller; Jev/Agent state preserves party/current question but not
  private hold tokens. Payment binds/locks the hold; accepted orders occupy it.
  Cancelling, switching to pickup, or starting a new round releases only unpaid
  holds. Authorized payment followed by rejected POS order stays uncertain;
  upstream failures never masquerade as expired holds. Real POS persistence,
  reconciliation remain future integrations. Mock staff departure is now available
  at the loopback simulator `/__simulator/seating`; it releases occupied tables
  individually, never payment locks. See both Order Menu READMEs.
  Seating validation: Order Menu 103, POS Bridge 22, Kiosk routes/decision 37,
  Fast Path 16 tests passed; three live seating Jev replays passed. Scoped
  typechecks and changed-code lint passed; browser verified five-person split
  hold and pickup release. Existing Order Menu MaxListenersExceededWarning
  still prints during native registration tests.

- Current Order Menu venue terminology is 內用 / 自取 (immediate pickup,
  no reservation/time slot). UI, semantic choices, WebMCP descriptions/results
  use these labels; the existing `takeout` order/POS code represents 自取.
  Modes now come from the required POS catalog `store.fulfillmentModes`; UI,
  candidate generation and submission enforce the same offered capabilities.

- Action-bound questions are implemented across fulfillment, party/table choice,
  checkout entry, membership, invoice, tax ID and payment. Real choices describe
  positive effects. `order_ask_question` accepts the current purpose only;
  the application owns wording. The host validates the receipt before showing it and activates
  by exact question ID, never prose matching. Questions bind phase/revisions;
  offers/answer tickets have 30s TTL, presented questions persist within the
  session. Deferral preserves the order. Tax/payment confirmation drops ordinary
  question authority and uses its own one-use record.
  Active-question Jev makes at most three bounded calls: task/background,
  answer/new request, semantic choice. New requests drop old question authority.
  An uncertain task gate can only defer an ordinary question, never mutate or
  escalate. Six actual-runtime live Jev replays passed (對, 好結帳, 先不要,
  background, new meal, 信用卡). Full checkout unit flow verifies payment only
  starts after exact confirmation; browser verified checkout entry reaches
  membership, not payment. No raw direct-tool fallback or phrase regex added.
  Validation: Order Menu 113, POS Bridge 24, server decision/routes 41, stage
  Fast Path/presentation 18 tests passed; six live Jev replays passed in 21.8s
  total. Scoped typechecks passed. Route setup needed a 30s hook timeout for
  schema initialization; no production timeout changed. Existing native
  registration MaxListenersExceededWarning remains. Real POS/terminal and
  operator-side end-to-end acceptance are still required before production.

- Kiosk dialogue and archive changes are in the uncommitted working tree.
  System One now gets server-owned bounded role dialogue (12 turns / 4,000
  chars), actual unanswered questions, and one finite read-result continuation.
  Past model decisions remain traces, not context truth. Context-dependent
  uncertain operations can escalate after a separate bounded speech check.
  `0045_kiosk_session_archives` changes TTL to operational-link release;
  transcripts/original captured media/internal verified associations remain.
  Rebuild server-schema and restart Server to apply it. Preserve the private
  media volume as well as PostgreSQL. Membership/POS verifier wiring is future
  integration, not implemented identity discovery. See the three app READMEs.
  Live Jev replay against openjev passed 13 cases, including completed-result
  review; price acknowledgments safely escalate when operation confidence is
  uncertain rather than being executed as purchases.

- Repository-wide Codex working rules are in [`../AGENTS.md`](../AGENTS.md).
  Start there before exploring.
- The workspace can contain user-owned, uncommitted work. Do not assume its
  intent or overwrite it; inspect `git status` and the relevant diff only when
  the current task needs it.
- [`../CONTEXT.md`](../CONTEXT.md) is the domain glossary. It is reference
  material, not a task ledger.

## Recent Meaningful Changes

- Per-device Kiosk settings now connect management API, device bootstrap/polling,
  Dashboard Devices, and the Kiosk settings page. Migration `0032` adds the
  Server-owned revision, admin overrides, delegated keys, and local overrides.
  Admin revocation deletes local values; local writes require both a registered
  device and a Site/system administrator account. Operational observation no
  longer reads localStorage. See `apps/stage-kiosk/README.md` for precedence and
  deployment requirements. Frontend build validation was blocked by the Live2D
  SDK download; do not automatically rerun builds/typechecks (user preference).

- Webnavior now has a structured Interactive Experience editor, operations
  dashboard, draft-only Kiosk preview, per-site model policy, and server-owned
  Kiosk character assets. The completed and remaining delivery steps are in
  [`plans/2026-09-10-webnavior-management-experience.md`](plans/2026-09-10-webnavior-management-experience.md).
- Kiosk provisioning now has a one-administrator operator boundary: an
  administrator can publish a default experience template, and a newly created
  Site copies its latest snapshot into its own draft and immutable release.
  Store releases track revisions, template origin, parent release, and whether
  they are a template seed or store override. New devices inherit the Site's
  latest release; template changes never overwrite existing Sites.
- A published Kiosk Profile now has `voiceConversationOnly`. It hides the text
  composer and, with provisioned microphone permission, starts VAD on load;
  the Kiosk displays green/red microphone status from its actual VAD startup
  state, and its avatar receives the shared Stage thinking state during Server
  replies.
- Kiosk ASR/TTS now use device-authenticated `/api/kiosk/audio/*` routes. The
  Server resolves Site policy and retains provider, model, voice, endpoint, and
  credentials; kiosk bootstrap and local settings no longer carry audio models.
- Kiosk Sites persist a performance profile (`constrained`, `balanced`, or
  `high`). The kiosk bootstrap applies it locally to camera resolution,
  MediaPipe cadence/face count, and evidence-clip duration; constrained devices
  cap continuous recording to triggered clips regardless of the Site policy.
- Kiosk Sites persist their voice VAD settings, including probability threshold
  and speech padding. Authorized operators can adjust them in Kiosk technical
  settings; the kiosk refreshes immediately after a local save and otherwise
  polls the synchronized snapshot every five minutes.
- Kiosk technical settings also provide an opt-in conversation-duration
  diagnostic. When enabled, the conversation pane shows the current/latest
  request duration through final LLM text and browser-tool work, excluding ASR
  and TTS playback.
- Kiosk camera evidence supports `snapshot` in addition to off, triggered
  video, and continuous video. Snapshot captures one event-linked JPEG without
  creating `MediaRecorder`; the per-device `faceDetectionConfidence` setting
  defaults to `0.60` and accepts `0.40`–`0.80` for MediaPipe detection,
  presence, and tracking thresholds.
- Kiosk uses a bounded queue of independent final ASR utterances alongside its
  cancellable Agent/presentation turn. New VAD speech can be transcribed while
  a model or browser tool runs; Jev classifies it before any interruption or
  escalation. The Router now enforces `fullChainTimeoutMs` across all LLM
  fallback attempts. Order-menu publishes the optional Webnavior Kiosk Activity
  Manifest at `/.well-known/webnavior-kiosk-activity.json`; its customer labels
  are display-only and always have a generic Kiosk fallback.
- Normal Kiosk conversation replies now remain Server-owned but stream a stable,
  customer-safe SSE event contract to the browser. Assistant deltas are
  presentation-only until completion, browser-owned tool calls retain their
  existing execution loop, and only completed assistant text is persisted.
- Kiosk conversation progress now projects verified `turn-started`, tool, and
  first-answer events into a transient cross-column thought bubble beside the
  avatar. It deliberately never appears for unverified speech candidates, and
  each state carries its turn id so an interrupted request cannot clear a newer
  customer's progress.
- After five seconds without an answer, the Kiosk changes that progress copy to
  a truthful "still checking" state. A timed-out turn can be manually retried
  only if it attempted no cart, order, checkout, or payment mutation; menu and
  cart reads remain retryable, while the original customer message is not shown
  twice in the conversation.
- Kiosk history classifies retained sessions as interactive, greeting-only, or
  empty without deleting associated evidence. Administrators can select reviewed
  sessions and export LLM JSONL or ASR metadata plus paired audio ZIP. The
  Ubuntu updater applies the PostgreSQL schema, rebuilds server schema, and
  restarts `webnavior-api` before publishing browser assets.
- Webnavior's OpenAI-compatible TTS connection now stores its own voice instead
  of consulting AIRI's general voice catalog. The default is
  `zh-TW-HsiaoChenNeural`; `/audio/speech` receives that voice, MP3 format, and
  speed `1.0` unless a System Manager changes the connection setting.
- Removed the stale `azure-speech` SSML allow-list entry and the unused MiniMax
  Speech provider registration, metadata, translations, and dedicated docs.
- Webnavior Kiosk AI uses a Server-owned, capability-scoped control plane:
  every chat, vision, ASR, and TTS capability owns multiple isolated
  Provider Profiles and one active verified selection. Profiles do not cross
  capability boundaries, even with the same upstream URL. The runtime compiler
  projects only active verified profiles into existing AIRI gateways. The Stage
  Web 「Kiosk AI 能力」 page validates a selected model with its real capability
  endpoint before allowing activation; switching only reaches Kiosk after an
  explicit apply. `face_only` and other presence settings remain independent.
- Order Menu now loads sellable items exclusively through
  `apps/order-menu-server`'s POS Bridge. Its loopback simulator normalizes the
  repository-root `周氏蝦捲菜單_v2.json` fixture, while the browser carries the
  returned catalog revision with every cart. The Bridge rejects stale revisions
  or changed prices before forwarding to the POS. The checkout now creates a
  card/mobile terminal payment, binds an authorized payment ID and exact amount
  to the cart, and automatically submits to POS. Rejected payments return to
  method selection; uncertain payment or order receipts lock the flow pending
  reconciliation. The simulator exposes independently controllable payment and
  order outcomes. See
  `plans/2026-09-21-order-menu-pos-bridge.md`.
- Order Menu WebMCP now follows RMAP v0.2: explicit cart confirmation starts
  checkout instead of submitting directly. Agent tools can skip membership,
  choose invoice handling, display and separately confirm an eight-digit tax ID,
  select a payment method, or cancel checkout. Physical barcode scans and
  payment authorization remain outside WebMCP; pending/uncertain payments block
  cancellation and new-round cart clearing. See
  `standards/restaurant-menu-agent-protocol-v0.2.md`.

- Kiosk visitor sessions now persist compact Agent interaction context beside
  their transcript: rendered and dismissed menu subject IDs plus
  `active`/`decision_guidance`/`touch_preferred` mode. A request for other
  recommendations dismisses the preceding batch; only repeated rendering of
  unchanged items escalates guidance. The same context now retains recent menu
  item names/IDs and the latest successful compact cart snapshot for natural
  references. Full tool calls/results remain in the durable transcript for
  review, but only the current tool exchange is sent back to the model; older
  tool payloads are represented by the compact context. Recent conversational
  text is additionally bounded by total characters, and an oversized current
  tool result is reduced only in the model request while its complete durable
  result and interaction snapshot are committed before the model continuation.
  This never owns or clears the order-menu cart. See
  `apps/server/src/services/domain/kiosk-agent-interaction/`.
- Order Menu distinguishes a filtered `menu_get` lookup from a recommendation:
  lookups replace the menu grid without a recommendation rail, while
  `menu_recommend` and `menu_show_recommendations` use the rail and the Kiosk
  recommendation motion. In non-production, `kiosk-tools` traces only tool
  names/session IDs on the Server. The Kiosk forwards SSE `tool-requested`
  events before browser execution and shows selected, running, and completed
  steps in a fixed panel above the message composer.
- `menu_get` accepts `queries` for a single multi-dish lookup, so a customer
  mentioning several dishes can render their combined matched results rather
  than whichever scalar query the model chose last. Query-result presentations
  preserve each matched subject and use a fair first-card allocation, then let
  the customer switch to every subject's complete result list; broad matches
  cannot consume all preview slots. Browser-owned Agent actions now visibly
  press their resolved target control without issuing an extra DOM click. The
  System Manager's Chat Provider default and allowed maximum are 60,000 ms; an
  existing Chat profile must still be edited, verified, saved, and applied
  before its persisted 30,000 ms timeout changes.
- Order Menu now displays a transient skeleton only while a tool that will
  replace the visible menu is truly executing: filtered `menu_get`,
  `menu_recommend`, or `menu_show_recommendations`. The runtime owns start/end
  notifications, so the skeleton clears on success and failure alike; a full
  catalog read does not unnecessarily replace the current menu with a loader.

## In Progress / Known Issues

This section is the required unfinished-work index. Future Agents must read it
before proposing the next implementation; the linked plans provide detail, but
their existence alone does not mean an item has been implemented.

### Order Menu / POS

- Replace the loopback POS and payment simulator with vendor adapters after the
  POS and operations vendors provide catalog, order, terminal, timeout, and
  reconciliation contracts. Do not guess vendor fields or payment brands.
- Connect physical membership and invoice-carrier scan events. A scan result
  must come from the device adapter, never an Agent tool; an inherited carrier
  must still be shown in full for customer confirmation.
- Connect real cloud-invoice issuance for carrier, eight-digit tax ID, and
  donation. The default donation recipient remains an operations-owned setting
  and is intentionally not hard-coded.
- Add a staff reconciliation workflow for `uncertain` payment or POS results.
  Until reconciliation exists, these states intentionally lock payment, cart
  clearing, and new-round actions to prevent duplicate charges or orders.
- Run vendor-hardware acceptance tests for barcode scanners, card terminals,
  mobile-payment QR presentation, receipt results, and the configured 30-second
  timeouts once hardware contracts are available.

### Webnavior management / Kiosk

- Webnavior Kiosk now has a System One Fast Path. Each encrypted profile selects
  either Dasein open-jev or lookski/openjev, with its URL, model identifier,
  timeout, readiness and active status; both use a real `/v1/systemone`
  readiness call. The Kiosk sends its final ASR transcript, explicit phase,
  finite domain references, and a small set of phase-legal semantic intents to
  the one active profile. The model cannot see or invent WebMCP tools, cart
  line IDs, prices, payment outcomes, or POS commands. The internal candidate
  tool is excluded from Main Agent tools. `IGNORE` retains nothing;
  `NEEDS_ASSISTANT` sends the current ASR transcript to Main Agent, while
  `UNAVAILABLE`, `IGNORE`, `INCOMPLETE`, and `CLARIFICATION` remain
  on the constrained voice path. A failed decision marks the profile unready,
  and the next utterance automatically performs real readiness before
  re-enabling Fast Path. Details and present scope are in
  [`plans/2026-09-27-webnavior-dasein-system-one-phase-1.md`](plans/2026-09-27-webnavior-dasein-system-one-phase-1.md).
  System Managers can inspect the selected local deployment's actual loaded
  model through `/health`: Dasein returns `model`; lookski returns `model_id`.
  These implementation-specific single-model runtimes cannot switch model per
  System One request. System One
  profiles support edit and deletion: modifying implementation or
  connection settings revokes readiness and deactivates Fast Path, duplicate
  names return a conflict instead of a 500, and only an inactive profile may be
  removed. System Managers can explicitly deactivate Fast Path without deleting
  its profile. System One
  now compiles its Traditional Chinese semantic policy from a System Manager
  editable prompt. A blank override means the current Server default, while
  the UI exposes that default for experimentation and can restore it. The
  optional 2,000-character store instruction remains separate. Neither can
  replace candidate-set, RMAP, confirmation, or executor safety boundaries.
  Migration `0042_kiosk_system_one_policies` adds this singleton setting;
  migration `0043_kiosk_system_one_implementations` adds the required
  implementation field, marking existing profiles as Dasein; migration
  `0044_kiosk_system_one_decision_instruction` adds the editable prompt
  override. The default contrastive boundary treats a uniquely identified
  「想吃／想要水餃」and「我要／幫我加水餃」as `ADD_ITEM`; only explicit
  viewing or selecting without ordering uses `SELECT_ITEM`. In text-mode Kiosk, the main conversation panel provides a
  simulated-ASR text input, expandable raw decision trace, and a larger
  structured per-utterance inspector. It bypasses
  microphone/ASR only; it uses the real System One, current browser state,
  and WebMCP runtime, marks activity `asr_simulation`, and does not retain a
  fake audio recording.

- The obsolete Kiosk embedding Speech Guard and `/turn-decisions` control plane
  have been removed. Migration `0041_remove_kiosk_speech_guard` permanently
  removes embedding Capability Provider selections/profiles and both Speech
  Guard tables. The former Redis entry is no longer read by Server code.

- **Bounded semantic-pipeline refactor:**
  `apps/order-menu/src/kiosk-intents.ts` owns domain reference resolution,
  `deriveDecisionContext`, `resolveIntent`, `compileOperationPlan`, and
  phase-aware `authorize`. Candidates are one per legal intent, not menu ×
  intent, and the Server no longer lexically sorts or truncates them. Menu
  full names, aliases, unique suffixes, categories, selected/cart references,
  quantity, options, and supported dietary constraints are resolved in the
  application. Jev sees only per-turn ordinal domain refs, not actual item or
  cart IDs. `webmcp.ts` binds issued plans and one-round clarification to
  relevant cart/menu/selected/checkout revisions. The order machine increments
  domain revisions on each successful write, and checkout/payment refs advance
  checkout revision synchronously, including edit-then-undo cases.
  Clarification questions use
  only real refs; unique ordinal replies are resolved deterministically, while
  an unresolved reply returns to touch. Confirmation records bind action,
  slots, ID, timestamps, expiry, and revisions, and are consumed before
  execution. Payment selection now explicitly sends its phase and methods;
  payment pending/uncertain remains locked.

  The simulated-ASR panel exposes a full trace: browser and checkout snapshot,
  phase, refs, intent candidates, Jev raw answer/probabilities, resolution,
  operation plan, and authorization. A state-changing choice below 0.5 reported
  confidence returns `UNAVAILABLE` rather than executing or forwarding
  unclassified speech. On 2026-09-29 the
  configured Qwen3.5-4B openjev service passed the eight live request replay
  expectations using the default prompt, but that replay used an incorrect
  bento gold label. After correcting it to `ADD_ITEM`, the same eight cases
  passed a fresh live replay against the configured service on 2026-09-29;
  「我想要吃招牌便當」 chose `ADD_ITEM` with 0.916 confidence and 「信用卡」
  chose card payment in `checkout_payment_select`. This is not proof for
  store-specific overrides or
  physical checkout; operator-side integration testing remains necessary.
  Do not restore the removed raw direct-tool candidate path.

- **2026-09-29 continuation:** Jev's one bounded choice now has `MULTI_ACTION`
  for compound utterances that must reach Main Agent intact; a separate live
  two-question probe was slow; active-question bounded calls now have guarded
  live replay evidence, not a guaranteed latency SLA. Fast Path retains a recent real cart line
  for 「再一份」, clarifies a conflicting selected draft, and honors the spoken
  quantity. Successful Fast Path voice turns and compact menu/cart results are
  persisted in the same visitor session that Main Agent reads. Agent has a
  read-only, device-authenticated `kiosk_session_history` tool for paged older
  text, not an unbounded prompt. Native Main Agent WebMCP mutations use the
  same `authorize` policy; high-risk calls create one-use Fast Path confirmation
  state, and ambiguous same-item cart edits use bound clarification. Checkout
  payment-stage cancellation is available only before payment begins and
  requires confirmation. ASR escalation carries a sanitized browser phase and
  payment-method snapshot into the Main Agent's first request; typed turns read
  the same snapshot through host-only `kiosk_interaction_state`, which does not
  create or consume Jev candidates. Raw checkout IDs remain browser-owned.
  Relevant targeted tests/typechecks and the corrected eight-case live replay
  pass; on-device checkout/POS integration remains to be validated.

- **Kiosk continuous-ASR continuation:** Native WebMCP host-only context/state
  calls now use the host path, and native JSON-string input schemas are parsed
  before Main Agent tool exposure. Live and simulated ASR use one bounded
  utterance queue that reserves capture order before asynchronous ASR returns
  and releases a hung ASR reservation after 15 seconds. Jev filters background speech before interrupting TTS or
  Agent work; an active Agent request can be restarted only before it requests
  a browser tool. Later speech waits for a definitive tool/result loop and is
  re-decided against current state. `UNAVAILABLE` fails closed, while explicit
  `NEEDS_ASSISTANT` and related follow-ups route to Agent. The decision inspector
  shows phase, candidates, real-reference labels, decision, operation, and
  authorization per utterance. Targeted tests and package typechecks are the
  implementation gate; local Server services were not running for live replay.

- Build the System Manager sandbox test and Store Manager on-device validation
  workflow, including device health, execution records, and audit data. This is
  phase 5 in
  [`plans/2026-09-10-webnavior-management-experience.md`](plans/2026-09-10-webnavior-management-experience.md).
- Add production account assignment for Content Managers plus submission,
  approval/publish permissions, and audit history. Current development accounts
  and role checks are not the final operator workflow; this is phase 6 in the
  management plan.
- Design a finite, validated VRMA action mapping for greeting, recommendation,
  and order-completion one-shots. Character cards and LLM output must never
  choose arbitrary filenames or URLs.

### Validation note

- Relevant package tests and typechecks have been used during development. A
  repository-wide typecheck/build was intentionally not run; follow the scoped
  validation policy in `AGENTS.md` and run integration gates only when preparing
  a release, PR, or merge that requires them.

## Key Technical Decisions

- Formal, reusable decisions belong in `docs/standards/`; reusable
  investigation outcomes belong in `docs/solutions/`. Do not duplicate either
  in this handoff.
- Follow targeted validation first. Root-level lint/typecheck remain suitable
  integration or before-commit checks, not a default after every edit.

## Relevant Files

- [`../AGENTS.md`](../AGENTS.md) — repository development rules and validation policy.
- [`../CONTEXT.md`](../CONTEXT.md) — shared domain terminology.
- [`plans/`](plans/) — current feature plans.
- [`standards/`](standards/) — stable product and protocol contracts.
- [`solutions/`](solutions/) — reusable verified implementation learnings.

## Next Likely Work

- For Order Menu, real membership, invoice, donation-recipient and payment-brand
  adapters remain deferred until POS/operations contracts arrive. The next
  implementation unit should begin only after those external contracts or a new
  product requirement is available.
