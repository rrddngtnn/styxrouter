# Model naming and routing semantics

[Documentation](README.md) · [Client connections](harness-connections.md)

Use exact IDs from the configured catalog for requests. Display names are not
routing IDs, and a listed model is not proof of live availability. This reference
covers naming, account catalogs, effort variants, and context metadata.

## Provider-scoped inventory (partial)

The Models page offers an opt-in partial provider inventory from the session-authenticated
`GET /api/admin/provider-catalog`. Each row carries `providerId`, nullable `nodeId`,
and the exact `localId`; its displayed `id` combines the registry ID or node prefix
with that local ID, and is not proof that a route is available or unambiguous. The
endpoint reads registry, stored connection-sync and custom inventories before the
public catalog's global-ID merges. It includes embedding, image, rerank, audio,
moderation, video and music registry entries for known registry providers when a
provider-local ID is explicit. Bare specialty aliases are omitted. It also includes
targets of stored model aliases
when their provider prefix resolves uniquely, and Claude and declared synced effort
variants where the generator applies. Rows identify these as `alias-backed` or
`generated-effort`; generated rows include `baseLocalId`. Existing inventory IDs
win collisions. Ambiguous alias prefixes are excluded. It includes inactive and
historical inventories; it does not apply `/v1/models` eligibility, visibility, or
metadata enrichment. Other specialized sources, alias names, no-thinking variants,
mirrors, combos, managed fallback and external catalogs remain omitted.
`coverage.complete` is false. Provider-local model lists include those same explicitly
owned specialty entries. New manual IDs cannot shadow them; pre-existing manual
collisions remain editable and removable, revealing the registry row on deletion.
Compatible nodes do not inherit their prefix's specialty registry. The default Models page and `/v1/models` remain the
served catalog; listing does not verify live dispatch.

## 1. Canonical model ID: `provider/model-id`

The usual explicit provider route has a slash-delimited ID; unprefixed model
requests, provider aliases and virtual combo IDs are also supported:

```
<provider-id>/<model-id>
```

- `<provider-id>` is the registry ID (`codex`, `codebuddy-cn`, `kiro`, `glm`, …).
- `<model-id>` is the upstream model identifier, kept verbatim from the
  upstream API. Do not normalize case, spacing, or punctuation.

Examples:

| Full ID | Provider | Upstream model |
|---|---|---|
| `codex/gpt-6.1-terra` | `codex` | `gpt-6.1-terra` |
| `codebuddy-cn/glm-5.3` | `codebuddy-cn` | `glm-5.3` |
| `kiro/claude-sonnet-4.5` | `kiro` | `claude-sonnet-4.5` |

## 2. Display name

The display name (`name` field in registry entries and catalog responses) is
human-readable and separate from the ID. It may contain spaces and capital
letters. Never use the display name for routing — only the canonical ID.

| ID | Display name |
|---|---|
| `codex/gpt-6.1-terra` | `GPT-6.1 Terra` |
| `codex/gpt-5.6-terra` | `GPT 5.6 Terra` |
| `codebuddy-cn/deepseek-v4.1-flash` | `DeepSeek-V4.1-Flash` |

## 3. Effort variants (Codex)

Codex supports reasoning-effort suffixes on the base model ID:

