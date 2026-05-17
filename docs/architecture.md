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
│                    │    PiBamlLib       │                        │
│                    │  (bridge layer)    │                        │
│                    └────┬────┬────┬────┘                        │
│                         │    │    │                              │
│            ┌────────────┘    │    └────────────┐                │
│            │                 │                 │                 │
│  ┌─────────▼────┐  ┌────────▼───────┐  ┌─────▼──────────┐     │
│  │  Registry    │  │    Bridge      │  │   Executor     │     │
│  │(file discov.)│  │(provider map)  │  │(runtime wrap)  │     │
│  └──────────────┘  └────────┬───────┘  └───────┬────────┘     │
│                              │                  │               │
│                    ┌─────────▼──────────────────▼──────┐        │
│                    │         @boundaryml/baml           │        │
│                    │  BamlRuntime · ClientRegistry      │        │
│                    └─────────────────┬─────────────────┘        │
│                                      │                          │
├──────────────────────────────────────┼──────────────────────────┤
│                    Pi ModelRegistry   │                          │
│                    ┌─────────────────▼─────────────────┐        │
│                    │  getApiKeyForProvider(name)        │        │
│                    │  find(provider, modelId)           │        │
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
- `ProxyConfig` — parsed proxy configuration from settings
- `ProxyEntry` — single proxy mapping (Pi provider name + optional base_url)
- `PiBamlConfig` — per-call config (provider + model to use)
- `FunctionEntry` — discovered function metadata
- `FunctionInfo` — public-facing function info (for baml_list)
- `BamlExecutor` — interface with `call<T>()` + `dispose()`
- `PiBamlLibrary` — the EventBus API shape
- `BamlError` — structured error with raw output

### `src/lib/config.ts`
Reads Pi's `settings.json` and extracts the `baml` configuration section.

```typescript
interface BamlSettings {
  proxy: Record<string, ProxyEntry>;   // "anthropic" → { provider: "hai-proxy", base_url?: "..." }
  defaultModel: string;                // "anthropic/claude-4.5-haiku"
  extensions?: Record<string, PiBamlConfig>;  // per-extension overrides
  functionsDirs?: string[];            // additional discovery dirs
}
```

Fallback behavior:
- No `baml` key → empty proxy, no default model (tools return helpful config error)
- Missing `proxy` entries → functions using that provider will fail with clear error
- Missing `defaultModel` → `baml_exec` requires explicit model param

### `src/lib/bridge.ts`
The core integration logic. Creates BAML `ClientRegistry` instances configured with Pi's credentials.

Two modes:
1. **Proxy mode** (file-based functions): The .baml file declares `client "anthropic/claude-4.5-haiku"`. Bridge creates a ClientRegistry entry named `"anthropic/claude-4.5-haiku"` with `base_url` and `api_key` from Pi's proxy config. Passed to `callFunction` to override the default Anthropic URL.

2. **PiClient mode** (dynamic functions): Agent code uses `client PiClient`. Bridge creates a "PiClient" entry using `defaultModel` from settings (parsed into provider + model ID).

Provider type resolution:
```typescript
function mapBamlProviderToPiApi(bamlProvider: string): string {
  switch (bamlProvider) {
    case "anthropic": return "anthropic-messages";
    case "openai":
    case "openai-generic": return "openai-completions";
    case "google-ai": return "google-generative-ai";
    case "vertex-ai": return "google-vertex";
    case "aws-bedrock": return "bedrock-converse-stream";
    default: return bamlProvider;
  }
}
```

### `src/lib/executor.ts`
Wraps `BamlRuntime` with Pi-specific lifecycle:

```typescript
class PiBamlExecutor implements BamlExecutor {
  private runtime: BamlRuntime;
  private ctx: RuntimeContextManager;
  private clientRegistry: ClientRegistry;
  
  async call<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
    const collector = new Collector();
    try {
      const result = await this.runtime.callFunction(
        functionName, args, this.ctx, null,
        this.clientRegistry, [collector], {}, {}, this.signal
      );
      if (!result.isOk()) {
        throw new BamlExecutionError(result, collector);
      }
      return result.parsed(false) as T;
    } catch (err) {
      // Attach raw output from collector if available
      throw enrichError(err, collector);
    }
  }
}
```

