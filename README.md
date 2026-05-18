# pi-baml

BAML integration for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). Bridges BAML's structured output runtime with Pi's provider system for typed LLM function calls.

## What is this?

[BAML](https://github.com/BoundaryML/baml) is a DSL for defining typed LLM functions with schema-aligned parsing. pi-baml connects it to Pi so that:

- **Extensions** can define `.baml` files and execute them using Pi's configured model providers
- **The agent** can invoke pre-defined BAML functions or dynamically author new ones
- **Credentials** are resolved from Pi's provider system — no separate API key management

## Installation

Install via Pi's package manager:

```bash
# Latest (auto-updated with `pi update`)
pi install https://github.com/PedroKlein/pi-baml

# Pinned to a specific release
pi install https://github.com/PedroKlein/pi-baml@v0.1.0
```

Or add directly to your `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "https://github.com/PedroKlein/pi-baml"
  ]
}
```

Pi clones the repo, installs dependencies, and builds automatically.

## Configuration

Add a `baml` section to your `~/.pi/agent/settings.json`:

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

The `models` map defines three tiers used for all BAML calls. The tier is selected at call time based on task complexity:

| Tier | Purpose | Typical Model |
|------|---------|---------------|
| `light` | Fast, cheap: simple classification, formatting | haiku-class |
| `standard` | Most tasks: structured extraction, multi-field output (default) | sonnet-class |
| `heavy` | Complex reasoning, ambiguous inputs, multi-step logic | opus-class |

Each value is `"provider/model-id"` matching Pi's model registry (see `pi --list-models`).

See [docs/configuration.md](docs/configuration.md) for the full reference.

## Usage

### Agent Tools

| Tool | Purpose |
|------|---------|
| `baml_list` | Browse available BAML function groups and get detailed signatures |
| `baml_run` | Execute a pre-defined function by name |
| `baml_exec` | Compile + execute dynamic BAML code inline |

All tools accept an optional `model` parameter to select the tier: `"light"`, `"standard"`, or `"heavy"` (default: `"standard"`).

Tool output includes the resolved model and tier in a structured envelope:

```json
{
  "result": [{"task": "Buy milk", "priority": "low"}],
  "model": "github-copilot/claude-haiku-4.5",
  "tier": "light"
}
```

### Writing .baml files

Place `.baml` files in any of these directories (by priority, highest first):

1. `<project>/.agents/baml/<group>/` — project-specific (highest priority)
2. `<project>/.pi/baml/<group>/` — project Pi-local
3. `~/.pi/baml/<group>/` — user Pi-local
4. `~/.agents/baml/<group>/` — shared across agents
5. `~/.agents/skills/*/baml/` — skill-colocated (`skill:` prefix, lowest priority)

Each subdirectory is a compilation unit (group). Example:

### Adding descriptions

Add a `README.md` to any group directory:

```markdown
---
description: Extract TODO items from freeform text — meeting notes, changelogs, code comments.
---

# Extract TODOs

Additional documentation about the group and its functions.
```

The `description` appears in the system prompt so the agent knows when to use these functions. `README.md` is never compiled — only `.baml` files are passed to the BAML runtime.

Example file layout:

```
~/.agents/baml/
├── extraction/
│   └── main.baml        ← ExtractActionItems function
├── classification/
│   └── main.baml        ← ClassifyIntent function
└── transformation/
    └── main.baml        ← Summarize function
```

### Example .baml file

```baml
class ActionItem {
  description string @description("what needs to be done")
  assignee string? @description("who is responsible, if mentioned")
  due_date string? @description("ISO 8601 date, if mentioned")
  priority "high" | "medium" | "low"
}

function ExtractActionItems(meeting_notes: string) -> ActionItem[] {
  client PiClient
  prompt #"
    Extract action items from these meeting notes.

    {{ ctx.output_format }}

    ---
    {{ meeting_notes }}
  "#
}
```

> **Key convention:** Always use `client PiClient`. The actual model is selected at call time via the tier system.

### For Extension Authors

Other Pi extensions can use pi-baml via the EventBus:

```typescript
let baml: PiBamlLibrary | null = null;

// Grab the library reference (fires during factory phase)
pi.events.on("pi-baml:ready", (lib) => {
  baml = lib as PiBamlLibrary;
});

// Use it in session_start or any event handler — pass ctx.modelRegistry directly
pi.on("session_start", async (event, ctx) => {
  if (!baml?.available) return;

  // Create an executor from in-memory files
  const executor = await baml.createExecutor(
    { "classify.baml": classifyBamlSource },
    ctx.modelRegistry,  // required — no internal state
    "light",            // optional tier override
  );

  const result = await executor.call("ClassifySkill", {
    prompt: userMessage,
    skills: skillList,
  });

  // Or use the one-shot API
  const classified = await baml.execBaml(
    classifyBamlSource,
    "ClassifySkill",
    { prompt: userMessage, skills: skillList },
    ctx.modelRegistry,
    "light",
  );

  // Or call a registered function by name
  const todos = await baml.call("ExtractTodos", { notes: meetingNotes }, ctx.modelRegistry, "heavy");
});
```

## Development

```bash
npm install
npm run build          # tsup → dist/
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/ tests/
npm test               # vitest (113 unit tests)
npm run test:integration  # real BAML compilation (requires @boundaryml/baml)
```

Integration tests with live LLM calls require:
```bash
PI_BAML_TEST_PROXY_URL=http://localhost:6655 npm run test:integration
```

## License

MIT
