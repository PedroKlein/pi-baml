# ADR-013: GitHub Copilot Provider Auth Workaround

## Status
Accepted

## Context

BAML 0.85.0's `anthropic` provider sends authentication via `x-api-key` header. GitHub Copilot's proxy (`api.individual.githubcopilot.com`) requires `Authorization: Bearer <token>` instead, plus several mandatory dynamic headers (`X-Initiator`, `Openai-Intent`, etc.) that Pi normally injects per-request.

Additionally, BAML lowercases all header names when building the HTTP request.

## Decision

In `bridge.ts`, when the Pi provider is `github-copilot`, we apply provider-specific adjustments:

1. **For `anthropic` BAML provider** (Claude models): Inject `Authorization: Bearer <token>` into the headers map and set `api_key` to `"not-used"`. BAML will send both `x-api-key: not-used` and `authorization: Bearer <real-token>` — the proxy uses the Bearer header and ignores `x-api-key`.

2. **For `openai-generic` BAML provider** (GPT/other models): Keep the real token in `api_key` since `openai-generic` natively sends `Authorization: Bearer <api_key>`. Custom Authorization headers are overwritten by BAML's built-in auth, so we must use `api_key`.

3. **Always inject Copilot-required headers**: `X-Initiator`, `Openai-Intent`, `anthropic-dangerous-direct-browser-access`, `accept`.

## Consequences

- GitHub Copilot models work through BAML without a local proxy
- The `x-api-key: not-used` header is harmless but present in anthropic requests
- BAML's `baml-original-url` header is also injected but harmless
- Header casing is lowercased by BAML (Copilot proxy is case-insensitive)
- If BAML's anthropic provider switches to Bearer auth in a future version, the explicit header becomes redundant (still works)

## API Limitations (BAML 0.85.0)

- `openai-responses` provider does not exist — models using Pi's `openai-responses` API type (e.g., `gpt-5.4-mini`) cannot be used. An explicit error is thrown.
- Headers passed to `addLlmClient` must be objects, not JSON strings.