### `src/lib/registry.ts`
Discovers `.baml` files from configured directories.

Discovery algorithm:
1. Scan each directory for subdirectories
2. Each subdirectory = one compilation unit (group)
3. Read all `.baml` files in the subdirectory
4. Parse function declarations via regex: `function\s+(\w+)\s*\(([^)]*)\)\s*->\s*(.+?)\s*\{`
5. Store in map with namespace: `group/FunctionName`
6. Track short-name → group mapping for ambiguity detection

Resolution:
- `resolve("ExtractActionItems")` → exact match on short name if unambiguous
- `resolve("extraction/ExtractActionItems")` → exact match on qualified name
- Ambiguous short name → error with suggestion to qualify

### `src/tools/baml-run.ts`
```typescript
parameters: Type.Object({
  function: Type.String({ description: "Function name (or group/name)" }),
  args: Type.Record(Type.String(), Type.Unknown(), { description: "Function arguments" }),
  model: Type.Optional(Type.String({ description: "Override model (e.g. 'anthropic/claude-4.5-sonnet')" })),
})
```

### `src/tools/baml-exec.ts`
```typescript
parameters: Type.Object({
  code: Type.String({ description: "BAML source code defining at least one function" }),
  function: Type.String({ description: "Function name to call" }),
  args: Type.Record(Type.String(), Type.Unknown(), { description: "Function arguments" }),
  provider: Type.Optional(Type.String({ description: "BAML provider name (default from settings)" })),
  model: Type.Optional(Type.String({ description: "Model override" })),
})
```

### `src/eventbus.ts`
Defines and emits the public library API:

```typescript
interface PiBamlLibrary {
  /** Whether the BAML runtime loaded successfully */
  available: boolean;
  
  /** Create executor from in-memory .baml file contents */
  createExecutor(files: Record<string, string>, config?: PiBamlConfig): Promise<BamlExecutor>;
  
  /** Create executor from a directory of .baml files */
  createExecutorFromDir(path: string, config?: PiBamlConfig): Promise<BamlExecutor>;
  
  /** One-shot: compile + execute dynamic BAML code */
  execBaml<T = unknown>(code: string, fn: string, args: Record<string, unknown>, config?: PiBamlConfig): Promise<T>;
  
  /** Call a registered function by name (from the registry) */
  call<T = unknown>(fn: string, args: Record<string, unknown>, modelOverride?: string): Promise<T>;
  
  /** List all discovered functions */
  list(group?: string): FunctionInfo[];
  
  /** Get a pre-configured API for a specific extension */
  forExtension(name: string): {
    createExecutor(files: Record<string, string>): Promise<BamlExecutor>;
    createExecutorFromDir(path: string): Promise<BamlExecutor>;
  };
}
```

## Caching Strategy

```
Session lifetime cache:
┌─────────────────────────────────────────────────┐
│  runtimeCache: Map<string, BamlRuntime>         │
│  key = hash of file contents                    │
│  value = compiled BamlRuntime                   │
│                                                 │
│  Invalidation: none (session-scoped)            │
│  Cleared: on session_shutdown                   │
└─────────────────────────────────────────────────┘
```

- Registry functions are compiled eagerly at `session_start`
- Dynamic code (`baml_exec`) is compiled per-call (no cache — content changes each time)
- `baml_run` with same function reuses cached runtime

## Error Handling

All errors return structured data:

```typescript
interface BamlError {
  error: string;          // Human-readable error message
  type: "compilation" | "execution" | "configuration" | "unavailable";
  rawOutput?: string;     // Raw LLM response (execution errors only)
  diagnostics?: string[]; // BAML compiler diagnostics (compilation errors only)
}
```

Tool results format errors as JSON for the agent to parse and potentially retry.
