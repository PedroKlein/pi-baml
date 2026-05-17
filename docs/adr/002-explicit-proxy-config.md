# ADR-002: Explicit Proxy Configuration

## Status
Superseded by three-tier model resolution (see `src/lib/bridge.ts`)

The explicit proxy map was replaced by `baml.models` configuration that uses `"provider/model-id"` format. Model resolution now goes through Pi's `ModelRegistry.find()` directly, eliminating the need for a separate proxy mapping layer.

## Context

BAML functions reference providers by name (e.g., `client "anthropic/claude-4.5-haiku"`). Pi has its own provider system with different names and endpoints (e.g., `hai-proxy` at `localhost:6655/anthropic`). We need to route BAML provider calls through Pi's providers.

Two approaches: auto-detect which Pi providers serve which API types, or require explicit configuration.

## Decision

Require explicit proxy mapping in `settings.json`. No auto-detection.

```json
{
  "baml": {
    "proxy": {
      "anthropic": { "provider": "hai-proxy", "base_url": "http://localhost:6655/anthropic" },
      "openai": { "provider": "github-copilot" }
    }
  }
}
```

## Alternatives Considered

1. **Auto-detection** — scan Pi providers, match by `model.api` type (`anthropic-messages` → BAML's `anthropic`). Problem: ambiguous when multiple Pi providers serve the same API type (e.g., both `hai-proxy` and direct `anthropic` key). Which one wins? User intent is unclear.

2. **Environment variables** — set `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` env vars. Problem: only solves credentials, doesn't integrate with Pi's ModelRegistry for key resolution (which may use OAuth, command-based resolution, etc.).

## Consequences

- Users must configure the proxy map once (setup cost)
- Zero ambiguity — each BAML provider maps to exactly one Pi provider
- Easy to debug (config is visible in settings.json)
- Adding a new provider requires a one-line config addition
- If proxy config is missing for a provider, calls fail with a clear error message pointing to the config
