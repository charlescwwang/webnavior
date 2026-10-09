# Turn Classifier PoC

Independent, synthetic-only experiment: can a small local encoder recognize turn
forms and safely delegate context-dependent turns, rather than guess a menu item?
Nothing here is imported by production Kiosk, `deriveDecisionContext`,
`resolveIntent`, or WebMCP. The second-phase test harness imports the real Menu
runtime into an isolated in-memory replay, never the other way around. No live
menu, cart, order, payment, session, or saved model policy is modified.

## Status and model choice

The user-approved experiment completed: frozen MiniLM head58/80, similarity54/80,
SetFit59/80, Jev47/80 on the same held-out turns. Local warm inference is about8ms;
remote Jev HTTP averages1682ms. Validation-only calibration and routing simulations
are recorded in [report](./report.md) and [comparison JSON](./results/comparison.json).
These are not production Kiosk accuracy or executed-domain outcomes. High-confidence
compound-turn errors remain; no model or threshold was adopted into production.

The third-phase effect/whole-request review also completed and is **rejected for
adoption**: it incorrectly promotes9/18 deliberately unsupported hypotheses,
including mistakes above0.95 confidence, while adding5269.8ms average HTTP time.
This is a review challenge, not classifier accuracy or production error rate.
See [report](./report.md) for the paired counterexamples and limitations.

## Independent resolver challenge replay

The next experiment asks whether a correctly classified turn is enough to pick
an operation and whether existing domain guards can repair a wrong semantic
decision. `resolverScenarios.json` freezes 40 new synthetic contextual scenarios
before inference. It intentionally pairs the same short answer with different
states. Expectations are assessment data only, never supplied to the encoder or
Jev. Models and validation temperatures from phase one are reused without
training, calibration, or threshold tuning on this challenge set.

From the repository root, with the previously prepared local model artifacts:

```sh
test_prompt/turnClassifierPoc/.venv/bin/python test_prompt/turnClassifierPoc/replayLocal.py
pnpm exec vitest run --config test_prompt/turnClassifierPoc/resolverReplay.config.ts
```

The TypeScript harness lives in `apps/order-menu/src/resolverPoc.test.ts` so it
uses that consumer's actual dependencies, with no root dependency changes,
mocked import paths, or production exports added for testing. Its regular tests
are offline. Real-provider calls are opt-in and send only the new artificial
menu, state and dialogue, never attachments or customer logs:

```sh
RESOLVER_JEV_URL=https://openjev.aikcitri.qzz.io RESOLVER_WRITE_REPORT=1 pnpm exec vitest run --config test_prompt/turnClassifierPoc/resolverReplay.config.ts
python3 test_prompt/turnClassifierPoc/summarizeResolver.py
python3 test_prompt/turnClassifierPoc/summarizeResolver.py --audit
```

Prediction/replay/summary artifacts refuse replacement; preserve the first run.
Use a separate experiment copy for a new recorded run. Run offline tests as
often as needed without `RESOLVER_WRITE_REPORT`. Authentication/rate-limit errors
or three consecutive provider failures stop further calls; partial results are
not summarized as a completed benchmark.

The experimental eligibility rule is deliberately read-only: high-confidence
QUERY, a grounded exact product/category, a single search/recommendation effect,
ordering phase, and no unresolved finite food-condition topics. It never routes
DIRECT_ACTION straight to ADD_ITEM, nor guesses a contextual answer, nor discards
CHAT/NOISE automatically. Contextual referrals still need finite semantic effect
selection; the PoC does not pretend an independent Reference Resolver is built.
It evaluates all four predeclared thresholds, selecting none for production.
The experiment **rejects this eligibility rule for adoption**: an unrecognized
ingredient question can still pass it and receive only an item-name search.
Read-only does not mean the request was fully understood or answered.

