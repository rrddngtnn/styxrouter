# OpenCode Console upstream

StyxRouter reuses its existing `opencode`, `opencode-zen`, `opencode-go` registry and executor. `oc` remains a legacy public alias. No OpenCode CLI installation is required.

## Configuration and billing boundary

Use the existing Zen or Go API-key card with your own Console key. Third-party free-tier chat access is restricted by OpenCode; a key does not bypass workspace, privacy, region or plan permissions. The router identifies itself as `StyxRouter/1.0`, not as OpenCode. `OPENCODE_USER_AGENT` can explicitly identify your own deployment.

| Provider | Default base | Catalog |
| --- | --- | --- |
| opencode / opencode-zen | `https://opencode.ai/inference` | authenticated GET `/inference/v1/models`, OpenAI `data[].id` shape |
| opencode-go | `https://opencode.ai/inference/go` | no plan-specific documented catalog; static/manual inventory retained |

Protocols append `/openai/v1/chat/completions`, `/openai/v1/responses`, `/anthropic/v1/messages` or `/google/v1beta/models/<exact-id>:generateContent`. Gemini streaming uses `streamGenerateContent?alt=sse`. All authenticate with Bearer. Existing explicit model `targetFormat` metadata controls native translation; unknown passthrough text models use documented Chat translation, not family-name guessing.

Per-connection `providerSpecificData.baseUrl` overrides retain their host and path ownership. Custom gateways use `/chat/completions`, `/responses`, `/messages` or `/models/<encoded-exact-id>:<operation>`; an already complete matching endpoint is not duplicated. Protocol suffixes compose on the parsed pathname (trailing slashes removed), existing query parameters are preserved, and Gemini streaming sets `alt=sse` without dropping other parameters. Model IDs are encoded as one path segment, including embedded slashes. Bases must be absolute HTTP(S) URLs without fragments, including an empty `#`; invalid configurations fail before transport with a generic error that does not echo query secrets. Existing outbound URL guards still apply. `opencodeApiLayout: "legacy"` preserves historical official `/zen[/go]/v1` routing for compatibility testing; current upstream acceptance of that layout is unknown. There is no automatic Go-to-PAYG billing fallback.

## Model identity and discovery

Use `provider/<exact-upstream-id>`; case and spelling are preserved in upstream `model`. Display names are presentation only. Existing documented effort aliases resolve to their base ID and effort parameter, never an unrelated model.

The session-authenticated existing POST `/api/providers/<connection-id>/sync-models` now accepts opencode and opencode-zen. It writes per-connection catalogs, fences concurrent publications, invalidates catalog/connection caches, and preserves last-good catalogs on failed, empty or malformed responses. No automatic sync opt-in is added. A custom base requires an explicit `modelsUrl` to avoid sending a custom gateway key to the official service. Go synchronization remains explicitly unsupported rather than treating PAYG's catalog as Go entitlement. Unknown inventory is not entitlement; existing account eligibility policy remains unchanged.

Catalog HTTP 200 proves discovery only, not model-request permission or completed inference. Live inference was not performed for this patch.

## Sessions, usage and limits

Explicit conversation headers are HMAC-scoped to the trusted internal caller-key ID and provider, using the existing required `API_KEY_SECRET` with a versioned domain separator. The same configured secret produces stable identities across workers/restarts; rotating that secret intentionally rotates all session pseudonyms. No new secret is generated or persisted and a missing secret fails closed. Direct executor consumers lacking an internal principal use caller authentication only as private HMAC input. No credential is emitted as session metadata. Without a conversation header, the first user content in Chat, Responses or Gemini history is a best-effort seed; independent conversations with identical first content cannot be distinguished. Supply a stable conversation header for reliable auxiliary/tool turns.

No supported public remaining-quota endpoint is established. `STYX_OPENCODE_QUOTA_URL` is an explicit operator opt-in; unset means no speculative request and unknown quota. Configured dashboard snapshots remain supported. Missing windows are not displayed as full or invented fixed-dollar allowances. Token usage and narrowly sanitized observed Console billing metadata are retained through Chat and native-to-Chat JSON/SSE translation. `cost`, `list_cost` and `allowance` retain their documented USD/request units; they are not remaining balances. Only known billing sources, finite nonnegative amounts, boolean estimated and documented integer token breakdowns survive. Unknown provider fields are not copied. Explicit caller output budgets are preserved rather than raised by the shared tool-call floor.

## Verification scope

Synthetic contract tests cover factory aliases, four native request translations/URLs, Bearer headers, honest identity, key-scoped session stability, exact model IDs, caller token budgets, 401/403/429 and Retry-After, catalog last-good preservation and unknown quota. A real isolated Hono/Bun server fixture checks authenticated/pinned Chat JSON and SSE/tools/usage plus rejection without cross-plan dispatch. Fixtures block external fetch and use disposable SQLite state. Additional real isolated Hono fixtures exercise native Responses, Messages and Gemini JSON, seven-byte split SSE, terminal events, late errors, cancellation and tool-call → tool-result → completion round trips through Chat, plus public Responses/Messages JSON/SSE entry points. These are not live Console completions, universal modality support, or deployment proof. Gemini is tested as an upstream family behind the existing public API; no new public Gemini endpoint is promised.

Official references: [Harnesses](https://opencode.ai/docs/console/harnesses), [Inference API](https://opencode.ai/docs/console/api/inference), [Go](https://opencode.ai/docs/console/go).
