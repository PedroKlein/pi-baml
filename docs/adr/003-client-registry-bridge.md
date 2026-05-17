# ADR-003: ClientRegistry as the Provider Bridge

## Status
Accepted

## Context

BAML's standard syntax (`client "anthropic/claude-4.5-haiku"`) assumes direct access to the provider's public API endpoint. Pi routes through proxies with different base URLs and credential resolution. We need to override both the API key and base URL at runtime.

BAML offers several mechanisms:
- Environment variables (`ANTHROPIC_API_KEY`) — handles keys but not base URL
- Static client definitions in .baml files — requires knowing credentials at write time
- `ClientRegistry` API — runtime override of client configuration including all options

## Decision

Use BAML's `ClientRegistry` API to inject Pi's resolved credentials and proxy base_url at runtime. The ClientRegistry is passed to every `callFunction` invocation.

```typescript
const cr = new ClientRegistry();
cr.addLlmClient("anthropic/claude-4.5-haiku", "anthropic", {
  model: "claude-4.5-haiku",
  api_key: await modelRegistry.getApiKeyForProvider("hai-proxy"),
  base_url: "http://localhost:6655/anthropic",
});
// Pass to callFunction as the `cb` parameter
```

For dynamic code using `client PiClient`, the same approach creates a "PiClient" entry.

## Alternatives Considered

1. **Env vars only** — pass `ANTHROPIC_API_KEY` via the `envVars` param on `BamlRuntime.fromFiles()` or `callFunction()`. Handles credentials but BAML's shorthand still uses the default public URL. No way to override base_url through env vars.

2. **Inject synthetic .baml client definitions** — add a `__pi_clients.baml` file to the compilation unit that defines clients with hardcoded base_url. Problem: client names must exactly match what functions reference, creating brittle coupling.

3. **Use BAML's Modular API (buildRequest + manual HTTP)** — take full control of HTTP. Problem: reimplements BAML's retry logic, streaming, and SAP parsing. Defeats the purpose of using BAML.

## Consequences

- Clean separation: .baml files are portable (standard syntax), runtime injects Pi-specific config
- `ClientRegistry` is part of BAML's public API (stable)
- The bridge must parse client references from .baml files to know which entries to create in the registry (or use `setPrimary` for simple override cases)
- Works for all BAML provider types (anthropic, openai, google-ai, etc.) since ClientRegistry accepts any provider
