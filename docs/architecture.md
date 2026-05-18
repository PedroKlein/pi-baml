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

### `src/lib/readme-parser.ts`
Pure-function frontmatter parser. Extracts `description` from README.md YAML frontmatter and body content. `README.md` files are never passed to `BamlRuntime.fromFiles()` — only `.baml` files are compiled.

```typescript
function parseReadmeDescription(content: string): string | undefined;
function parseReadmeBody(content: string): string | undefined;
```

### `src/lib/type-parser.ts`
Extracts class and enum type definitions from BAML source as raw strings. Used by `describeGroup()` to surface type signatures in detailed group responses.

```typescript
function parseTypeDefinitions(source: string): string[];
```

### `src/lib/system-prompt.ts`
Renders the `<available_baml_functions>` XML block for system prompt injection. Returns `null` when the registry is empty or all groups are `skill:` prefixed.

```typescript
function renderBamlSystemPrompt(registry: FunctionsRegistry): string | null;
```

### `src/lib/types.ts`
All shared TypeScript types. No logic. Exported for consumers who want type safety.

Key types:
- `ModelTier` — `"light" | "standard" | "heavy"`
- `BamlSettings` — `{ models: Record<ModelTier, string>; functionsDirs?: string[] }`
- `BamlExecutor` — interface: `call<T>(fn, args) → Promise<BamlCallResult<T>>`, `dispose() → void`
- `BamlCallResult<T>` — `{ parsed: T; metadata: BamlCallMetadata }`
- `BamlCallMetadata` — token usage, duration, model info
- `FunctionEntry` — internal function metadata (name, group, files, inputTypes, outputType)
- `FunctionInfo` — public function info (adds qualifiedName)
- `BamlErrorType` — `"compilation" | "execution" | "configuration" | "unavailable"`
- `BamlError` — structured error (error, type, rawOutput?, diagnostics?)

### `src/lib/config.ts`
Parses Pi's `settings.json` and extracts the `baml` configuration section.

```typescript
// Pure function — takes parsed settings object, returns validated config
function parseBamlSettings(settings: unknown): BamlSettings;
```

```typescript
interface BamlSettings {
  readonly models: Record<ModelTier, string>;  // "light" → "github-copilot/claude-haiku-4.5"
  readonly functionsDirs?: string[];           // additional discovery dirs
}
```

Fallback behavior:
- No `baml` key or null settings → throws (models are required)
- Missing any tier → throws with actionable message
- Invalid format (not "provider/model-id") → throws

### `src/lib/bridge.ts`
The single authority for model tier resolution and ClientRegistry assembly.

Exported functions:

```typescript
// Map Pi API type → BAML provider name (throws for unsupported APIs)
function mapPiApiToBamlProvider(piApi: string): string;

// Resolve a model tier to a ready-to-use ClientRegistry
async function resolveModelTier(
  settings: BamlSettings,
  modelRegistry: ModelRegistry,
  tier: ModelTier = "standard",
): Promise<ResolvedModel>;
```

`resolveModelTier` is the core function:
1. Parse `settings.models[tier]` → extract provider + modelId
2. `modelRegistry.find(provider, modelId)` → Model object (with api, baseUrl, headers)
3. `modelRegistry.getApiKeyAndHeaders(model)` → auth (apiKey + headers)
4. `mapPiApiToBamlProvider(model.api)` → BAML provider name
5. Build `ClientRegistry` with provider-specific auth handling:
   - **GitHub Copilot + anthropic**: Bearer token in headers, dummy api_key
   - **GitHub Copilot + openai-generic**: Real token as api_key (native Bearer)
   - **Standard providers**: api_key passed directly
6. Inject Copilot-specific headers when `provider === "github-copilot"`

Provider type resolution:

| Pi API Type | BAML Provider | Notes |
|-------------|---------------|-------|
| `anthropic-messages` | `anthropic` | Copilot: Bearer in headers |
| `openai-completions` | `openai-generic` | Copilot: Bearer via api_key |
| `google-generative-ai` | `google-ai` | |
| `google-vertex` | `vertex-ai` | |
| `bedrock-converse-stream` | `aws-bedrock` | |
| `openai-responses` | — | ❌ Throws error (BAML 0.85.0 limitation) |

### `src/lib/executor.ts`
Wraps `BamlRuntime` with Pi-specific lifecycle:

```typescript
function createBamlExecutor(input: CreateExecutorInput): BamlExecutor;
```

Input takes pre-built `ClientRegistry` — executor has zero model logic:

```typescript
interface CreateExecutorInput {
  readonly files: Record<string, string>;
  readonly clientRegistry: ClientRegistry;     // pre-built by bridge
  readonly syntheticProvider?: string;         // for the compiler placeholder
}
```

Implementation (closure-based, not class):

```typescript
// Compiles runtime (with synthetic PiClient block for compiler)
const runtime = BamlRuntime.fromFiles("/", compilationFiles, {});
const ctx = runtime.createContextManager();

// call() uses the pre-built clientRegistry directly
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
  resolve(name: string): FunctionEntry;
  list(group?: string): FunctionInfo[];
  listGroups(): GroupInfo[];                              // group index with descriptions
  describeGroup(name: string): GroupDetail | undefined;  // full detail: functions, types, readme
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

Two response shapes:
- **No `group` filter** — returns `GroupInfo[]`: compact index with name, file count, function count, description.
- **With `group` filter** — returns `GroupDetail`: full detail with function signatures, type definitions, and README body.
```

### `src/tools/baml-run.ts`
```typescript
function createBamlRunTool(registry: FunctionsRegistry, executorFactory: ExecutorFactory, settings: BamlSettings): ToolDefinition;

// Parameters (JSON Schema):
{
  function: { type: "string", description: "Function name (or group/name if ambiguous)" },
  args: { type: "object", description: "Function arguments as key-value pairs" },
  model: { type: "string", description: "Model tier override: 'light', 'standard', or 'heavy' (default: standard)" }
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
  model: { type: "string", description: "Model tier override: 'light', 'standard', or 'heavy' (default: standard)" }
}
```

### `src/eventbus.ts`
Creates and manages the public library API:

```typescript
function createPiBamlLibrary(input: CreateLibraryInput): PiBamlLibraryInternal;
```

The returned `PiBamlLibraryInternal` extends `PiBamlLibrary` with:
- `setRegistry(registry)` — called after function discovery

The library is stateless with respect to ModelRegistry — callers pass it on every method call.
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
3. Discover functions, create `FunctionsRegistry`, call `lib.setRegistry()`
4. Emit `"pi-baml:ready"` with library
5. Register all three tools

Lifecycle handler:
- `before_agent_start` — renders `<available_baml_functions>` block via `renderBamlSystemPrompt()` and appends it to the system prompt. Skipped when `baml.systemPrompt: false` or registry is empty.

## Model Resolution

All model decisions are centralized in `bridge.ts`. The tier system is simple:

```
baml_run/baml_exec → tier param (default: "standard") → settings.models[tier] → resolveModelTier()
```

`resolveModelTier()` does everything:
1. Parse "provider/model-id" from settings
2. Look up model in Pi's ModelRegistry
3. Get auth credentials
4. Map Pi API type → BAML provider
5. Build ClientRegistry with provider-specific auth (Copilot workarounds, etc.)

```
┌───────────────────────────────────────────────────────────────────┐
│  bridge.resolveModelTier(settings, modelRegistry, tier)           │
│    → { clientRegistry, bamlProvider }                             │
│                                                                   │
│  executor receives pre-built ClientRegistry (zero model logic)    │
│  tools are thin callers (zero model logic)                        │
└───────────────────────────────────────────────────────────────────┘
```

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
- Model override bypasses cache (creates fresh executor, disposed after use)

## Tool Output Shape

Success responses from `baml_run` and `baml_exec` use an enriched envelope:

```typescript
// content[0].text:
{
  result: T;          // The parsed BAML output
  model: string;      // Resolved model ref, e.g. "github-copilot/claude-sonnet-4.6"
  tier: ModelTier;    // "light" | "standard" | "heavy"
}

// details:
{
  metadata: BamlCallMetadata;  // tokens, duration, model from collector
}
```

The render layer (`render.ts`) unwraps this envelope to display:
- Pretty-printed JSON of `result` (the actual parsed output)
- Footer line: `↳ github-copilot/claude-sonnet-4.6 (standard) • 200 in → 50 out tokens • 2.3s`

Error responses remain unchanged: `{ error: string, type: BamlErrorType, ... }`

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
- No eager compilation at session_start — deferred to V1.1
- `PI_BAML_LOG_LEVEL` env var not yet implemented
