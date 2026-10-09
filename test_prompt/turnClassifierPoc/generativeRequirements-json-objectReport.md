# Generative requirements extraction — independent Gemini experiment

Model: `models/gemini-3.5-flash`; returned models: models/gemini-3.5-flash.

**Incomplete — no adoption conclusion.** Attempted10/40; successful HTTP
responses9. `g10` returned HTTP429; the runner stopped without retrying,
switching keys/models, changing production policy, or treating it as CHAT.

All9 received outputs pass schema and literal-evidence validation. Frozen exact
semantic-field match is4/9 **among received outputs**, not4/40 model accuracy.
All9 effects and requirement counts agree with gold (3 ADD, 6 QUERY). These are
only the simple prefix of the challenge, not a representative random sample.

The raw summary's recall0.0800 uses all50 gold requirements including unmeasured
turns as its coverage denominator; it is **not semantic accuracy or operational
recall**. No valid whole-benchmark precision/recall conclusion is possible from
this stopped run. Keep raw counters unchanged for reproducibility.

## Manual assessment audit (no rerun or gold rewriting)

- `g05`: **gold defect**. Input says「一份多少錢」; prompt says preserve explicit
  quantities. Model QUERY quantity1 is supported. Frozen gold omitted it. Do not
  attribute this mismatch to poor model understanding or an ADD authorization.
- `g06`: QUERY/COMPOSITION is correct. Model additionally retains「有花生嗎」
  as a condition. The schema/prompt does not clearly distinguish a question's
  ingredient subject from an include/exclude filter. Contract ambiguity, not
  evidence that the model asserted peanuts exist or ordered food.
- `g07`: QUERY/DIET and「素食」are retained. Model targetRaw「素食餐點」and
  additional AVAILABILITY are literal/plausible query annotations. No menu facts
  were supplied, and no vegetarian dish or recipe was invented. This is **not**
  a reproduction of the existing Main Agent hallucinated recommendation.
- `g08`: QUERY/CATEGORY is correct; additional AVAILABILITY is redundant and
  not clearly forbidden by the contract.
- `g09`: QUERY/PRICE_FILTER and「一百五以下」are correct; additional CATEGORY
  is likewise redundant. No price conversion or actual filtering was tested.

Thus5 strict mismatches do not establish5 unsafe semantic decisions. Gold and
the contract need independent review before a later held-out benchmark; do not
retune this frozen run to manufacture a better score. The raw output remains
available for alternate interpretations.

The core question remains **unanswered**: `g12`–`g17` compound requests,
`g18`/`g20` delayed「一位」, `g21` fulfillment interruption, `g24` ambiguous「對」,
`g29`/`g30` replacement, and `g31`/`g32` retraction were not reached. Continue
those unmeasured cases only after provider availability is clarified. No
classifier, production extractor, new tool or revised decision threshold was
adopted.

HTTP mean 3997.2ms, P50 3714.0ms, P95 5859.6ms.
First call 3104.4ms is not a proven cold start.

## Frozen subgroup results

| Group | Exact / total |
| --- | --- |
| single | 3/3 measured; 3/3 exact |
| query | 6/7 measured; 1/6 frozen exact (audit above) |
| recommendation | 0 valid outputs; g10 HTTP429 |
| compound | not measured |
| context | not measured |
| reference | not measured |
| modification | not measured |
| revert | not measured |
| unfinished | not measured |
| chat | not measured |
| asr | not measured |

## Failures to inspect

- g05: OK; quantity
- g06: OK; conditions
- g07: OK; targetRaw, queryTopics
- g08: OK; queryTopics
- g09: OK; queryTopics
- g10: HTTP_ERROR; no usable proposal

## Limits and artifacts

- New extraction prompt and schema, not the existing Main Agent prompt/tool loop.
- Forty synthetic challenge turns, not traffic accuracy or production safety.
- Single sample per turn, no stability test, no same-model judge or retuning.
- Literal evidence/schema validity is not semantic correctness; authored gold measures fields.
- No domain-plan execution, ASR, session lifecycle, tool receipts, checkout/payment or UI tested.
- No comparable Jev run on this schema; prior finite-question results are a different experiment.
- Remote HTTP latency only. Memory, actual cold start and end-to-end latency not measured.

Inputs/prompt/schema hashes and request settings are recorded before inference. No gold/menu facts sent. No production settings changed, no tool definitions, no action authorization. No retries or prompt adaptation within the frozen run.

[Frozen scenarios](./generativeRequirementsScenarios.json), [prompt](./generativeRequirementsPrompt.txt), [raw evidence](./results/generativeRequirements-json-objectReplay.jsonl), [summary](./results/generativeRequirements-json-objectSummary.json).

Transport: JSON-object mode with an explicit schema in system instructions and strict application validation. Earlier complex schema requests were HTTP400 (not semantic failures); no schema-constrained output guarantee is claimed for this run. [Google OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).

## Transport diagnostics and validation

The configured active profile and compiled runtime both select
`models/gemini-3.5-flash` at Google's compatibility endpoint. A fresh model
catalog GET includes this ID; a minimal ordinary chat and a minimal single-field
json_schema request both succeeded. The first full schema and a version using
an equivalent nullable union both returned HTTP400/INVALID_ARGUMENT before any
model text. The provider did not identify a field; **the exact schema rejection
cause is not established**. Keep both stopped runs; do not count them as model
classification errors. This JSON-object run changes format enforcement, not
the semantic instructions or gold labels; its system instructions/hash are
saved in replay metadata.

Offline validation:45 targeted Vitest assertions passed, including invented
source/quantity, partial requests, wrong effects, duplicate ADD, misplaced
conditions, unresolved references and unsupported menu options. Scoped ESLint
passed (environment emits a CommonJS/ESM experimental warning). These are
evaluator checks, not45 live model successes. Full-project typecheck not run.

This experiment follows the module-design separation of advisory extraction
from target resolution and execution authority. Existing Main Agent prompts,
Jev prompts, deriveDecisionContext, resolveIntent, WebMCP, sessions and menus
are unchanged. Credentials stay in memory and never enter artifacts; only
artificial utterances/dialogue are sent.
