# Configuration Reference

## Settings.json

Add the `baml` key to your Pi `settings.json` (`~/.pi/agent/settings.json`):

```json
{
  "baml": {
    "models": {
      "light": "github-copilot/claude-haiku-4.5",
      "standard": "github-copilot/claude-sonnet-4.6",
      "heavy": "hai-proxy/anthropic--claude-4.6-opus"
    }
  }
}
```

## Fields

### `models` (required)

Maps model tiers to Pi provider/model-id pairs. All three tiers are required.

| Tier | Purpose | Typical Model |
|------|---------|---------------|
| `light` | Fast, cheap tasks: simple extraction, classification | haiku-class |
| `standard` | Most tasks: structured extraction, multi-field output | sonnet-class |
| `heavy` | Complex reasoning, ambiguous inputs, multi-step logic | opus-class |

**Format:** `"provider/model-id"` where:
- `provider` = Pi provider name (from `pi --list-models`, e.g. `github-copilot`, `anthropic`, `hai-proxy`)
- `model-id` = Model ID as shown in Pi's model list

**Examples:**
```json
"models": {
  "light": "github-copilot/claude-haiku-4.5",
  "standard": "github-copilot/claude-sonnet-4.6",
  "heavy": "hai-proxy/anthropic--claude-4.6-opus"
}
```

```json
"models": {
  "light": "anthropic/claude-haiku-4-5",
  "standard": "anthropic/claude-sonnet-4-20250514",
  "heavy": "anthropic/claude-opus-4-20250901"
}
```

### Supported API Types

The model's Pi API type determines which BAML provider is used:

| Pi API Type | BAML Provider | Status |
|-------------|---------------|--------|
| `anthropic-messages` | `anthropic` | ✅ Supported |
| `openai-completions` | `openai-generic` | ✅ Supported |
| `google-generative-ai` | `google-ai` | ✅ Supported |
| `google-vertex` | `vertex-ai` | ✅ Supported |
| `bedrock-converse-stream` | `aws-bedrock` | ✅ Supported |
| `openai-responses` | — | ❌ Not supported (BAML 0.85.0 limitation) |

Models using `openai-responses` (e.g., `github-copilot/gpt-5.4-mini`) will produce a clear error at call time.

### Provider-Specific Notes

#### GitHub Copilot (`github-copilot/*`)

GitHub Copilot models require special auth handling (see [ADR-013](adr/013-github-copilot-auth-workaround.md)):
- Auth: Bearer token injected via headers (BAML's `x-api-key` is overridden)
- Required headers: `X-Initiator`, `Openai-Intent`, `anthropic-dangerous-direct-browser-access`, `accept`
- These are injected automatically by the bridge — no user configuration needed

#### Custom Proxies (e.g., `hai-proxy/*`)

Custom providers defined in `~/.pi/agent/models.json` work natively as long as they use `anthropic-messages` or `openai-completions` API type. The `api_key` and `base_url` are resolved from Pi's ModelRegistry.

### `functionsDirs` (optional)

Additional directories to scan for `.baml` function files. Added to the default discovery paths.

Default discovery (always active, lowest → highest priority):
1. Pi's resolved skill paths — skill-colocated (`skill:` prefix, discovered lazily via `before_agent_start`)
2. `~/.agents/baml/` — shared across agents
3. `~/.pi/baml/` — user Pi-local
4. `[functionsDirs]` — extra dirs from config (this setting)
5. `<cwd>/.pi/baml/` — project Pi-local
6. `<cwd>/.agents/baml/` — project-specific (highest priority)

Skill-colocated BAML supports two layouts: `<skill>/baml/*.baml` (dedicated subdirectory) or `<skill>/*.baml` (flat files alongside SKILL.md). Discovery automatically follows Pi's resolved skill paths, including profile-specific directories and `--skill` flags.

### `systemPrompt` (optional)

Whether to inject available BAML function groups into the system prompt. Default: `true`.

```json
{
  "baml": {
    "systemPrompt": false
  }
}
```

When enabled, an `<available_baml_functions>` block is appended to the system prompt listing all non-skill groups with their descriptions. The agent uses this to decide when to call `baml_list` for details.

`skill:*` groups are always excluded from the system prompt — they are internal to their owning skill.

## Tool Usage

### Model Selection

Both `baml_run` and `baml_exec` accept an optional `model` parameter:

```
model: "light" | "standard" | "heavy"   (default: "standard")
```

The agent picks a tier based on task complexity:
- **light** — trivial extraction, yes/no classification, formatting
- **standard** — most structured output tasks (default)
- **heavy** — complex multi-step reasoning, ambiguous inputs

### baml_exec

```json
{ "code": "...", "function": "MyFunc", "args": {...}, "model": "light" }
```

Always use `client PiClient` in dynamic BAML code.

### baml_run

```json
{ "function": "ExtractTodos", "args": {...}, "model": "heavy" }
```

## .baml File Conventions

All `.baml` files should use `client PiClient`:

```baml
function ExtractTodos(notes: string) -> TodoItem[] {
  client PiClient
  prompt #"..."#
}
```

The model tier is selected at call time, not in the file.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PI_BAML_TEST_PROXY_URL` | Base URL for integration tests |
