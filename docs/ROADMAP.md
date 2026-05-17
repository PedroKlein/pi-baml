# Roadmap

> Items deferred from V1. Prioritized by user impact.

## Completed

| Item | Shipped in |
|------|------------|
| Disk-based function discovery (`discoverBamlGroups`) | V1 |
| Custom tool rendering (`renderCall`/`renderResult`) | V1 |
| Enriched tool output with model/tier in result envelope | V1 |
| Model/tier displayed in tool footer alongside token usage | V1 |

---

## V1.1 — Completions

Remaining items from the original V1 spec:

### 1. `createExecutorFromDir()` implementation
**Priority:** High
**Files:** `src/eventbus.ts`

Read all `.baml` files from a directory path and pass to `createExecutor()`:
- `readdirSync` for `.baml` files in the given path
- Pass file map to existing `createExecutor()` flow
- Handle: directory doesn't exist, no .baml files found, permission errors

Currently: Throws "not yet implemented".

### 2. Eager compilation at session_start
**Priority:** Medium
**Files:** `src/index.ts`

After discovering registry functions, compile each compilation unit eagerly:
- Validates `.baml` syntax at startup (fail-fast on bad files)
- Populates the RuntimeCache so first `baml_run` call is fast
- Invalid files: log warning with file path + diagnostic, continue with others

Currently: No compilation until first tool call.

### 3. `PI_BAML_LOG_LEVEL` environment variable
**Priority:** Low
**Files:** `src/index.ts`

Control logging verbosity: `debug`, `info`, `warn`, `error` (default: `warn`).
Use for: compilation diagnostics, cache hits/misses, proxy resolution debugging.

---

## V1.2 — Developer Experience

### 5. `/baml reload` slash command
**Priority:** Medium

Re-scan discovery directories and recompile without restarting the session.
Useful when editing `.baml` files during development.

### 6. AbortSignal support
**Priority:** Low
**Files:** `src/lib/executor.ts`

Pass Pi's abort signal through to `callFunction` when BAML's API adds support.
Currently BAML's `callFunction(fn, args, ctx, tb, cr, collectors)` has no signal parameter.
Monitor: https://github.com/BoundaryML/baml/issues

### 7. TypeBox for tool parameters
**Priority:** Low
**Files:** `src/tools/*.ts`

Replace plain JSON Schema objects with TypeBox for type-safe parameter schemas.
Benefit: compile-time validation that schema matches execute() args type.
Currently: plain objects work fine, TypeBox adds complexity without much gain at this scale.

---

## V2 — Extended Capabilities

### 8. Streaming support
**Priority:** Medium

Use BAML's `streamFunction()` API for real-time output:
- Useful for long extraction tasks where partial results help
- Requires Pi tool streaming support (tool returns a stream, not a string)
- ADR needed: how to surface partial results to the agent

### 9. BAML test runner integration
**Priority:** Low

Run `.baml` test cases (BAML's built-in testing) from Pi:
- `baml_test` tool or slash command
- Execute test assertions defined in `.baml` files
- Report pass/fail to the agent

### 10. Multi-provider fallback
**Priority:** Low

When a provider call fails, try the next configured provider:
- Requires multiple proxy entries per BAML provider
- Or: BAML's built-in retry_policy with different clients
- ADR needed: should fallback live in pi-baml or in .baml files?

---

## Won't Do (Rejected)

| Item | Reason |
|------|--------|
| Auto-detect provider mappings | Ambiguous with multiple providers of same type (ADR-002) |
| Model ID remapping/translation | .baml authors responsible for correct IDs (ADR-009) |
| Generator blocks | pi-baml uses runtime API, no code generation needed |
| `baml-cli` dependency | Only `@boundaryml/baml` runtime is needed |
| Direct npm import from local extensions | Pi's jiti doesn't support it; EventBus is the solution (ADR-001) |
