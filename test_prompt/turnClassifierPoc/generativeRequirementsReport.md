# Generative requirements extraction — independent Gemini experiment

Model: `models/gemini-3.5-flash`; returned models: .

This attempt stopped on the first HTTP400 response, before any model output.
The zero counters below are **not a model accuracy result**; all40 semantic
cases remain unevaluated in this attempt. Preserve it as transport-failure evidence.
Minimal chat without schema succeeded. Diagnostic schema request returned
`INVALID_ARGUMENT` without a field-specific explanation. A separately named
run will isolate the nullable enum representation without changing gold/prompt.

Complete: false. Attempted 1/40; successful HTTP responses 0.
Schema + literal evidence valid 0/40; whole-turn semantic-field exact 0/40.
Requirement multiset precision 0.0000, recall 0.0000 (0 matched / 50 gold / 0 produced).

HTTP mean N/Ams, P50 N/Ams, P95 N/Ams.
First call 1066.9ms is not a proven cold start.

## Frozen subgroup results

| Group | Exact / total |
| --- | --- |
| single | 0/3 |
| query | 0/7 |
| recommendation | 0/2 |
| compound | 0/6 |
| context | 0/8 |
| reference | 0/2 |
| modification | 0/4 |
| revert | 0/3 |
| unfinished | 0/2 |
| chat | 0/2 |
| asr | 0/1 |

## Failures to inspect

- g01: HTTP_ERROR; no usable proposal

## Limits and artifacts

- New extraction prompt and schema, not the existing Main Agent prompt/tool loop.
- Forty synthetic challenge turns, not traffic accuracy or production safety.
- Single sample per turn, no stability test, no same-model judge or retuning.
- Literal evidence/schema validity is not semantic correctness; authored gold measures fields.
- No domain-plan execution, ASR, session lifecycle, tool receipts, checkout/payment or UI tested.
- No comparable Jev run on this schema; prior finite-question results are a different experiment.
- Remote HTTP latency only. Memory, actual cold start and end-to-end latency not measured.

Inputs/prompt/schema hashes and request settings are recorded before inference. No gold/menu facts sent. No production settings changed, no tool definitions, no action authorization. No retries or prompt adaptation within the frozen run.

[Frozen scenarios](./generativeRequirementsScenarios.json), [prompt](./generativeRequirementsPrompt.txt), [raw evidence](./results/generativeRequirementsReplay.jsonl), [summary](./results/generativeRequirementsSummary.json).

Structured output transport follows [Google OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai#structured-output); semantic correctness is independently assessed, not guaranteed by that format.
