# Inspect local SLM decisions with curl

## Full-source SLM coverage

The ten-case routing control is a prompt-design diagnostic. Replacement decisions
require the complete compatible source inventory. The 2026-10-29 full run freezes
1,114 source-case records / 986 distinct literal utterances / 1,338 base assessments
plus 44 complete route-layout controls,
including ordered requirement fields and repeated utterances in different states.
These are different counting units and must not be reported as 1,382 independent
conversations. All 400 corpus rows, 44 partition cases, 40 resolver cases,
32 effect-review cases, 26 five-field requirement cases, 40 generative-effect
cases, 26 semantic cases, every step of 20 chains, 126 recent inputs and 316 older
captured inputs are retained. Private captures include partial/uncertain evidence;
unlabelled turns are measured but do not receive manufactured gold labels.

The completed safe report is
`../turnClassifierPoc/results/slm-full-20261029-summary.json`: 1,380 actual local
requests, all available frozen inputs collected, with the one harness-deadline
interruption explicitly retained. The full 44-case route matches 26/43 with
question-first and 30/43 with state-first (one missing candidate). This does not
pass direct replacement acceptance. Other task-group scores and unscored/gap
counts remain separate; no overall accuracy or current Jev ranking is claimed.

From the repository root, an authorized operator can capture all recent entries
without a SQL LIMIT, then freeze the evaluation manifest:

```sh
python3 test_prompt/slmDecisionInspection/captureFullCoverage.py
python3 test_prompt/slmDecisionInspection/prepareFullCoverage.py
KIOSK_SLM_FULL=1 pnpm -F @proj-airi/server exec vitest run tests/experiments/slmFullCoverage.test.ts --maxWorkers 1
```

Preparation reads existing source files and local private snapshots; it does not
call a model. Capture/manifest files refuse replacement. The recent manual labels
are tied to the 126-turn snapshot; new captures require pre-inference label review,
not silent positional reuse or a smaller sample. Older snapshots are prepared
as an append-only batch with `--older-only --output /tmp/webnavior-full-coverage-older-manifest.json`;
set `KIOSK_SLM_FULL_MANIFEST` to run that manifest. Never rerun the base batch to
choose a better result. A timed-out batch must retain its results; a continuation
may execute only NOT_RUN IDs with unchanged inputs/gold, never retry mismatches.
The first full batch exposed a harness bug: its final request was cut to 3,224ms
by the 35-minute batch deadline. This one no-answer input is explicitly declared
in a child manifest, with its original timeout preserved in `interruptedAttempts`.
It is completed once together with all NOT_RUN items. Ordinary provider errors
and semantic answers cannot be overwritten. Later batches reserve the full
per-request deadline before starting another call.

The full runner permits **local DMR only** because exact private speech is present.
It uses the existing non-thinking one-label transport with question-first prompt
layout and `cache_prompt=true`; previous state-first scores are not pooled with
this version. The complete newest state is sent every time. Runtime cache counters
are recorded without assuming reuse or treating cache as conversational memory.
Each batch has a 35-minute limit, 35-second per-call timeout, no hidden retries and
stops after three consecutive provider/contract errors. Missing candidates,
missing original prompts, unscored records and NOT_RUN rows remain in the report.
Semantic mismatches fail the live test; collection completion is not acceptance.

A separately frozen **complete 44-case route control** retains the earlier
state-first layout, with identical state/candidate/gold data. It adds 44
assessments, not new source cases or utterances. Both layout results must be
reported, without choosing a better version as unseen acceptance. This isolates
the layout change from coverage expansion; it does not rerun only failed cases.
The control manifest explicitly sets `promptLayout: "state-first"`; ordinary full
manifests use the question-first protocol. Run the control after the other batches
to avoid competing DMR requests.

After all batches, `summarizeFullCoverage.py --manifests <frozen manifests...>
--logs <private logs...> --output <new summary.json>` writes a safe summary and
refuses an existing output. Include a continuation's manifest as well as its log;
input hashes must match. The summarizer rejects replacement of an executed answer
and retains missing/unfinished assessments. Its provenance/privacy regressions
run with `python3 test_prompt/slmDecisionInspection/testFullCoverage.py`.