Accepted local searches are actually replayed through the existing resolver and
guard. Every other case reuses its matched, newly measured finite-Jev baseline
for a hybrid **projection**, not an oracle or a second live hybrid run. These
latencies omit ASR/UI/IPC/TTS, model residency startup and any Main Agent work.
Fake Date supports deterministic idle/ticket tests; real HTTP timers and latency
measurements are not faked. Financial confirmation is tested separately; no POS,
table reservation, order submission, or real payment can be initiated.

The original 40-case summary is retained. A separate audit excludes `r23` from
domain metrics because identical additions merged into one line rather than
creating the intended multi-line ambiguity. Frozen inputs and predictions are
not relabeled or rerun. `contract_match` measures the predeclared effect/slot
expectation, not answer completeness: especially `r16` retrieves a real dish but
cannot answer its peanut question. See the second-phase section of [report](./report.md).

## Independent effect and whole-request review

`effectCoverageScenarios.json` freezes32 deliberately paired good/bad application
effect hypotheses before inference. The classifier does not run or resolve any
target. The isolated `apps/order-menu/src/experiments/effectCoveragePoc.ts` reuses
the actual `resolveIntent`, plan compiler and authorization guard, then asks Jev
whether the proposed effect accounts for the **entire** utterance and whether
the provided menu facts can answer its information requests. Unknown recipe
facts are explicit unknowns, not inferred from a missing keyword match.

The six review outcomes are diagnostic findings, **not new classifier classes,
customer choices or WebMCP tools**. A successful review is only a checked
hypothesis: it is neither execution permission nor payment confirmation. No
tools execute; fixtures verify cart isolation, fresh-revision rejection and the
existing separate payment-confirmation requirement.

```sh
pnpm exec vitest run --config test_prompt/turnClassifierPoc/effectCoverage.config.ts
COVERAGE_JEV_URL=https://openjev.aikcitri.qzz.io COVERAGE_WRITE_REPORT=1 pnpm exec vitest run --config test_prompt/turnClassifierPoc/effectCoverage.config.ts
python3 test_prompt/turnClassifierPoc/summarizeCoverage.py
```

The first command is offline; live calls are opt-in and send only the newly
authored artificial menu, state, dialogue and proposed effect. Gold outcomes
are never sent. Recorded replay/summary files refuse replacement. Preserve the
first run; use a separate experiment copy for any subsequent recorded run.
The live runner stops on authentication/rate limits or three consecutive
provider failures. Fixed threshold0.60 is an experimental admission rule only;
it was not selected or adopted for production. Existing models, checkpoints,
calibration, routing, tools and saved settings remain unchanged.

This probes whether an extra same-model review can reject bad hypotheses; it
does **not** measure how often an upstream decision produces those hypotheses,
whole-pipeline latency, Main Agent usage or real operational safety. Its29 HTTP
calls add latency to any prior decision. The supplied hypotheses can influence
the reviewer; paired examples show mutually incompatible effects both receiving
high-confidence approval. No prompt or threshold was tuned after these results.

## Candidate-blind requirement extraction experiment

`requirementScenarios.json` freezes26 turns and32 deliberately injected effect
hypotheses. Two turns (`n13`/`n16`) are known regressions, separately identified;
the other24 are new wording, not independent real traffic. Gold profiles and
hypotheses are assessment data only, never extraction input.

`apps/order-menu/src/experiments/requirementPoc.ts` first sends only the utterance,
recent role-labelled dialogue and current question text. It sends **no menu,
candidate IDs, domain references, plans, slots or classifier result**. Five finite
questions identify first effect, second effect, independent requirement count,
information scope and reference dependency. At most two semantic atoms are
represented; `MORE_THAN_TWO` refers rather than silently truncating.

The resulting profile is reused for every hypothesis of the same turn. A pure
comparison then matches its single explicit effect to the application's real
candidate/resolution. Multiple demands, contextual references, unknown information,
inconsistent answers and low confidence refer. This is not a new target resolver
or state machine. A valid comparison is only a checked hypothesis, not executed
work or proof that a customer-facing answer has been delivered.

