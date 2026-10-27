# Model naming and routing semantics

This document describes how models are identified, discovered, routed, and
verified across all providers in StyxRouter. It is the reference for anyone
adding a new model, a new provider, or changing the catalog. Follow it
consistently — mixed naming between providers is the single biggest source of
operator confusion.

## 1. Canonical model ID: `provider/model-id`

Every model is identified by a two-part, slash-delimited ID:

```
<provider-id>/<model-id>
```

- `<provider-id>` is the registry ID (`codex`, `codebuddy-cn`, `kiro`, `zai`, …).
- `<model-id>` is the upstream model identifier, kept verbatim from the
  upstream API. Do not normalize case, spacing, or punctuation.

Examples:

| Full ID | Provider | Upstream model |
|---|---|---|
| `codex/gpt-6.1-terra` | `codex` | `gpt-6.1-terra` |
| `codebuddy-cn/glm-5.3` | `codebuddy-cn` | `glm-5.3` |
| `kiro/claude-sonnet-4-5` | `kiro` | `claude-sonnet-4-5` |

## 2. Display name

The display name (`name` field in registry entries and catalog responses) is
human-readable and separate from the ID. It may contain spaces and capital
letters. Never use the display name for routing — only the canonical ID.

| ID | Display name |
|---|---|
| `codex/gpt-6.1-terra` | `GPT-6.1 Terra` |
| `codex/gpt-5.6-terra` | `GPT-5.6 Terra` |
| `codebuddy-cn/deepseek-v4.1-flash` | `DeepSeek-V4.1-Flash` |

## 3. Effort variants (Codex)

Codex supports reasoning-effort suffixes on the base model ID:

- Format: `<base-model>-<effort>` (e.g. `gpt-6.1-terra-high`, `gpt-6.1-terra-max`).
- Supported efforts: `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.
- Not every base model supports every effort. `max` and `ultra` are
  restricted to specific models; see `open-sse/executors/codex/reasoningSuffix.ts`.

**Key rule:** effort suffixes are routing aliases, not separate upstream
models. A per-account catalog stores only the base model. Before the
**account-inventory check** (whether an account supports the model), the router
strips the effort suffix to match against the base model. Dispatch-time effort
resolution (`resolveSyncedModelIdAndEffort`) is a separate code path that
happens after account selection.

Example: `codex/gpt-6.1-terra-high` → base `gpt-6.1-terra` + effort `high`.

## 4. Catalog discovery vs. live dispatch

Two distinct verification levels exist. Never conflate them.

| Level | What it means | How to check |
|---|---|---|
| **Catalog 200** | The model is listed in `/v1/models`. This only proves registration. | `GET /v1/models` |
| **Live dispatch 200** | A completion request successfully routes upstream and returns tokens. | `POST /v1/chat/completions` |

A model can appear in the catalog and still fail at dispatch. Before shipping
a new model, always verify live dispatch returns HTTP 200 with actual output
tokens — not just `response.created`.

## 5. Per-account catalog synchronization (Codex)

Codex OAuth accounts can have different model entitlements even under the same
provider. Each account has its own model catalog fetched from the upstream
Codex API (`/backend-api/codex/models`).

**Behavior:**

- Sync is triggered via `POST /api/providers/:id/sync-models` (authenticated).
  The internal scheduler's startup revalidation path appends `?quiet=1` to its
  self-fetch URLs; the parameter is currently informational only and has no
  server-side effect.
- The periodic scheduler syncs only connections with `autoSync: true` in their
  `providerSpecificData`. It never touches accounts that did not opt in.
- A successful sync replaces the stored catalog for that account. A failed,
  empty, or malformed sync response **preserves the last-good catalog**.
- Missing or empty catalogs **fail open** — routing does not reject a model
  solely because no catalog is known for an account.
- Stale non-empty catalogs **remain restrictive** until refreshed. If an
  account's catalog lists only `gpt-5.6-terra`, a request for `gpt-6.1-terra`
  will skip that account.

**Account selection:** when routing a model to Codex, accounts whose catalog
explicitly excludes the requested base model are skipped. Effort suffixes are
stripped before the **advertised-inventory check** (`isModelAdvertisedByConnection`);
the denylist check (`isModelExcludedByConnection`) does not use the same suffix
stripping and instead matches against `getModelMatchCandidates` (provider-prefix
and `[1m]` candidates).

## 6. Provider-specific catalog shapes

| Provider | Catalog source | Model ID field |
|---|---|---|
| Codex | `/backend-api/codex/models` | `models[].slug` |
| CodeBuddy CN | Static registry (no upstream catalog endpoint) | `id` in registry entry |
| Kiro | AWS Bedrock model list | `modelId` |
| Z.ai / GLM | Plan-family discovery | `model` |

Always use the provider's own catalog format. Codex uses `slug`, not OpenAI's
`data[].id`.

## 7. Capabilities and context

Model capabilities (reasoning, vision, tools) and context window are declared
in the provider registry entry. They must reflect the upstream model's
documented behavior — never copy capabilities across providers or models.

- `supportsReasoning` — whether the model produces reasoning/thinking output.
- `supportsVision` — whether the model accepts image input.
- `supportsTools` — whether the model supports function/tool calling.
- `contextLength` / `maxOutputTokens` — declared from upstream documentation
  or measured live. Do not guess.

## 8. Adding a new model checklist

1. Add the model to the provider's registry entry
   (`apps/server/open-sse/config/providers/registry/<provider>/index.ts`).
2. Set accurate capabilities and context limits from upstream documentation.
3. If the model is Codex and supports effort suffixes, update the effort
   alias sets in `open-sse/executors/codex/reasoningSuffix.ts`.
4. Sync the per-account catalog (or trigger `POST /api/providers/:id/sync-models`).
5. Verify **live dispatch** returns HTTP 200 with output tokens.
6. Verify the model appears in `/v1/models` with the correct display name.
7. Update the provider's model list documentation if applicable.

Do not commit a model that has not been verified with live dispatch.