Groups retain their own contracts and denominators. Form classification is not
operation accuracy. Generative cases evaluate all ordered effects/count only,
not target/quantity/conditions. Semantic setups and chain context are reconstructed
diagnostics, not live Main/ASR/UI execution. The existing R01–R06 partial/missing
source states remain gaps, not invented exact replays. Raw prompts/responses must
stay in private 0600 logs. Commit only source inventories, test code, safe synthetic
cases and summaries without exact customer text, session IDs or credentials.

## Recorded curl examples

These are synthetic historical snapshots, not customer logs. The three original
request JSON files are exact copies of the captured bodies from the 2026-10-29
SLM-only historical replay. They contain state, instructions and candidates;
expected answers are kept separately in the recorded result files. No inference
was performed when exporting these files. No Jev, application execution, database,
cart or payment endpoint is called by the commands below.

Run on the machine hosting Docker Model Runner. Requires `curl` and `jq`:

```bash
cd /home/aimax/webnavior/test_prompt/slmDecisionInspection
```

Inspect the exact state, question and answer options before sending anything:

```bash
jq -r '.messages[] | "[" + .role + "]\n" + .content + "\n"' p07.request.json
jq . p07.options.json
jq '{utterance, candidateCount, expectedEffects, label, selectedEffect}' p07.recorded.json
```

Fresh model answers may differ from recorded answers. These commands display
the returned letter and map it to its actual effect and description:

```bash
curl -sS --fail-with-body --max-time 60 \
  http://127.0.0.1:12434/engines/v1/chat/completions \
  -H 'Content-Type: application/json' --data-binary @p07.request.json \
  | jq --slurpfile options p07.options.json \
    '{label: .choices[0].message.content, selected: $options[0][.choices[0].message.content], finish_reason: .choices[0].finish_reason}'

curl -sS --fail-with-body --max-time 60 \
  http://127.0.0.1:12434/engines/v1/chat/completions \
  -H 'Content-Type: application/json' --data-binary @p18.request.json \
  | jq --slurpfile options p18.options.json \
    '{label: .choices[0].message.content, selected: $options[0][.choices[0].message.content], finish_reason: .choices[0].finish_reason}'

curl -sS --fail-with-body --max-time 60 \
  http://127.0.0.1:12434/engines/v1/chat/completions \
  -H 'Content-Type: application/json' --data-binary @p31.request.json \
  | jq --slurpfile options p31.options.json \
    '{label: .choices[0].message.content, selected: $options[0][.choices[0].message.content], finish_reason: .choices[0].finish_reason}'
```

| Case | Utterance | Options | Recorded answer | Expected effect |
| --- | --- | ---: | --- | --- |
| p07 | 能不能看看紅茶 | 8 | H: ADD_ITEM | F: SEARCH_MENU |
| p18 | 我改外帶，不在這裡吃了 | 12 | L: defer-question | K: takeout |
| p31 | 排骨便當撤掉，換牛肉麵一碗 | 16 | L: REMOVE_ITEM | D: MULTI_ACTION or E: NEEDS_ASSISTANT |

For the complete HTTP response, remove the `| jq ...` suffix. Letter mappings
are local to each request; the same letter does not imply the same effect.
These requests deliberately use `max_tokens: 1`, thinking disabled, temperature
zero and no tools. `finish_reason: length` can accompany an entire valid label;
it does not prove a semantic answer is correct. `top_logprobs: 20` is a diagnostic
output setting, not the number of business choices; count the options file.

## Manual four-option control

`p07.fourOptions.request.json` retains the exact same state, policy, candidate
descriptions and generation settings as p07, but removes four candidates and
remaps the remaining letters. It has not been run or assigned a recorded answer.