```sh
pnpm exec vitest run --config test_prompt/turnClassifierPoc/requirementReplay.config.ts
REQUIREMENT_JEV_URL=https://openjev.aikcitri.qzz.io REQUIREMENT_WRITE_REPORT=1 pnpm exec vitest run --config test_prompt/turnClassifierPoc/requirementReplay.config.ts
python3 test_prompt/turnClassifierPoc/summarizeRequirements.py
```

Live mode parses each turn once **before** presenting any hypothesis, then runs
the unchanged previous reviewer on each matched hypothesis as a separate
baseline. This is an injected-error sensitivity comparison, not encoder or
upstream-route accuracy. All fixtures use an isolated real Menu runtime, with
zero tool calls, POS writes or payment. Live benchmark emits diagnostic profiles
without executing them. Existing production prompts/models/settings do not change.

Admission uses the predeclared0.60 minimum across all five confidence values;
that minimum is a conservative heuristic, **not a calibrated joint probability**.
Each request has a60s timeout; authentication/rate limits or three consecutive
provider failures stop further calls. Artifacts refuse replacement before any
recorded run. Preserve partial failures, and never summarize them as a complete
benchmark. No results-driven prompt, dataset or threshold adjustment is permitted
within this frozen run. The five-question cost is measured rather than assumed
lighter than the previous reviewer.

Completed result: **do not adopt this five-question extractor**. All26 profiles
contradict their own count/second-effect fields and refer; zero false admits also
means zero usable coverage, not improved safety. Exact profiles0/26 (new wording
0/24); all five multi-demand turns are incorrectly counted asONE. Mean blind HTTP
4180.8ms versus the matched reviewer2494.2ms. The matched reviewer still wrongly
accepts9/19 unsupported hypotheses. Full raw results and limitations are in the
fourth-phase section of [report](./report.md). No deduplication, lower threshold,
prompt retuning or production integration was performed after measurement.

## Current production decision versus partitioned candidates (Oct8)

`apps/order-menu/src/experiments/partitionReplay.test.ts` runs the real Server
`decideInteraction` with code-default instructions, then the actual isolated Menu
runtime's resolver, compiler and authorization guard. It does **not** load saved
merchant prompt overrides or the Kiosk ASR/UI lifecycle. A separate test-only
adapter replaces the ordinary route question with seven semantic partitions,
then only the applicable finite action subset. It adds no target extractor,
classifier, operation reviewer, production intent or tool. Special confirmation
protocols, food-condition checks and concrete question-answer validation remain
owned by the existing production code.

`partitionScenarios.ts` freezes44 new synthetic utterances across11 families.
Gold is assessment-only, never provider input. Both modes get equivalent fresh
in-memory carts, dialogues and application-issued candidates; A/B order alternates.
The artificial5-item menu has one noodle category item, literal dish aliases,
no customization and unknown composition. No customer attachment is transmitted.
The partition policy uses a frozen0.60 admission threshold, including leaves;
it differs from the baseline's asymmetric confidence policy. This is an entire
policy comparison, not an isolated proof that fewer candidates caused a gain.

```sh
pnpm exec vitest run --config test_prompt/turnClassifierPoc/partitionReplay.config.ts
PARTITION_JEV_URL=https://openjev.aikcitri.qzz.io PARTITION_RUN=new-label pnpm exec vitest run --config test_prompt/turnClassifierPoc/partitionReplay.config.ts
```

Live mode accepts only the previously approved synthetic Jev endpoint; unique
run labels refuse artifact replacement. Requests are serial,30s timeout, no
retry/model switching,400-call cap. HTTP400/401/403/404/429 or three consecutive
transport failures stop the run; partial results are not complete accuracy.
Raw JSONL captures the actual provider model, state, questions, answers, timings,
application resolution and local cart outcomes. Adapter-reported modelCalls do
not count internal partition/leaf calls; use the independent HTTP/question counts.

Metrics distinguish route/slot contracts, wrong mutations/preparations, compound
partial-effect risk, complete requests mistaken for unfinished speech, refusals,
background admission, and assistance referrals. A correct handoff is **not** a
completed demand; Main Agent, end-to-end clarification, actual display, POS,
payment, ASR and TTS are not tested. Latency is isolated decision wall time, not
customer response time. One sample per turn is not a repeatability estimate.
No thresholds, prompts, labels or production settings are tuned during a run.

