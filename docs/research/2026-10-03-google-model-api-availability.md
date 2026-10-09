---
title: Google Gemini and Gemma model API availability
date: 2026-10-03
category: research
module: Provider integration
problem_type: research
tags:
  - google
  - gemini
  - gemma
  - providers
---

# Google Gemini and Gemma model API availability

## Scope and conclusion

This note checks whether AIRI can try the Google models requested on
2026-10-03. **Yes, for the Google AI Studio / Gemini Developer API route:**
AIRI already has a `google-generative-ai` chat provider that targets Google's
OpenAI-compatible endpoint. It accepts an API key and performs connectivity,
model-list, and chat-completions validation. Its default endpoint is
`https://generativelanguage.googleapis.com/v1beta/openai/`.
[`google-generative-ai` provider](../../packages/stage-ui/src/libs/providers/providers/google-generative-ai/index.ts)

The smallest no-code experiment is therefore to configure a Gemini API key in
that provider, select an actually listed model, and run its existing validation.
This provider is an OpenAI-compatible `chat/completions` integration; it is not
a Vertex AI integration and does not expose the native Gemini API feature set.
No key was used and no live provider request was made for this research.

## Current Google API model choices

| Intended trial | Exact model ID | Google API route | Notes |
| --- | --- | --- | --- |
| General low-latency Gemini | `gemini-2.5-flash` | Gemini API / AI Studio | Google describes it as price-performance oriented for low-latency, high-volume reasoning work. |
| Lower-cost Gemini | `gemini-2.5-flash-lite` | Gemini API / AI Studio; Vertex AI | Google calls it the fastest and most budget-friendly multimodal model in the 2.5 family. |
| Hosted Gemma 4 | `gemma-4-26b-a4b-it` | Gemini API / AI Studio | Google documents this as a supported hosted Gemma 4 instruction-tuned model and supplies `generateContent` and JavaScript examples. |
| Larger hosted Gemma 4 | `gemma-4-31b-it` | Gemini API / AI Studio | The other Gemma 4 model Google explicitly lists as hosted by the Gemini API. |

Google's current Gemini model catalog also says that access to the 2.5 models is
limited to users who have actively used them; for *new* projects it recommends
newer Flash-family models. That is an availability policy rather than a code
compatibility guarantee, so the selected key must be checked before promising a
model to users. [Gemini API model catalog](https://ai.google.dev/gemini-api/docs/models)

## Is “Gemma 4” real, and is it an API model?

Yes. Gemma 4 is Google's open-weight model family, not a typo for Gemini. The
family includes E2B, E4B, 12B, 26B A4B, and 31B variants; Google documents
downloads for self-hosted/local use. [Gemma 4 overview](https://ai.google.dev/gemma/docs/core)

Separately, Google documents **hosted** Gemini API access to exactly
`gemma-4-31b-it` and `gemma-4-26b-a4b-it`. It requires a Gemini API key from
Google AI Studio. This makes the two IDs appropriate to test through AIRI's
current Google provider if they appear in that key's discovered model list.
[Run Gemma with the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)

The other Gemma 4 variants should not be assumed to be hosted by the Gemini
Developer API merely because they can be downloaded. Their normal route is
download/self-hosting, or a separately configured Google Cloud Model Garden /
Vertex deployment. [Get started with Gemma](https://ai.google.dev/gemma/docs/get_started)

## Connection routes and recommendation

Google officially supports its OpenAI-compatible endpoint with an AI Studio
`GEMINI_API_KEY`, the same base URL already used by AIRI. It recommends its
native Gemini API when an app is not otherwise committed to an OpenAI library.
[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

For an initial AIRI experiment, retain the existing provider and try in this
order after model discovery:

1. `gemini-2.5-flash-lite` for a cost/latency baseline.
2. `gemini-2.5-flash` for the quality comparison.
3. `gemma-4-26b-a4b-it` to compare the hosted open-weight model.

Use `gemma-4-31b-it` only as the larger comparison point, not as the default.
This ordering is an implementation recommendation inferred from Google's model
positioning; it is not a benchmark result.

Use a native `@google/genai` provider only if AIRI needs Gemini-specific
features unavailable or incomplete in OpenAI compatibility. Google positions
the Interactions API as the recommended route for new projects, while the
original `generateContent` API remains supported. Its documented default
storage policy is also material: interactions are stored by default unless
`store=false` is set, and stateful continuation then cannot be used.
[Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)

Vertex AI is a distinct GCP route. Google documents
`gemini-2.5-flash-lite` there under the same ID, but it requires a Google Cloud
project, billing, and the Vertex AI API. That is not interchangeable with
inserting an AI Studio key into AIRI's existing endpoint configuration.
[Vertex AI Gemini 2.5 Flash-Lite](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite)

## Validation boundary

Before implementation or a product claim, use the configured provider's model
list check for the target AI Studio key and then one non-sensitive chat request.
Model access can vary by account, geography, quota, and billing tier. Do not
put a Gemini API key in tracked configuration, test fixtures, logs, or this
research note.
