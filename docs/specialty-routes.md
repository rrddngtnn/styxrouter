# Specialty routes on the lean host

The Hono host mounts existing embedding and search handlers; it does not fabricate
chat transports for image/audio/video declarations.

- `POST /v1/embeddings`: OpenAI-shaped request with exact `provider/model-id`.
  The upstream model spelling and slashes are preserved. Registry aliases are
  resolved explicitly. Cohere's native `/v2/embed` contract is not implemented by
  the existing generic handler and remains rejected. Local dynamic nodes are not
  newly enabled by this change.
- `POST /v1/search`: an explicit existing search provider is required. Its existing
  request aliases and credential-family fallbacks apply. No automatic cross-vendor
  inference fallback is introduced. Client `provider_options.baseUrl` is rejected;
  operator-owned stored connection settings remain separate.

Both routes require a router API key (not a panel cookie), apply existing endpoint,
model, budget and rate policies, and honor connection allowlists and explicit
`x-styx-connection` pins. Embeddings additionally authorize the resolved canonical
model. Request bodies are bounded to 1 MiB / 64 KiB respectively. Neither endpoint
supports streaming; `stream: true` returns 400 before dispatch.

API-key specialty providers with existing handlers are included in the management
provider list and standard account onboarding; chat registration is unchanged.
Static inventory is not account entitlement or upstream acceptance. Existing
per-account catalogs and last-good sync semantics are not changed. Static embedding
models require no invented discovery URL; search providers are tasks, not LLM models.

| Source | Shape | Discovery boundary |
| --- | --- | --- |
| Embedding registry | exact provider + model IDs | static; no new remote sync |
| Search registry | task provider, explicit request aliases | static; no LLM model sync |
| Chat registry | existing chat model entries | unchanged per-provider behavior |

Catalog HTTP 200, offline intercepted dispatch, authenticated live inference and
production activation are separate evidence gates. Offline tests cover the real
OpenAI embedding serializer/response normalization and Serper search builder and
normalizer, plus authentication, policy, wrong-provider pins and error boundaries.
They do not certify every declared upstream format or credential.

Magnific's retained Mystic IDs are generation IDs, not upscaling engine names.
No Magnific route is advertised as implemented by this change. The official current
contract documents asynchronous `POST /v1/ai/image-upscaler` with
`x-magnific-api-key`, base64 image, scale factor and task polling. That needs a full
image/task adapter and ownership-safe polling, not a chat factory registration.