Completed frozen44 result: **do not adopt**. Baseline contract17/44 versus
partitioned13/44; refusals8 versus28. Both miss all4 repair and all4 compound
handoffs. Actual partial cart changes2 versus1; high-confidence compound mistakes
remain. Mean decision5724.3ms versus2535.1ms is not equivalent-work acceleration:
many partitioned turns stop before the leaf. Audit phase/configuration changes
separately from cart writes; raw counters remain preserved. Details are in the
Oct8 partition section of [report](./report.md), with [raw paired outcomes](./results/partition-frozen44.jsonl)
and [receipt audit](./results/partition-frozen44Audit.json). This is not a Main
Agent model test, production accuracy estimate or completed bug fix.

## Actual prompt and isolated tool-loop follow-up (Oct8–9)

`apps/server/tests/experiments/assistantComparison.test.ts` freezes16 synthetic
turns with three independent fresh runtimes per turn:

- `jev-front`: actual code-default bounded Jev decision and application execution;
  a Main Agent handoff is recorded, **not** counted as completed service.
- `proposal`: unchanged extraction prompt, strict local schema/source checks,
  experimental literal name/alias binding and real Menu agent guards. Unsupported
  conditions block all proposed writes. Context uses existing issued candidates;
  this is not a production-ready coverage verifier or new resolver integration.
- `tool-agent`: actual Kiosk route prompt construction and persisted tool-call
  history in scratch PGlite, with the development synthetic profile and actual
  Menu tool definitions/guarded execution. Maximum four model rounds. No real
  browser, customer profile, POS, table reservation or payment is connected.

This evaluates operational completion rather than extractor-field accuracy.
Whole-cart expectations, actual mutations, unresolved demand, tool errors,
recommendation repeats, background admission, model rounds and latency remain
separate. Automatic outcome matches require manual receipt/text audit; safe
refusal is not full completion. The Jev arm is not the complete deployed
Jev-plus-production-Main-Agent pipeline, so it cannot establish end-to-end model
superiority.

Offline, from `apps/server`:

```sh
pnpm exec vitest run tests/experiments/assistantComparison.test.ts
```

Opt-in live testing uses a fresh artifact label; never overwrite a run:

```sh
ASSISTANT_COMPARISON_LIVE=1 ASSISTANT_COMPARISON_MODEL=models/gemma-4-26b-a4b-it ASSISTANT_COMPARISON_PROFILE_ID=<stored-google-chat-profile-id> ASSISTANT_COMPARISON_RUN=<new-label> pnpm exec dotenvx run -f .env.local --quiet -- pnpm exec vitest run tests/experiments/assistantComparison.test.ts
```

The explicit profile is read-only credential selection, not a production binding
change. Without it, only an already active single-key Google chat upstream is
accepted. No automatic profile search, provider/model fallback, prompt retuning
or in-request retries occur. Google requests are serial with24RPM/12.8K reserved
tokens/minute; native countTokens measures the serialized full request as text,
then512 conversion headroom and1536 output tokens are reserved. Actual prompt
usage is checked for underestimation. This conservative proxy is not native tool
token equivalence or a shared-project/persistent daily ledger. Provider failures
stop the run; quota wait and count latency are recorded separately from generation.

