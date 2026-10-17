# Codex Handoff

This is a compact transfer note for a new Codex thread, not a changelog or a
record of commands and diffs. Keep only information that source code and formal
documentation do not make quick to recover. Prune replaced entries rather than
accumulating history.

## Current State

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

- Oct8 missing-dish complaints DIAGNOSED, NOT FIXED. Attachments600f4a56 /
  a6f483f0 retain original multi-dish dialogue, beef alias evidence, ADD candidate,
  pork-only cart and fulfillment question. 牛肉麵沒點到 -> INCOMPLETE confidence
  .3286; 你沒有點到我的牛肉麵 -> ADD .2836 -> UNAVAILABLE. Both one6.07s exchange,
  no relation/tool call. INCOMPLETE returns without confidence validation while
  high-risk ADD below.5 refuses; UI does not escalate either result (simulation
  wait/unavailable status, ASR refusal notice for UNAVAILABLE). Local fixed-choice
  replay reproduces without history/question; this tests application admission,
  NOT why live4B chose those labels. Follow-up98897f0e: 想吃麵 -> INCOMPLETE .7969,
  category 麵食/itemCount1 + explicit category-browse SEARCH candidate + dialogue
  all present; ADD absent is consistent with category/no-quantity browse policy.
  One5.88s exchange. High-confidence counterexample means adding a.6 confidence
  check alone cannot repair this family. Correct SEARCH fixed-choice control
  passes existing read pipeline; not a live prompt/model fix.
  incompleteDiagnosis.test.ts:10 diagnostics pass,2 expected-safe probes known
  red with KIOSK_INCOMPLETE_DIAGNOSIS=1; scoped
  lint pass, no full typecheck/live provider/production change. Fits earlier
  lost multi-demand / no per-demand completion ledger finding, not proof that
  context disappeared or missing ADD candidate. Avoid phrase exceptions, lower
  mutation thresholds, or automatic ADD from mention; need safe uncertainty
  recovery and grounded reconciliation of intended vs executed requirements.

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

- Oct 7 cart meal replacement DIAGNOSED, NOT FIXED. Attachment addd9b21:
  排骨便當一份 already added; 改水餃一份 sees exact 水餃, recent pork cart line
  and fulfillment waitingFor, but Jev chooses ADD confidence.6223. Local recorded-
  choice replay passes Server decision, resolver/compiler/authorize and adds
  dumplings without removing pork. Trace itself has no execution receipt.
  Finite intent/compiler has no cart-meal replacement effect; quantity/option
  edits and unadded-draft replacement are distinct supported cases. Existing
  guard checks validity of chosen operation, not whole-request semantic coverage.
  cartChangeDiagnosis.test.ts:2 local probes pass; expected-safe replay is known
  red under KIOSK_CART_CHANGE_DIAGNOSIS=1. No production change or live Jev call.

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
