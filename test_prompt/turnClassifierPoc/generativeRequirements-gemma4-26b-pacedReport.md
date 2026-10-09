# Generative requirements extraction — independent Google model experiment

Model: `models/gemma-4-26b-a4b-it`; returned models: models/gemma-4-26b-a4b-it.

Complete: true. Attempted 40/40; successful HTTP responses 40.
Schema + literal evidence valid 34/40; whole-turn semantic-field exact 18/40.
Requirement multiset precision 0.6889, recall 0.6200 (31 matched / 50 gold / 45 produced).

HTTP mean 4431.7ms, P50 3551.2ms, P95 7884.9ms.
First call 7884.9ms is not a proven cold start.

## Conclusion and critical audit

**Do not integrate this extractor into production yet.** All three dishes,
quantities and separate options are retained in g13; compound contracts5/6
match. Delayed「一位」is PARTY_SIZE1 and「還是內用好了」is dine-in, not a forced
answer to the pending checkout question. These are advisory results, not order
execution or verification of session retention. Model substitution alone does
not fix the workflow.18/40 strict-field match is **not45% production accuracy**
and does not imply22 unsafe operations.

| Case | Observed result | Interpretation |
| --- | --- | --- |
| g13 three dishes/options | Three ADDs, quantities1/2/1, per-dish conditions | Complete extraction. Program separately flags unavailable eel and unsupported customization; no execution. |
| g17 inconsistent total | Two dishes plus summaryCount3 | Program flags contradiction without inventing a third dish. |
| g18/g20「一位」 | PARTY_SIZE1, contextRequired=false | Correct number, wrong context flag. This flag must not bypass question/session binding. |
| g21「還是內用好了」 | FULFILLMENT dine-in, contextRequired=true | Correct desired change; conservative flag differs from gold. |
| g22「好」to checkout-entry question | CHAT | Genuine missed service intent despite explicit currentQuestion. |
| g03「我想吃便當」 | RECOMMEND, targetRaw=null | Conflicts with current ADD policy and loses bento scope. |
| g29 replacement | REPLACE fields, root array, contextRequired=true | Rejected by schema; no replacement operation evaluated. |
| g30「水餃不要了，換成牛肉麵兩碗」 | REMOVE plus REPLACE, root array | Format failure AND overlapping effects. Unwrapping JSON would not make this safe. |
| g08/g09 bento queries | Correct QUERY/price limit, targetRaw=null | Structured category scope missing; raw source still contains it, but resolution not completed. |
| g11 other recommendations | RECOMMEND_NEXT, contextRequired=false | Correct effect, missing batch-context dependency flag; menu progression not tested. |
| g02/g38 one portion | Correct ADD/quantity, invented summaryCount1 | Quantity duplicated into a total never stated. |

Six schema failures are five root arrays (g15/g29/g30/g25/g39) and one empty
requirements list (g34), not malformed JSON or output truncation. No unwrapping,
empty-list conversion, retry or output repair was performed during scoring.

Other strict mismatches require contract review:

- g05 retains availability and price as two QUERY entries rather than a single
  multi-topic QUERY. Both questions remain present. Frozen gold also omits
  explicit「一份」quantity, as already identified in the Gemini audit; atom
  grouping/quantity contracts need clarification, not a claim of wrong ADD.
- g06 adds「有花生嗎」as a condition: ingredient-question subject versus filter
  is underspecified. No recipe or peanuts claim is made.
- g26 uses「那份」rather than「剛剛那份」; a reference-span mismatch, not proof
  of wrong target binding (no binding occurs here).
- g31 correctly retains final bento ADD but puts retracted dumplings in
  unresolved; this can cause unnecessary follow-up.
- g32 emits REMOVE for「水餃兩份不要了」where gold assumes an in-turn
  retraction. No cart state is supplied, so deletion of a prior cart line is
  also a possible reading. This is a context/contract ambiguity, not authorized
  deletion. Both other ADDs are retained.
- g35 preserves completed ADD and unfinished fragment, conservatively marking
  the latter contextual. g34 preserves unfinished text in unresolved but omits
  the required UNFINISHED representation. g39 preserves VIEW but treats explicit
  「不要加入」as unresolved and violates the object envelope.

Gold is unchanged; no frozen regrading or prompt tuning to raise the score.
This supports improving the general proposal/atom contract and independently
binding context/targets in application code, not routing every turn through
Gemma or adding phrase-specific patches. No extra classifier or model reviewer
was introduced.