Artifacts are `results/assistant-<label>.jsonl` (frozen metadata, full synthetic
requests/results and actual receipts) and `results/assistant-<label>Summary.json`.
No credentials or customer attachment contents are recorded. Existing stored
model settings may differ from earlier experiments; the provider metadata records
the active model without changing it. `ASSISTANT_COMPARISON_START_ID` selects a
suffix of the frozen dataset, or `ASSISTANT_COMPARISON_CASE_IDS=a09,a11,a12,a06`
selects explicitly ordered frozen cases. These options are mutually exclusive;
use them for explicitly unmeasured cases or a separately marked human-authorized
service retry as described below, never an automatic retry/resume.
Ordering never changes utterances, gold, prompts or operation policy.
`ASSISTANT_COMPARISON_MODES=jev-front` (or `proposal` / `tool-agent`) selects
independent arms while retaining the same per-case mode rotation. Pair this with
explicit case IDs to measure only previously unmeasured case/arm pairs after a
transport stop; never automatically replay a failed or settled pair. Jev-only
runs do not open the Google credential provider. Summary completeness refers to
the selected slice, not to all48 planned pairs.
If the human explicitly requests a rerun of interrupted pairs, use
`ASSISTANT_COMPARISON_USER_RETRY=1` with those IDs and a new artifact label.
The metadata/summary mark it separately; preserve first-attempt scores/failures.
This starts fresh synthetic runtimes, never resumes a possibly mutated session,
and does not enable automatic provider retries or replay real order operations.
Preserve all partial artifacts and missing failed-turn
execution evidence. New recorder revisions save each tool execution immediately
and a failed-turn state, without rewriting earlier results. See the actual
[partial-run findings](./report.md).
Inspect the recorded run offline:

```sh
node --import tsx tests/experiments/summarizeAssistant.ts <label>
```

## Independent generative Gemini extraction (Oct8, partial)

At the time of the earlier extraction run, the configured and compiled chat model was
`models/gemini-3.5-flash`. This phase tests that model with a **new advisory
extraction prompt**, not the production Main Agent tool loop or its prompt.
Forty synthetic turns/50 requirements are frozen in
`generativeRequirementsScenarios.json`. Only utterance, dialogue and question
text go to Google; no gold, menu, customer logs, target IDs or tools do.

Result: **incomplete**. Full-schema requests returned HTTP400. A separate
JSON-object run received9 valid outputs before `g10` HTTP429 stopped it. All9
effects/counts are correct; strict-field match4/9 includes a gold quantity defect
and ambiguous/redundant query annotations. Compound/context/retraction cases
were not reached. Do not infer model unsuitability, safety or an architecture
win from this prefix. See the manually audited
[report](./generativeRequirements-json-objectReport.md),
[raw outputs](./results/generativeRequirements-json-objectReplay.jsonl) and
[unchanged raw counters](./results/generativeRequirements-json-objectSummary.json).

Offline evaluator tests:

```sh
pnpm exec vitest run --config test_prompt/turnClassifierPoc/generativeRequirements.config.ts
```

Live command, from `apps/server`, only when the user approves provider calls and
availability permits them:

```sh
GENERATIVE_REQUIREMENTS_LIVE=1 GENERATIVE_REQUIREMENTS_MODEL=models/gemma-4-26b-a4b-it GENERATIVE_REQUIREMENTS_RUN=new-trial pnpm exec dotenvx run -f .env.local --quiet -- node --import tsx tests/experiments/runGenerativeRequirements.ts
```

This command runs the complete frozen40-case set; it is not a resume command.
Use a fresh short lowercase run label. Existing artifacts refuse replacement.
The runner reads the compiled chat policy, accepts only one Google upstream/key,
reuses existing credential decryption, and never applies settings. After the
Gemma follow-up it requires an explicit Gemma model override; its supplied quotas
are not assumed valid for Gemini. Older Gemini runs remain preserved artifacts.
HTTP400/401/403/404/429 or three consecutive failures stop calls; no automatic
retry, key rotation or model switch. Default provider thinking remains unchanged;
temperature0, one sample/turn,60s timeout. JSON-object mode does not guarantee
schema compliance; Valibot and literal-evidence checks remain strict.

Local menu feasibility checks are **diagnostics only**, not the production
resolver/guard. Source spans/schema do not establish semantic completeness;
gold comparisons and the manual audit are separate. No live orders, cart, POS,
payment, sessions, WebMCP or UI are touched. No production integration adopted.

### User-requested Gemma4 26B follow-up

