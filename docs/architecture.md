# Architecture

> Detailed technical reference for pi-baml internals. For the design rationale, see [`../spdd/prompt/pi-baml.md`](../spdd/prompt/pi-baml.md).

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Pi Agent Session                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │  baml_list   │     │  baml_run    │     │  baml_exec   │    │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘    │
│         │                    │                     │             │
│         └────────────────────┼─────────────────────┘             │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │  PiBamlLibrary    │                        │
│                    │  (eventbus.ts)    │                        │
│                    └────┬────┬────┬────┘                        │
│                         │    │    │                              │
│            ┌────────────┘    │    └────────────┐                │
│            │                 │                 │                 │
│  ┌─────────▼────┐  ┌────────▼───────┐  ┌─────▼──────────┐     │
│  │  Registry    │  │    Bridge      │  │   Executor     │     │
│  │(registry.ts) │  │ (bridge.ts)    │  │(executor.ts)   │     │
│  └──────────────┘  └────────┬───────┘  └───────┬────────┘     │
│                              │          ┌───────┴────────┐     │
│                              │          │ RuntimeCache   │     │
│                              │          │  (cache.ts)    │     │
│                              │          └───────┬────────┘     │
│                    ┌─────────▼──────────────────▼──────┐        │
│                    │         @boundaryml/baml           │        │
│                    │  BamlRuntime · ClientRegistry      │        │
│                    │  Collector · FunctionResult        │        │
│                    └─────────────────┬─────────────────┘        │
│                                      │                          │
├──────────────────────────────────────┼──────────────────────────┤
│                    Pi ModelRegistry   │                          │
│                    ┌─────────────────▼─────────────────┐        │
│                    │  getApiKeyForProvider(name)        │        │
│                    └─────────────────┬─────────────────┘        │
│                                      │                          │
└──────────────────────────────────────┼──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │          LLM Provider               │
                    │  (hai-proxy / github-copilot / etc) │
                    └─────────────────────────────────────┘
```

## Module Responsibilities

### `src/lib/types.ts`
All shared TypeScript types. No logic. Exported for consumers who want type safety.

Key types:
- `ProxyEntry` — single proxy mapping (Pi provider name + optional base_url)
- `ProxyConfig` — `Readonly<Record<string, ProxyEntry>>`
- `ExtensionConfig` — per-extension provider + model pair
- `BamlSettings` — full parsed config (proxy, defaultModel?, extensions?, functionsDirs?)
- `PiBamlConfig` — per-call config (provider? + model?)
- `BamlExecutor` — interface: `call<T>(fn, args) → Promise<T>`, `dispose() → void`
- `FunctionEntry` — internal function metadata (name, group, files, inputTypes, outputType)
- `FunctionInfo` — public function info (adds qualifiedName)
- `BamlErrorType` — `"compilation" | "execution" | "configuration" | "unavailable"`
- `BamlError` — structured error (error, type, rawOutput?, diagnostics?)
- `PiBamlLibrary` — full EventBus API shape
- `PiBamlExtensionAPI` — subset for `forExtension()`

### `src/lib/config.ts`
Parses Pi's `settings.json` and extracts the `baml` configuration section.

```typescript
// Pure function — takes parsed settings object, returns validated config
function parseBamlSettings(settings: unknown): BamlSettings;
```

```typescript
interface BamlSettings {
  readonly proxy: ProxyConfig;                              // "anthropic" → { provider: "hai-proxy", base_url?: "..." }
  readonly defaultModel?: string;                           // "anthropic/claude-4.5-haiku"
  readonly extensions?: Record<string, ExtensionConfig>;    // per-extension overrides
  readonly functionsDirs?: string[];                        // additional discovery dirs
}
```

Fallback behavior:
- No `baml` key or null settings → empty proxy, no default model (not an error)
- Missing `proxy` entries → functions using that provider will fail with clear error
- Missing `defaultModel` → `baml_exec` requires explicit model param
- Malformed proxy entry (missing `provider`) → throws with actionable message

### `src/lib/bridge.ts`
The core integration logic. Creates configuration for BAML `ClientRegistry` instances.

Three exported functions:

```typescript
// Static lookup: BAML provider → Pi API type
function mapBamlProviderToPiApi(bamlProvider: string): string;

// Parse "provider/model" format
function parseClientRef(ref: string): { provider: string; model: string | undefined };

// Pure function: produces params for ClientRegistry.addLlmClient()
function createClientRegistryConfig(input: CreateClientConfigInput): ClientRegistryEntry;
```

Two modes:
1. **Proxy mode** (file-based functions): The .baml file declares `client "anthropic/claude-4.5-haiku"`. Bridge creates a ClientRegistryEntry with `base_url` and `api_key` from Pi's proxy config.

2. **PiClient mode** (dynamic functions): Agent code uses `client PiClient`. Bridge creates a "PiClient" entry using `defaultModel` from settings (parsed into provider + model ID).

Provider type resolution:

| BAML Provider | Pi API Type |
|---------------|-------------|
| `anthropic` | `anthropic-messages` |
| `openai` | `openai-completions` |
| `openai-generic` | `openai-completions` |
| `google-ai` | `google-generative-ai` |
| `vertex-ai` | `google-vertex` |
| `aws-bedrock` | `bedrock-converse-stream` |

### `src/lib/executor.ts`
Wraps `BamlRuntime` with Pi-specific lifecycle:

```typescript
function createBamlExecutor(input: CreateExecutorInput): BamlExecutor;
```

Implementation (closure-based, not class):

```typescript
// Compiles runtime
const runtime = BamlRuntime.fromFiles("/", files, {});
const ctx = runtime.createContextManager();