- Format: `<base-model>-<effort>` (e.g. `gpt-6.1-terra-high`, `gpt-6.1-terra-max`).
- Supported efforts: `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.
- Not every base model supports every effort. `max` and `ultra` are
  restricted to specific models; see `open-sse/executors/codex/reasoningSuffix.ts`.
- For `gpt-6.1-terra`, `max` is sent upstream as `max`, while the router's
  `ultra` alias also sends `max`. Account catalogs must advertise the base model;
  the aliases do not establish upstream availability or entitlement.

**Key rule:** an exact ID in any active Codex account catalog takes precedence
over interpreting that same spelling as an effort alias. Only accounts with that
exact ID (or unknown catalogs, which still fail open) are eligible; an account
advertising only the parsed base is not. The exact ID reaches the executor
unchanged and the suffix does not override an explicit reasoning effort. When no
active catalog advertises the exact spelling, existing suffix parsing treats it as
a router alias and eligible accounts may advertise its base. If discovery is
missing, empty, malformed, or unavailable, the router cannot disambiguate the
spelling and retains legacy alias parsing; refresh the catalogs to resolve it.
A base-only account therefore cannot use a colliding alias while an active catalog
advertises the same spelling as a literal model.

Example: `codex/gpt-6.1-terra-high` → base `gpt-6.1-terra` + effort `high`.

## Dashboard model test

The provider workspace's **Test model** action uses the signed-in dashboard
session, not an API key. It sends a fixed short prompt through the dedicated
management probe and returns only success or failure; upstream output and errors
are not exposed or persisted in request logs. Real usage charges may apply.
The public `/v1` inference routes still require their normal API-key authorization.

The probe requires a configured inventory target and an exact same-origin request.
TLS-terminating reverse proxies must configure `STYX_TRUSTED_PUBLIC_ORIGIN` to the
canonical public HTTPS origin; forwarded headers do not establish trust. Limits
are process-local: one active probe, a five-second interval and a ten-second
execution deadline. Multiple workers do not share that budget. General routing
aliases, combos and cross-model emergency fallbacks cannot replace the probe target.

For Antigravity/AGY, exact active catalog IDs take priority over static or dynamic
aliases. Otherwise selection and dispatch share one resolved wire ID, frozen
across account retries. API-key policies apply to both the requested ID and wire
ID; internal retries recheck the key and allowed account immediately before send.
A concurrent revocation after that read cannot be prevented atomically. Existing
provider fallback chains remain subject to model ACLs and account catalogs.

## 4. Catalog discovery vs. live dispatch

A catalog response and a successful inference request establish different facts.

| Level | What it means | How to check |
|---|---|---|
| **Catalog 200** | `/v1/models` succeeded; inspect its response to see whether the model is listed. Listing does not prove live dispatch. | `GET /v1/models` |
| **Live dispatch 200** | A completion request successfully routes upstream and returns tokens. | `POST /v1/chat/completions` |

- For providers with account-scoped synchronized model catalogs (including Codex and
  Antigravity/AGY), a nonempty last-good catalog excludes that account when it
  lacks the exact requested canonical model ID. This is account selection, not a
  model downgrade: an unavailable `claude-opus-5-5-medium`,
  `claude-sonnet-5-5-medium`, or `gemini-4-argon-medium` is retried only on a
  different eligible account that advertises that same ID. `claude-opus-4-6-thinking`
  and `claude-sonnet-4-6` remain separate IDs and are never automatic fallback
  targets. Missing, empty, or malformed inventories remain unknown and fail open;
  a stale nonempty last-good inventory stays restrictive until a successful refresh.

For `codex/gpt-6.1-terra` and its effort aliases, internal context budgeting
uses the Codex catalog's 500,000-token default client context when no discovery
or manual override is available; account discovery takes precedence when present. Alias-specific manual context
settings take precedence over base manual settings and discovery. Sync stores
`context_window` per account and reconciles the provider-wide value from the
smallest known value among active accounts that advertise the model. Unknown
account windows are not evidence of capacity; if no valid value is known, the
last override is retained unless known catalogs establish that the model was
removed. Refresh each stale account, since another active
account's older last-good window can still hold the aggregate down. Malformed
or missing window fields retain that account's last-good value, while failed,
empty or malformed catalogs retain the full last-good catalog. These values
are router metadata, not a test of requests at the limit. The discovered client
context is not a proven `max_input_tokens` inference limit. An explicit, model-specific
`max_input_tokens` capability override is independent and remains enforced; it
is an operator setting, not proof of upstream capacity. Other router checks may
still apply the configured context value when budgeting requests.

Do not substitute OpenAI API context limits for the Codex OAuth client window.
Discovery metadata and advertised router defaults are not proof that a
large-prompt inference request will be accepted.

## 5. Per-account catalog synchronization (Codex)

Codex OAuth accounts can have different model entitlements even under the same
provider. Each account has its own model catalog fetched from the upstream
Codex API (`/backend-api/codex/models`).

**Behavior:**

- Sync is triggered via `POST /api/providers/:id/sync-models` (authenticated).
  The Hono host disables the separate legacy startup-revalidation path; its
  normal startup and periodic cycles select opted-in accounts. The legacy
  revalidation path uses `?quiet=1`, which currently has no server-side effect.
- The periodic scheduler syncs only connections with `autoSync: true` in their
  `providerSpecificData`. It never touches accounts that did not opt in.
- A successful sync replaces the stored catalog for that account. A failed,
  empty, or malformed sync response **preserves the last-good catalog**.
- Context reconciliation runs atomically with a successful catalog replacement or
  account activation change. Only model IDs actually removed by a successful
  replacement are eligible for auto-override deletion; pending removals wait
  until every active account has a known catalog and no active catalog advertises
  that ID. Unknown windows, no active accounts, and manual overrides are retained.
- Same-process overlapping syncs for an account return 409. Across processes,
  SQLite-backed fencing allows overlap but rejects an older publication after a
  newer sync starts, even when that newer sync fails. Activation changes also
  invalidate in-flight publications. This fences catalog/context writes, not
  the upstream fetch or credential refresh; separate processes can still do
  those concurrently. Cross-process fencing requires a shared transactional
  SQLite backend, not independent sql.js in-memory databases.
- Missing or empty catalogs **fail open** — routing does not reject a model
  solely because no catalog is known for an account.
- Stale non-empty catalogs **remain restrictive** until refreshed. If an
  account's catalog lists only `gpt-5.6-terra`, a request for `gpt-6.1-terra`
  will skip that account.

**Account selection:** when an exact Codex ID is present in the active union,
known inventories must contain that exact ID. Otherwise the advertised-inventory
check (`isModelAdvertisedByConnection`) accepts the requested ID or a parsed base;
the denylist check (`isModelExcludedByConnection`) does not use the same suffix
stripping and instead matches against `getModelMatchCandidates` (provider-prefix
and `[1m]` candidates).

## 6. Provider-specific catalog shapes

| Provider | Catalog source | Model ID field |
|---|---|---|
| Codex | `/backend-api/codex/models` | `models[].slug` |
| CodeBuddy CN | Static registry | `id` in registry entry |
| Kiro | Static registry | `id` in registry entry |
| Z.ai / GLM | Static registry; plan-family discovery informs transport | `id` in registry entry |

Always use the provider's own catalog format. Codex uses `slug`, not OpenAI's
`data[].id`.

## 7. Capabilities and context

The `/v1/models` catalog advertises `context_length: 1000000` for provider
models by default, including dynamically discovered and non-chat models. This is
an operator-chosen router presentation default, **not** an upstream capability,
input maximum, or promise that a request of that size will succeed. A manual
model-context override or manually entered custom-model input limit replaces the
default; an explicit model-context override takes precedence when both are set.
Codex effort aliases and no-thinking aliases can inherit a base override unless
the alias has its own. Provider discovery and static metadata still drive
internal context resolution and request gates as before;
other metadata, including `max_input_tokens` and `max_output_tokens`, remains
independent. Combo entries are virtual and retain their own explicit or derived
context metadata rather than this provider-model default.

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
4. For Codex, sync the per-account catalog (or trigger `POST /api/providers/:id/sync-models`); the Hono sync endpoint rejects other providers.
5. Verify **live dispatch** returns HTTP 200 with output tokens.
6. Verify the model appears in `/v1/models` with the correct display name.
7. Update the provider's model list documentation if applicable.

Verify live dispatch before committing a model addition. Record the model,
account type, and validation performed without exposing tokens or private responses.