Completed40/40 with `models/gemma-4-26b-a4b-it`, no429.34/40 schema/evidence-valid;
18/40 exact field contracts; compound5/6. HTTP mean4431.7ms/P957884.9ms excludes
pacing/preflight. Not adopted: checkout「好」misinterpreted, bento scope dropped,
overlapping REMOVE+REPLACE, invalid array/empty-list envelopes. Other mismatches
include annotation/context-flag ambiguities, so18/40 is not production accuracy.
Read the manually audited
[Gemma report](./generativeRequirements-gemma4-26b-pacedReport.md).

Same frozen prompt/gold; reordered to prioritize compound/context cases.
Model override is per-request only, not a saved/applied production policy.
The command above reruns40 with a unique label, not a resume mechanism.

Runner reserves24 dispatches/minute and12,800 generative input tokens/minute,
20% below supplied RPM30/TPM16K. Tokenizer/generation calls both consume local
RPM. Full prompt count +128 tokens is reserved before generation; if actual
usage exceeds reservation, stop. Preflight failures also stop. Output capped2048;
preflight/pacing recorded separately from HTTP time. The11,520 per-run request
cap is **not** a persistent daily/global ledger; supplied RPD14,400 and other
project usage remain externally owned. Stop on429 regardless of local budget.
49 offline assertions validate evaluator/quota policy; no production integration.

## Run the approved local experiment

Python3.13 and `uv` were used in an isolated `.venv`; no root dependencies change.
Use the pins below, or `environmentFreeze.txt` for the full observed environment.
The model revision, C=1 heads, seed42, SetFit60-step training and calibration grid
are fixed in `runLocal.py`. Preparation downloads the public model only; training
and measurement are local and do not upload utterances or models.

```sh
UV_CACHE_DIR="$PWD/test_prompt/turnClassifierPoc/.cache/uv" uv venv --python python3.13 test_prompt/turnClassifierPoc/.venv
UV_CACHE_DIR="$PWD/test_prompt/turnClassifierPoc/.cache/uv" uv pip install --python test_prompt/turnClassifierPoc/.venv/bin/python -r test_prompt/turnClassifierPoc/requirements.txt
test_prompt/turnClassifierPoc/.venv/bin/python test_prompt/turnClassifierPoc/runLocal.py prepare
test_prompt/turnClassifierPoc/.venv/bin/python test_prompt/turnClassifierPoc/runLocal.py train
test_prompt/turnClassifierPoc/.venv/bin/python test_prompt/turnClassifierPoc/runLocal.py measure
```

After environment setup, a fresh local run can also use one command:

```sh
test_prompt/turnClassifierPoc/.venv/bin/python test_prompt/turnClassifierPoc/runLocal.py experiment
```

Existing training/measurement artifacts are deliberately not overwritten. Run a
fresh experiment in a separate copy of this PoC directory, with the frozen corpus;
do not delete unrelated files or change labels after reading test results.
`prepare` uses a pinned Hugging Face snapshot with safetensors and no remote code;
CPU workers load only local files. Model heads are numeric NPZ, not executable pickle.
Models, downloaded cache and the venv are git-ignored; JSON results remain auditable.

For Jev calibration, run its validation split once (same frozen prompt) and fit
the validation-only scalar. Existing Jev held-out outputs are reused, not resent.

```sh
python3 test_prompt/turnClassifierPoc/benchmark.py jev --endpoint https://openjev.aikcitri.qzz.io/v1/systemone --split validation --output test_prompt/turnClassifierPoc/results/jevValidation.json
test_prompt/turnClassifierPoc/.venv/bin/python test_prompt/turnClassifierPoc/runLocal.py calibrate-jev
```

Generate the complete report JSON with a new output path:

```sh
python3 test_prompt/turnClassifierPoc/benchmark.py report --input test_prompt/turnClassifierPoc/results/jevTest.json test_prompt/turnClassifierPoc/results/jevCalibratedTest.json test_prompt/turnClassifierPoc/results/frozenRawTest.json test_prompt/turnClassifierPoc/results/frozenTest.json test_prompt/turnClassifierPoc/results/similarityRawTest.json test_prompt/turnClassifierPoc/results/similarityTest.json test_prompt/turnClassifierPoc/results/setfitRawTest.json test_prompt/turnClassifierPoc/results/setfitTest.json --output test_prompt/turnClassifierPoc/results/comparisonCopy.json
```

