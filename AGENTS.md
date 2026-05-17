# AGENTS.md — pi-baml Project Guide

## Overview

Pi extension that bridges [BAML](https://github.com/BoundaryML/baml) (a structured output DSL for LLMs) with Pi's provider system. Enables typed LLM function calls via 3 model tiers (light/standard/heavy).

## Quick Context

- **What:** npm package (`pi-baml`) installable via Pi's package system
- **Why:** Typed, reliable structured output from LLMs without manual JSON parsing
- **How:** 3 model tiers configured in settings.json, resolved via Pi's ModelRegistry at call time

## Configuration

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

## Repo Structure

```
pi-baml/
├── src/
│   ├── index.ts              ← Extension factory (entry point)
│   ├── eventbus.ts           ← createPiBamlLibrary (stateless, no session_start)
│   ├── lib/
│   │   ├── types.ts          ← All shared types (zero logic)
│   │   ├── config.ts         ← parseBamlSettings()
│   │   ├── bridge.ts         ← resolveModelTier() — single resolution function
│   │   ├── executor.ts       ← createBamlExecutor() → BamlExecutor
│   │   ├── registry.ts       ← FunctionsRegistry, parseFunctionDeclarations
│   │   └── cache.ts          ← RuntimeCache<T> (SHA-256 content hash)
│   └── tools/
│       ├── baml-list.ts      ← createBamlListTool(registry)
│       ├── baml-run.ts       ← createBamlRunTool(registry, factory, settings)
│       └── baml-exec.ts      ← createBamlExecTool(settings, factory)
├── skills/
│   └── baml/
│       └── SKILL.md          ← BAML authoring skill for the agent
├── examples/                 ← Teaching examples (.baml files)
├── tests/
│   ├── unit/                 ← Unit tests (no network)
│   └── integration/          ← Real BAML runtime tests
├── docs/
│   ├── configuration.md      ← Settings.json reference
│   └── adr/                  ← Architecture Decision Records
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```

## Key Technical Details

### Model Tiers

The entire model resolution is one function:

```typescript
resolveModelTier(settings, modelRegistry, tier = "standard") → { clientRegistry, bamlProvider }
```

1. Read `settings.models[tier]` → `"github-copilot/claude-haiku-4.5"`
2. `modelRegistry.find("github-copilot", "claude-haiku-4.5")` → Model object
3. `modelRegistry.getApiKeyAndHeaders(model)` → auth
4. Build `ClientRegistry` with "PiClient" as primary

### GitHub Copilot Auth (ADR-013)

BAML 0.85.0's `anthropic` provider sends auth via `x-api-key`, but GitHub Copilot requires `Authorization: Bearer`. The bridge handles this:

- **Anthropic models**: Injects `Authorization: Bearer <token>` in headers, sets `api_key` to `"not-used"`
- **OpenAI models**: Passes real token as `api_key` (BAML's `openai-generic` natively uses Bearer)
- **Always injects**: `X-Initiator`, `Openai-Intent`, `anthropic-dangerous-direct-browser-access`, `accept`

### BAML Runtime API

```typescript
import { BamlRuntime, ClientRegistry, Collector } from "@boundaryml/baml";

const runtime = BamlRuntime.fromFiles("/", { "main.baml": source }, {});
const ctx = runtime.createContextManager();

const cr = new ClientRegistry();
cr.addLlmClient("PiClient", "anthropic", {
  model: "claude-haiku-4.5",
  api_key: "not-used",  // Copilot ignores x-api-key when Authorization is present
  base_url: "https://api.individual.githubcopilot.com",
  headers: {  // Must be object, NOT JSON.stringify()
    "Authorization": "Bearer <oauth-token>",
    "User-Agent": "GitHubCopilotChat/0.35.0",
    "X-Initiator": "user",
    "Openai-Intent": "conversation-edits",
    ...
  },
});
cr.setPrimary("PiClient");

const result = await runtime.callFunction("MyFunc", args, ctx, null, cr, [collector]);
const parsed = result.parsed(false);
```

### Pi Extension API (relevant subset)

```typescript
export default function(pi: ExtensionAPI) {
  pi.registerTool({ name, description, parameters, execute });
  pi.events.emit("pi-baml:ready", libraryObject);
  // No session_start handler needed — library is stateless.
  // Consumers pass ctx.modelRegistry on each library method call.
}
```

### Pi API type → BAML provider mapping

| Pi `model.api` | BAML `provider` | Status |
|----------------|-----------------|--------|
| `anthropic-messages` | `anthropic` | ✅ Supported |
| `openai-completions` | `openai-generic` | ✅ Supported |
| `google-generative-ai` | `google-ai` | ✅ Supported |
| `google-vertex` | `vertex-ai` | ✅ Supported |
| `bedrock-converse-stream` | `aws-bedrock` | ✅ Supported |
| `openai-responses` | — | ❌ Unsupported (BAML 0.85.0) |

## Conventions

- **ESM only** — no CommonJS
- **.baml files always use `client PiClient`** — model selection at call time
- **No `any`** in public API
- **Error handling:** explicit, wrap with context, never swallow
- **Testing:** table-driven, behavior-focused, mock at system boundaries
- **Naming:** camelCase functions, PascalCase types, kebab-case files

## Build & Test

```bash
npm install
npm run build          # tsup → dist/
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/ tests/
npm test               # vitest (unit tests)
npm run test:integration  # real BAML compilation
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@boundaryml/baml` | BAML runtime (native NAPI binary) |
| `@earendil-works/pi-coding-agent` | Pi types (dev only) |
| `typescript` | Build |
| `tsup` | Bundler |
| `vitest` | Test runner |
| `eslint` + `@typescript-eslint/*` | Linting |

## Important Constraints

1. **No network in factory** — all LLM calls happen at tool-invocation time
2. **Emit from factory** — `pi-baml:ready` MUST fire during factory, not session_start
3. **Soft-fail** — if settings are invalid or BAML can't load, emit `{ available: false }`
4. **Always setPrimary** — file-declared clients are ignored, tier model is always used
5. **Three tiers only** — light, standard, heavy. No arbitrary model strings.
6. **Headers must be objects** — BAML's `addLlmClient` options accept `{ [key: string]: any }`. Headers must be passed as a JS object, never `JSON.stringify()`.
7. **No `openai-responses` models** — BAML 0.85.0 lacks this provider. Throws explicit error.
8. **Copilot auth is provider-aware** — `anthropic` needs Bearer in headers; `openai-generic` uses `api_key` natively (see ADR-013).
9. **Enriched tool output** — `baml_run`/`baml_exec` return `{ result, model, tier }` envelope. The render layer unwraps this for display and shows model/tier in the footer.
10. **Discovery runs at factory time** — `discoverBamlGroups(cwd, functionsDirs)` scans all discovery paths and populates the registry immediately.
11. **ModelRegistry is explicit** — library methods require `modelRegistry` as a parameter. No internal state, no session_start handler, no lifecycle coupling (see ADR-007).
