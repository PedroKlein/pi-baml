# pi-baml

BAML integration for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). Bridges BAML's structured output runtime with Pi's provider system for typed LLM function calls.

## What is this?

[BAML](https://github.com/BoundaryML/baml) is a DSL for defining typed LLM functions with schema-aligned parsing. pi-baml connects it to Pi so that:

- **Extensions** can define `.baml` files and execute them using Pi's configured model providers
- **The agent** can invoke pre-defined BAML functions or dynamically author new ones
- **Credentials** are resolved from Pi's provider system — no separate API key management

## Installation

Add to your Pi `settings.json`:

```json
{
  "packages": [
    "npm:pi-baml"
  ]
}
```

## Configuration

Add a `baml` section to your `~/.pi/agent/settings.json`:

```json
{
  "baml": {
    "proxy": {
      "anthropic": { "provider": "hai-proxy", "base_url": "http://localhost:6655/anthropic" },
      "openai": { "provider": "github-copilot" }
    },
    "defaultModel": "anthropic/claude-4.5-haiku"
  }
}
```

The `proxy` map routes BAML provider calls through your Pi providers. The `defaultModel` is used for dynamically-authored BAML code.

## Usage

### Agent Tools

| Tool | Purpose |
|------|---------|
| `baml_list` | Discover available BAML functions in the registry |
| `baml_run` | Execute a pre-defined function by name |
| `baml_exec` | Compile + execute dynamic BAML code inline |

### Writing .baml files

Place `.baml` files in any of these directories (by priority):

1. `<project>/.pi/baml/<group>/` — project-specific
2. `~/.pi/baml/<group>/` — Pi-local
3. `~/.agents/baml/<group>/` — shared across agents

Each subdirectory is a compilation unit. Example:

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
  client "anthropic/claude-4.5-haiku"
  prompt #"
    Extract action items from these meeting notes.

    {{ ctx.output_format }}

    ---
    {{ meeting_notes }}
  "#
}
```

### For Extension Authors

Other Pi extensions can use pi-baml via the EventBus:

```typescript
let baml: PiBamlLibrary | null = null;

// Grab the library reference (fires during factory phase)
pi.events.on("pi-baml:ready", (lib) => {
  baml = lib as PiBamlLibrary;
});

// Use it after session_start
pi.on("session_start", async (event, ctx) => {
  if (!baml?.available) return;
  
  const executor = await baml.createExecutorFromDir(
    join(__dirname, "baml"),  // your extension's .baml files
    { provider: "anthropic", model: "claude-4.5-haiku" }
  );
  
  const result = await executor.call("ClassifySkill", {
    prompt: userMessage,
    skills: skillList,
  });
});
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