Every local output has80 held-out records, raw and calibrated scores and three
actual per-turn timing trials. Process-load and memory measurements come from one
fresh interpreter per model, not a training process with several loaded models.
No disk-cache flushing or remote cold-start claim is made. Similarity's raw cosine
confidence is not a posterior; its calibrated output uses validation-fitted softmax.

The dependency-free runner is available now:

```sh
python3 test_prompt/turnClassifierPoc/benchmark.py audit
python3 test_prompt/turnClassifierPoc/benchmark.py jev --endpoint https://openjev.aikcitri.qzz.io/v1/systemone --output test_prompt/turnClassifierPoc/results/jevTest.json
python3 test_prompt/turnClassifierPoc/benchmark.py report --input test_prompt/turnClassifierPoc/results/jevTest.json --output test_prompt/turnClassifierPoc/results/summary.json
```

Remote requests are opt-in. The endpoint receives only hand-written synthetic
utterances and the eight-class prompt, never other threads or customer traces.
Use a fresh output path for a fresh benchmark; `--resume` skips completed IDs and
requires identical dataset, prompt, split and endpoint. Recorded provider failures
are not silently retried. Stop immediately on 401/403/429 or after three successive
failures. Partial bundles cannot pass the complete-report check.

The evaluation distinguishes valid-output accuracy from total operational accuracy
(which includes provider failures). A failure is not a model's wrong class.
Per-turn outputs are exactly `{class, confidence, latency_ms}` under `prediction`;
IDs, probabilities and provenance are separate benchmark metadata.

Candidates researched using primary documentation (MiniLM plus SetFit was selected):