// Builds ClientRegistry from bridge config
const clientRegistry = new ClientRegistry();
clientRegistry.addLlmClient(config.name, config.provider, config.options);
clientRegistry.setPrimary(config.name);

// call() implementation
async function call<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  const collector = new Collector();
  const result = await runtime.callFunction(
    functionName, args, ctx, null, clientRegistry, [collector]
  );
  if (!result.isOk()) {
    // Enrich error with collector.last?.rawLlmResponse
    throw Object.assign(new Error(...), { bamlError: { type: "execution", rawOutput, ... } });
  }
  return result.parsed(false) as T;
}
```

Error handling:
- Compilation failure → `BamlError` with `type: "compilation"`, diagnostics array
- Execution failure → `BamlError` with `type: "execution"`, rawOutput from Collector
- Errors attached as `.bamlError` property on thrown Error instances

### `src/lib/registry.ts`
Discovers `.baml` files and manages function name resolution.

```typescript
// Parse function declarations from BAML source (regex-based)
function parseFunctionDeclarations(source: string): ParsedFunction[];

// Registry created from pre-loaded directory contents
class FunctionsRegistry {
  static fromGroups(groups: Record<string, Record<string, string>>): FunctionsRegistry;
  resolve(name: string): FunctionEntry;    // short name or "group/name"
  list(group?: string): FunctionInfo[];
  get isEmpty(): boolean;
}
```

Resolution logic:
- Tries qualified name first (direct map lookup)
- Falls back to short name via `shortNameIndex`
- Ambiguous short name → error with suggestion listing all qualified options

### `src/lib/cache.ts`
Session-scoped cache for compiled executors.

```typescript
class RuntimeCache<T> {
  getOrCreate(files: Record<string, string>, factory: (files) => T): T;
  clear(): void;
}
```

- Key = SHA-256 hash of sorted file contents (stable regardless of object key ordering)
- Registry functions use cache (compiled once, reused)
- Dynamic code (`baml_exec`) never cached (content changes each time)

### `src/tools/baml-list.ts`
```typescript
function createBamlListTool(registry: FunctionsRegistry): ToolDefinition;

// Parameters (JSON Schema):
{
  group: { type: "string", description: "Filter by group name (optional)" }
}
```

### `src/tools/baml-run.ts`
```typescript
function createBamlRunTool(registry: FunctionsRegistry, executorFactory: ExecutorFactory): ToolDefinition;

// Parameters (JSON Schema):
{
  function: { type: "string", description: "Function name (or group/name if ambiguous)" },
  args: { type: "object", description: "Function arguments as key-value pairs" },
  model: { type: "string", description: "Optional model override" }
}
```

### `src/tools/baml-exec.ts`
```typescript
function createBamlExecTool(settings: BamlSettings, executorFactory: ExecExecutorFactory): ToolDefinition;

// Parameters (JSON Schema):
{
  code: { type: "string", description: "BAML source code defining at least one function" },
  function: { type: "string", description: "Function name to call" },
  args: { type: "object", description: "Function arguments as key-value pairs" },
  provider: { type: "string", description: "BAML provider name override" },
  model: { type: "string", description: "Model override" }
}
```

### `src/eventbus.ts`
Creates and manages the public library API:

```typescript
function createPiBamlLibrary(input: CreateLibraryInput): PiBamlLibraryInternal;
```

The returned `PiBamlLibraryInternal` extends `PiBamlLibrary` with:
- `setModelRegistry(registry)` — called on session_start
- `setRegistry(registry)` — called after function discovery

State machine:
- Before `setModelRegistry()`: all methods throw "not initialized"
- After `setModelRegistry()`: methods resolve API keys and create executors
- With `available: false`: all methods throw "BAML runtime unavailable"

### `src/index.ts`
Extension factory entry point:

```typescript
function createPiBamlExtension(pi: PiExtensionAPI, options?: ExtensionOptions): void;
export default createPiBamlExtension;
```

Factory phase (synchronous):
1. Parse config from `pi.settings`
2. Create `PiBamlLibraryInternal` via `createPiBamlLibrary()`
3. Create empty `FunctionsRegistry`
4. Emit `"pi-baml:ready"` with library
5. Register all three tools

Session_start phase (async):
1. Capture `ctx.modelRegistry` via `lib.setModelRegistry()`

## Caching Strategy

```
Session lifetime cache:
┌─────────────────────────────────────────────────┐
│  RuntimeCache<BamlExecutor>                     │
│  key = SHA-256(sorted file contents)            │
│  value = BamlExecutor (compiled runtime)        │
│                                                 │
│  Invalidation: none (session-scoped)            │
│  Cleared: on session end (garbage collected)    │
└─────────────────────────────────────────────────┘
```

- Registry functions compiled on first call, cached for session
- Dynamic code (`baml_exec`) compiled per-call, disposed after use
- `baml_run` with same function reuses cached executor

## Error Handling

All errors use a structured type attached to thrown Error instances:

```typescript
interface BamlError {
  readonly error: string;          // Human-readable error message
  readonly type: BamlErrorType;    // "compilation" | "execution" | "configuration" | "unavailable"
  readonly rawOutput?: string;     // Raw LLM response (execution errors only)
  readonly diagnostics?: string[]; // BAML compiler diagnostics (compilation errors only)
}

// Attached to Error instances as:
throw Object.assign(new Error(message), { bamlError: BamlError });
```

Tool results serialize errors as JSON strings for the agent to parse and potentially retry.

## V1 Limitations

- `createExecutorFromDir()` is a stub — throws "not yet implemented"
- No AbortSignal support — BAML's `callFunction` API doesn't accept one
- Registry is created empty at factory time — disk discovery deferred to V1.1
- No eager compilation at session_start — deferred to V1.1
- `PI_BAML_LOG_LEVEL` env var not yet implemented
