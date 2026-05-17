# Configuration Reference

## Settings.json

Add the `baml` key to your Pi `settings.json` (`~/.pi/agent/settings.json`):

```json
{
  "baml": {
    "proxy": {
      "anthropic": {
        "provider": "hai-proxy",
        "base_url": "http://localhost:6655/anthropic"
      },
      "openai": {
        "provider": "github-copilot"
      }
    },
    "defaultModel": "anthropic/claude-4.5-haiku",
    "extensions": {
      "pi-memory": {
        "provider": "anthropic",
        "model": "claude-4.5-haiku"
      }
    },
    "functionsDirs": [
      "~/my-custom-baml-dir"
    ]
  }
}
```

## Fields

### `proxy` (required for function execution)

Maps BAML provider names to Pi provider configurations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Pi provider name (from `models.json`) |
| `base_url` | string | No | Override base URL. If omitted, reads from first model of that Pi provider. |

**Keys** are BAML provider names: `anthropic`, `openai`, `openai-generic`, `google-ai`, `vertex-ai`, `aws-bedrock`.

**Example:** If your Pi has `hai-proxy` configured at `http://localhost:6655/anthropic` with the Anthropic Messages API, set:
```json
"proxy": { "anthropic": { "provider": "hai-proxy", "base_url": "http://localhost:6655/anthropic" } }
```

### `defaultModel` (recommended)

The model used by `baml_exec` when the agent writes dynamic BAML with `client PiClient`.

Format: `"<baml-provider>/<model-id>"` — e.g., `"anthropic/claude-4.5-haiku"`.

If omitted, `baml_exec` requires an explicit `model` parameter on every call.

### `extensions` (optional)

Per-extension configuration for the `forExtension(name)` API.

```json
"extensions": {
  "<extension-name>": {
    "provider": "<baml-provider>",
    "model": "<model-id>"
  }
}
```

Extensions that call `baml.forExtension("pi-memory")` get an executor factory pre-configured with these settings.

### `functionsDirs` (optional)

Additional directories to scan for `.baml` function files. Added to the default discovery paths.

Default discovery (always active):
1. `<cwd>/.pi/baml/` — project-specific (highest priority)
2. `~/.pi/baml/` — Pi-local
3. `~/.agents/baml/` — shared across agents

## Functions Directory Structure

Each subdirectory is a **compilation unit** — all `.baml` files within are compiled together and share types.

```
~/.agents/baml/
├── extraction/              ← group name: "extraction"
│   ├── main.baml           ← defines ExtractActionItems, ExtractEntities
│   └── types.baml          ← shared types used by both functions
├── classification/          ← group name: "classification"
│   └── main.baml           ← defines ClassifyIntent, ClassifySentiment
└── transformation/          ← group name: "transformation"
    └── main.baml           ← defines Summarize
```

Functions are referenced by:
- **Short name:** `"ExtractActionItems"` (if unambiguous across all groups)
- **Qualified name:** `"extraction/ExtractActionItems"` (always works)

## .baml File Conventions

### For registry functions (files on disk)

Declare your client using standard BAML syntax. pi-baml's proxy config routes it:

```baml
function MyFunction(input: string) -> MyOutput {
  client "anthropic/claude-4.5-haiku"
  prompt #"..."#
}
```

The `"anthropic/..."` tells pi-baml to look up the `anthropic` proxy entry and route through that Pi provider.

### For dynamic code (baml_exec)

Always use `client PiClient`:

```baml
function MyDynamicFunction(input: string) -> MyOutput {
  client PiClient
  prompt #"..."#
}
```

`PiClient` is resolved from `baml.defaultModel` in settings or the `model` tool parameter.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PI_BAML_TEST_PROXY_URL` | Base URL for integration tests (e.g., `http://localhost:6655`) |
| `PI_BAML_LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error` (default: `warn`) |