| Candidate | Experiment | Trade-off |
| --- | --- | --- |
| [Multilingual MiniLM](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | Frozen 384-dimensional encoder + classification head; same encoder's similarity baseline | Isolates head learning from encoder finetuning; actual Chinese accuracy must be measured |
| [SetFit](https://huggingface.co/docs/setfit/en/conceptual_guides/setfit) on MiniLM | Contrastive finetuning followed by a classification head | A training method, not a separate backbone; additional training time and overfitting risk |
| [Multilingual E5 small](https://huggingface.co/intfloat/multilingual-e5-small) | Encoder + classification head | 384 dimensions; use documented `query: ` prefix even for Chinese classification features |
| [BGE-M3](https://huggingface.co/BAAI/bge-m3) | Potential later encoder comparison | 1024 dimensions and long-document/retrieval features; not needed to answer this first short-turn experiment |

Use an isolated Python environment if selected, not AIRI's production dependency
graph. The repository already has independent Python/Node evaluation scripts; this
experiment does not introduce a production Python service.

## Input and labels

All models receive **only the current utterance**, with the same eight class
definitions. No model receives gold labels, dataset group IDs, historical customer
records, or a menu. Jev is evaluated as an eight-class Turn Classifier; this is
**not** the same task as the existing state-aware Kiosk domain decision. The earlier
26-case runtime prompt experiment is a separate reference, not a directly
comparable accuracy baseline.

Flat labels overlap, so this PoC uses explicit priority rules:

1. Multiple independent requests, meaningful unfinished speech, unresolved
   self-repair, or merely tentative approval → `UNCERTAIN`.
2. Clear cancellation, refusal, or restoration → `CANCEL_OR_REVERT`.
3. Clear modification of an existing choice → `MODIFICATION`.
4. A deictic/reference-bound request or bare answer whose effect depends on a
   question → `REFERENCE`, including reference-bound queries.
5. Otherwise an explicit menu/information/recommendation request → `QUERY`;
   an expressed request to choose/order/change screen → `DIRECT_ACTION`.
6. Meaningful non-transaction conversation → `CHAT`; no meaningful recoverable
   speech → `NOISE`. Unsupported residual interpretations → `UNCERTAIN`.

Examples: `我要那個` and `那個會辣嗎` are `REFERENCE`; `改兩份` is
`MODIFICATION`; `不要辣` is not cancellation. `好`, `一位`, `微辣` are
`REFERENCE`, **not consent or an executable answer**. `不用` is refusal-shaped,
but the classifier cannot determine what was refused. `我想吃便當` and
`我想吃麵，一碗` are `DIRECT_ACTION` turn forms; this does not claim either is
`ADD_ITEM`. A future domain resolver must still distinguish category browsing
from named ordering. `我今天好餓` follows the requested `CHAT` convention, not a
guarantee that a real hungry customer never wants help.

`UNCERTAIN` as a gold linguistic class differs from threshold abstention: any
class can have low confidence and require fallback. Noise markers are synthetic
ASR placeholders; separately inspect marker-free noise performance. Text alone
cannot reliably distinguish identical speech directed at a companion vs Kiosk.
The PoC does not claim to solve that impossibility.

## Dataset and evaluation protocol

`corpus.json`: 400 individually written utterances, eight balanced classes of 50.
Each class has ten named-by-position phrase families, five utterances per family.
Six families train (240 total), two calibrate (80), two remain held out (80).
Families never cross splits; there is no template substitution generator. Some
shared vocabulary is intentional, but this is not a guarantee against all semantic
similarity or pretrained model contamination. Splits and labels must be frozen
before inspecting benchmark results.

The cases reflect prior failure families: existence query mistaken for ordering,
category vs product, alias-shaped speech, quantity/party/spice answers, refusal,
food exclusions vs removal, compound demands, self-repair and background speech.
New synthetic sentences are not excerpts of customer traces. Simplified characters
and punctuation variation in a few samples represent plausible ASR output.

Measure per-class precision/recall/F1, macro F1, accuracy, confusion matrix, mean
and P50/P95 single-turn latency. Fit confidence calibration only on calibration
data, then evaluate reliability bins, ECE and multiclass Brier score on held-out
data. Keep raw and calibrated results separate. Similarity is not a probability.
Jev's reported confidence is also not a calibrated correctness probability.

Measure cached-model cold process startup separately from model download, and
first inference separately from warm inference. Report local process memory/RSS
and hardware/device; do not invent remote Jev model memory or cold start when the
remote service cannot expose them. Training memory is not inference model memory.
Local inference and remote HTTP latency have different transport costs, explicitly
retained because those costs matter for proposed deployment.

## Routing simulation, not order execution

At thresholds 0.70 / 0.80 / 0.90 / 0.95:

- Low confidence or `UNCERTAIN` → Jev fallback.
- High-confidence `REFERENCE` / `MODIFICATION` / `CANCEL_OR_REVERT` → contextual
  resolver, including uncertain targets rather than guessed ones.
- High-confidence `DIRECT_ACTION` / `QUERY` → domain resolver, not execution.
- High-confidence `CHAT` / `NOISE` → separate non-execution handling. These are not
  counted as direct domain operations or implicitly sent to Main Agent.

Report all four shares, selective classification error, contextual turns wrongly
sent directly, and projected classification latency (encoder plus Jev only on
fallback). Unknown resolver runtime and correctness remain **unmeasured**. A
contextual referral is not counted as a successfully resolved order, nor is it
given an oracle answer. Mixed classifier/Jev class accuracy can be compared only
on the same held-out IDs with valid outputs from both models; provider failures
must remain visible rather than silently disappear.

## Architecture implications

The PoC does not change today's structure. Future adoption would add a first-line
route and reuse validated domain planning, revision/target/slot guards and WebMCP
authorization. It must not introduce a second order state machine, guess targets,
turn confidence into consent, or make old questions mandatory gates. Main Agent
is a conditional escalation branch, not an obligatory stage after every WebMCP
operation. This first classifier experiment cannot establish end-to-end resolver
stability, payment safety, Main Agent frequency, or production traffic coverage.
