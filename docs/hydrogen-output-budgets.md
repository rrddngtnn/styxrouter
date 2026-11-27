# Hydrogen output budget policy

Exact Antigravity Hub IDs `gemini-4-hydrogen-{low,medium,high,xhigh}` now use a **32,768-token** output fallback when the request supplies no budget. This deliberately changes the old omitted-wire behavior: omission previously let upstream choose its default; it did not mean unlimited output. This is not a measured upstream default or a promise of 32K final-answer text. Thinking and answer share the output allowance.

Selection order: explicit `max_completion_tokens` (wins when both are supplied), explicit `max_tokens`, exact configured per-model default, verified supported default (generic policy interface; none asserted for Hydrogen), configurable fallback. Clamp to the smaller of the existing model capability override and Hub's discovered `maxOutputTokens=262144`. The context `maxTokens=1048576` is not an output limit. Existing parameter block rules suppress fallback reinjection. Zero/invalid explicit values are not replaced with larger defaults; existing HTTP validators remain responsible for rejection.

`STYX_GENERATION_DEFAULTS` is optional JSON process configuration, not a new database setting or panel API. Example:

```json
{"models":{"antigravity/gemini-4-hydrogen-low":8192},"fallbackMaxTokens":32768}
```

Only exact canonical per-model keys match; no tier inheritance. Unset configuration selects the documented Hydrogen product fallback of 32768. A positive integer fallback changes the enabled Hydrogen family only; it does **not** activate a blanket global default. Invalid JSON is ignored; invalid noninteger defaults are not selected. The reusable pure resolver refuses fallback if its caller cannot supply a verified positive output ceiling. No other provider is opted in. No private account IDs, persona text or operator preferences are embedded.

The existing `max_output_tokens` capability override is a **ceiling**, not a generation default. It continues to constrain explicit requests and defaults. This patch adds a distinct exact-model generation-default configuration rather than reinterpreting that capability field.

The executor's unknown-model 16384 compatibility ceiling previously still clamped these newly discovered IDs after conversion. Exact Hydrogen IDs now use their discovered 262144 output ceiling, preserving lower operator limits. Unknown models retain the historical compatibility ceiling. Native tier IDs remain unchanged; no numeric `thinkingBudget` is injected and tier enum 100 is never interpreted as 100 tokens.

Management Test Model uses 32768 tokens / 60 seconds for those four canonical IDs only. Other probes retain 8 tokens / 10 seconds. This is an upper budget, not an automatic charge; no live inference is part of these tests.

## Scope inventory

- Antigravity Cloud Code converter and executor: enabled only for exact Hydrogen tiers, streaming and nonstreaming.
- Other Antigravity models: unchanged converter defaults and executor unknown-model fallback; 45 differential converter fixtures cover five legacy families.
- Native Gemini/Vertex converter: unchanged.
- OpenAI-compatible/default executor and GLM: existing `requestDefaults.maxTokens` helper unchanged.
- Responses/Codex, Anthropic, Kiro, web/session, specialty and other provider executors: untouched; their parameter dialect, native defaults and hard limits were not all verified, so no global activation is safe or claimed.

Catalog visibility, fixture wire budgets and live inference are separate acceptance gates. No new live request, credential refresh, production edit or restart is authorized by applying this local source patch.