## Quota, comparison and validation

User limits: RPM30, input TPM16,000, RPD14,400. Local admission keeps20% headroom:
24 dispatches/minute,12,800 generative input tokens/minute. The11,520-request
per-run cap is **not a persistent/project-global RPD ledger**. Other project
usage and remaining daily quota are unknown;429 still stops the experiment.
[Google quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

Measured run:80 API calls (40 token counts +40 generations), no429/timeouts/HTTP
failures. Prior catalog lookup and2-call artificial g13 pilot are readiness
checks outside these80 calls; the pilot did not change prompt or gold. Every
generation reserves the model's full prompt count +128 overhead tokens. Actual
input stayed within reservations on all40 responses:40,324 input/5,356 output
tokens **over the whole run, not per minute**; reserved input45,404. Pacing wait
43,872ms. HTTP latency excludes preflight/pacing. All finish reasons stop, none
hit2048 output cap. [Token counting](https://ai.google.dev/api/tokens).

The selected ID appears in the authenticated live catalog and Google's
[hosted Gemma26B list](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api).
Dataset and system prompt hashes match the prior JSON-object Gemini run. Model,
case order/scheduling and2048 output cap differ; production model remains
`models/gemini-3.5-flash` as recorded at startup. Gemini previously completed
only9/40, so no full-model quality/latency superiority claim is possible. This
is single-sample synthetic evaluation, not a stability study.

49 targeted Vitest tests, scoped ESLint and strict TypeScript check of the pure
quota module pass; full-project typecheck not run. Tests cover RPM/TPM, combined
constraints, expiry and no reset/refund on failures. Module-design separation
keeps model/budget overrides in experiments only. Formal Main Agent/Jev prompts,
model selection, menu, sessions, WebMCP and order execution are unchanged.

## Frozen subgroup results

| Group | Exact / total |
| --- | --- |
| single | 1/3 |
| query | 2/7 |
| recommendation | 1/2 |
| compound | 5/6 |
| context | 4/8 |
| reference | 0/2 |
| modification | 2/4 |
| revert | 1/3 |
| unfinished | 0/2 |
| chat | 2/2 |
| asr | 0/1 |

## Failures to inspect

- g15: OK; requirement_count, INVALID_SCHEMA
- g20: OK; contextRequired
- g18: OK; contextRequired
- g21: OK; contextRequired
- g29: OK; requirement_count, INVALID_SCHEMA
- g30: OK; requirement_count, INVALID_SCHEMA
- g31: OK; unresolved
- g32: OK; effect, targetRaw, quantity, requirement_count
- g35: OK; contextRequired
- g02: OK; summaryCount
- g03: OK; effect, targetRaw
- g05: OK; queryTopics, requirement_count
- g06: OK; conditions
- g08: OK; targetRaw
- g09: OK; targetRaw
- g11: OK; contextRequired
- g22: OK; effect
- g25: OK; requirement_count, INVALID_SCHEMA
- g26: OK; targetRaw
- g34: OK; requirement_count, INVALID_SCHEMA
- g38: OK; summaryCount
- g39: OK; requirement_count, INVALID_SCHEMA

## Limits and artifacts

- New extraction prompt and schema, not the existing Main Agent prompt/tool loop.
- Forty synthetic challenge turns, not traffic accuracy or production safety.
- Single sample per turn, no stability test, no same-model judge or retuning.
- Literal evidence/schema validity is not semantic correctness; authored gold measures fields.
- No domain-plan execution, ASR, session lifecycle, tool receipts, checkout/payment or UI tested.
- No comparable Jev run on this schema; prior finite-question results are a different experiment.
- Remote HTTP latency only. Memory, actual cold start and end-to-end latency not measured.

Inputs/prompt/schema hashes and request settings are recorded before inference. No gold/menu facts sent. No production settings changed, no tool definitions, no action authorization. No retries or prompt adaptation within the frozen run.

[Frozen scenarios](./generativeRequirementsScenarios.json), [prompt](./generativeRequirementsPrompt.txt), [raw evidence](./results/generativeRequirements-gemma4-26b-pacedReplay.jsonl), [summary](./results/generativeRequirements-gemma4-26b-pacedSummary.json).

Transport: JSON-object mode with an explicit schema in system instructions and strict application validation. Earlier complex schema requests were HTTP400 (not semantic failures); no schema-constrained output guarantee is claimed for this run. [Google OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).