```bash
jq -r '.messages[1].content' p07.fourOptions.request.json
curl -sS --fail-with-body --max-time 60 \
  http://127.0.0.1:12434/engines/v1/chat/completions \
  -H 'Content-Type: application/json' --data-binary @p07.fourOptions.request.json \
  | jq --slurpfile options p07.fourOptions.options.json \
    '{label: .choices[0].message.content, selected: $options[0][.choices[0].message.content], finish_reason: .choices[0].finish_reason}'
```

This is a manually selected shortlist, not a tested production selection policy.
It changes which competing meanings are available as well as prompt length and
letter positions. Even a better answer would not isolate candidate count as the
cause or establish that automatic hierarchical routing works. The removed
background/unfinished/multiple-demand choices remain necessary in real use.

The source log hash and exported file hashes are in `manifest.json`. Prior
history contained 7–17 route candidates in the failed cases, while the newer
configured-input shadow run observed 11–20 root candidates. Those are different
snapshots. The eight-choice p07 error shows that a high count alone is not an
established explanation. Overlapping descriptions and mixed abstraction levels
are additional hypotheses, not proven causes.

## Staged runtime and SLM option

The authenticated runtime now uses the same staged routing for Jev and SLM;
older flat replays above remain a frozen diagnostic baseline. First admission
has four outcomes, demand/group/leaf questions have at most six. Runtime code is
`apps/server/src/services/domain/kiosk-interaction-decision/routing.ts`; the real
SLM profile transport lives in `kiosk-system-one/`, never in this test directory.

Run the complete frozen 1,114-source first-gate protocol replay with
`KIOSK_STAGED_SLM_FULL=1 pnpm -F @proj-airi/server exec vitest run tests/experiments/stagedSlmFullCoverage.test.ts`.
It requires both full manifests under `/tmp`, visits every source case once,
uses an isolated DB and local DMR only, and writes a new summary using exclusive
creation. No four-way semantic gold is fabricated from the old heterogeneous
labels; `semanticAccuracy` is null and `fieldAcceptance` false. Preserve stdout
in a private log with `umask 077`; it includes original dialogue/context.

Run **all 44** original route cases with
`KIOSK_STAGED_SLM_ROUTES=1 pnpm -F @proj-airi/server exec vitest run tests/experiments/stagedSlmRoutes.test.ts`.
This uses the production profile adapter and staged tree. Original expected
labels and candidate gaps remain; question expiry is refreshed per isolated
replayed turn. There is no original browser, audio or Main execution. Semantic
mismatches fail only after the complete set is collected.

Run **all 26** synthetic real-Menu cases with
`KIOSK_SLM_MENU=1 pnpm -F @proj-airi/order-menu exec vitest run src/semanticReplay.test.ts`.
It uses the production request compiler/parser against local DMR, then executes
only inside a gateway-free Menu runtime. Reports retain actual route, receipts,
cart before/after and domain refusals; safe handoff is not counted as customer
completion. Model transport/protocol tests and browser tests are separate from
these live semantic suites. No suite activates SLM in the deployed database,
submits an order, takes payment, downloads models or changes Main thinking.

The guarded route runner also supports the **complete 40-case resolver** source:
set `KIOSK_STAGED_ROUTE_SOURCE=resolver` and a fresh
`KIOSK_STAGED_ROUTES_SUMMARY` path. `KIOSK_STAGED_ENGINE=jev` reads the currently
configured Jev profile into an isolated DB using the loaded Server environment;
it never changes the deployed active selection. SLM remains the default test
engine. Both use the same tree, original gold and full corpus for their source.

The first staged version exposed an information→add and compound→single-add
error. The guarded revision added independent operation-purpose and whole-effect
checks to every independent order write. All 44 cases, all 40 resolver cases,
and all 26 Menu cases were collected for that revision, with semantic failures
retained. Two correct Menu writes then exposed the ordinary candidate's old 15s
lease. Menu now allows the shared 60s decision budget while keeping revision,
question and high-risk confirmation limits. All 26 Menu cases ran again;
first-gate prompts and route-gold were not retuned. Preserve each version's
summary; never select its best answers or pool their matching counts.
