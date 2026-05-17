# AGENTS.md — pi-baml Project Guide

## Overview

Pi extension package that bridges [BAML](https://github.com/BoundaryML/baml) (a structured output DSL for LLMs) with Pi's provider system. Enables typed LLM function calls from Pi extensions and dynamic BAML authoring by the agent.

## Quick Context

- **What:** npm package (`pi-baml`) installable via Pi's package system (`"npm:pi-baml"` in settings.json)
- **Why:** Give Pi extensions and the agent typed, reliable structured output from LLMs without manual JSON parsing
- **How:** Bridges BAML's `BamlRuntime` with Pi's `ModelRegistry` via `ClientRegistry` for credential/URL resolution

## Spec

The full REASONS Canvas spec lives at [`spdd/prompt/pi-baml.md`](./spdd/prompt/pi-baml.md). Read it before implementing — it contains all design decisions, architecture, and safeguards.

## Repo Structure

```
pi-baml/
├── src/
│   ├── index.ts              ← Extension factory (entry point)
│   ├── eventbus.ts           ← createPiBamlLibrary + PiBamlLibraryInternal
│   ├── lib/
│   │   ├── types.ts          ← All shared types (zero logic)
│   │   ├── config.ts         ← parseBamlSettings()
│   │   ├── bridge.ts         ← createClientRegistryConfig, mapBamlProviderToPiApi
│   │   ├── executor.ts       ← createBamlExecutor() → BamlExecutor
│   │   ├── registry.ts       ← FunctionsRegistry, parseFunctionDeclarations
│   │   └── cache.ts          ← RuntimeCache<T> (SHA-256 content hash)
│   └── tools/
│       ├── baml-list.ts      ← createBamlListTool(registry)
│       ├── baml-run.ts       ← createBamlRunTool(registry, factory)
│       └── baml-exec.ts      ← createBamlExecTool(settings, factory)
├── skills/
│   └── baml/
│       └── SKILL.md          ← BAML authoring skill for the agent
├── examples/                 ← Teaching examples (.baml files)
├── tests/
│   ├── unit/                 ← 11 files, 72 tests (no network)
│   └── integration/          ← 3 files, 11 tests (real BAML runtime)
├── docs/
│   ├── adr/                  ← 12 Architecture Decision Records
│   ├── architecture.md       ← Detailed technical reference
│   └── configuration.md      ← Settings.json reference
├── spdd/
│   └── prompt/pi-baml.md     ← REASONS Canvas (source of truth)
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

## Key Technical Details

### BAML Runtime API

The core integration uses BAML's low-level TypeScript API (from `@boundaryml/baml`):

```typescript
import { BamlRuntime, ClientRegistry, Collector } from "@boundaryml/baml";

// Compile .baml files in-memory (no disk writes needed)
const runtime = BamlRuntime.fromFiles("/", {
  "main.baml": bamlSourceCode
}, {});  // envVars (empty — credentials injected via ClientRegistry)

// Create execution context
const ctx = runtime.createContextManager();

// Override client at runtime (inject Pi's credentials + proxy URL)
const cr = new ClientRegistry();
cr.addLlmClient("PiClient", "anthropic", {
  model: "claude-4.5-haiku",
  api_key: resolvedFromPi,
  base_url: "http://localhost:6655/anthropic"
});
cr.setPrimary("PiClient");

// Execute function (actual BAML API signature)
const collector = new Collector();
const result = await runtime.callFunction(
  "MyFunction",
  { input: "..." },
  ctx,
  null,           // TypeBuilder (not needed)
  cr,             // ClientRegistry override
  [collector],    // Collectors (for raw output capture)
);

const parsed = result.parsed(false); // false = don't allow partials
// On failure: collector.last?.rawLlmResponse has the raw LLM output
```

### Pi Extension API (relevant subset)

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function(pi: ExtensionAPI) {
  // Register tools
  pi.registerTool({ name, label, description, parameters, execute });
  
  // Cross-extension communication
  pi.events.emit("pi-baml:ready", libraryObject);
  
  // Lifecycle
  pi.on("session_start", async (event, ctx) => {
    // ctx.modelRegistry available here
    const apiKey = await ctx.modelRegistry.getApiKeyForProvider("hai-proxy");
    const model = ctx.modelRegistry.find("hai-proxy", "anthropic--claude-4.5-haiku");
  });
  
  // Shell execution
  pi.exec(command, args, options);
}
```

### Provider Bridge Logic

Pi API type → BAML provider mapping:

| Pi `model.api` | BAML `provider` |
|----------------|-----------------|
| `anthropic-messages` | `anthropic` |
| `openai-completions` | `openai-generic` |
| `openai-responses` | `openai-generic` |
| `google-generative-ai` | `google-ai` |
| `google-vertex` | `vertex-ai` |
| `bedrock-converse-stream` | `aws-bedrock` |

### EventBus Timing

```
FACTORY PHASE (sequential):
1. Local extensions load → register pi.events.on("pi-baml:ready", cb)
2. pi-baml factory runs → emits pi.events.emit("pi-baml:ready", lib)
   → listeners fire synchronously ✓

SESSION_START PHASE (later):
3. pi-baml session_start → captures ctx.modelRegistry
4. Other extensions session_start → can now call lib.createExecutor() ✓
```

## Conventions

- **ESM only** — no CommonJS
- **TypeBox** for tool parameter schemas
- **No `any`** in public API — use generics or `unknown`
- **Error handling:** explicit, wrap with context, never swallow
- **Testing:** table-driven, behavior-focused, mock at system boundaries
- **Naming:** camelCase functions, PascalCase types, kebab-case files

## Build & Test

```bash
npm install
npm run build          # tsup → dist/
npm run typecheck      # tsc --noEmit (strict + exactOptionalPropertyTypes)
npm run lint           # eslint src/ tests/
npm test               # vitest (72 unit tests)
npm run test:integration  # real BAML compilation (11 tests, 1 gated by env var)
PI_BAML_TEST_PROXY_URL=http://localhost:6655 npm run test:integration  # with live LLM
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@boundaryml/baml` | BAML runtime (native NAPI binary) |
| `@sinclair/typebox` | Tool parameter schemas (available, not yet used in V1) |
| `@earendil-works/pi-coding-agent` | Pi types (dev only) |
| `typescript` | Build |
| `tsup` | Bundler |
| `vitest` | Test runner |
| `eslint` + `@typescript-eslint/*` | Linting |

## Important Constraints (from SPDD Safeguards)

1. **No network in factory** — all LLM calls happen at tool-invocation time
2. **Emit from factory** — `pi-baml:ready` MUST fire during factory, not session_start
3. **Soft-fail** — if `@boundaryml/baml` can't load, emit `{ available: false }`
4. **Cache runtimes** — one BamlRuntime per compilation unit per session
5. **No model ID remapping** — .baml authors use IDs their proxy understands
6. **Explicit proxy config** — no auto-detection of providers
