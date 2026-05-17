# ADR-007: ModelRegistry as Explicit Parameter

## Status
Superseded (replaces original "Lazy ModelRegistry Capture")

## Context

pi-baml emits its library API during the factory phase (ADR-004), but `ctx.modelRegistry` is only accessible in event handlers (like `session_start`). The library needs ModelRegistry to resolve credentials, but doesn't have it at emit time.

The original design used lazy capture: the library stored `modelRegistry = null` internally and pi-baml's `session_start` handler called `setModelRegistry()`. This caused a **deadlock** when consumers awaited library methods in their own `session_start` handlers — Pi fires handlers sequentially, so if a consumer's handler blocked waiting for ModelRegistry, pi-baml's handler could never fire.

## Decision

ModelRegistry is a **required parameter** on all library methods that need credentials. No internal state, no lifecycle coupling.

```typescript
// Consumer passes ctx.modelRegistry directly:
const executor = await baml.createExecutor(files, ctx.modelRegistry, "light");
const result = await baml.execBaml(code, fn, args, ctx.modelRegistry, "standard");
const todos = await baml.call("ExtractTodos", { notes }, ctx.modelRegistry, "heavy");
```

pi-baml has no `session_start` handler. The library is fully usable the moment it's emitted.

## Alternatives Considered

1. **Lazy capture with deferred promise** — `createExecutor` awaits a promise that resolves when `setModelRegistry` is called. Still deadlocks because Pi's sequential `session_start` handler execution prevents the resolve from ever firing if a consumer awaits first.
2. **Lazy capture with throw** — original design. Throws "not initialized" if called before `session_start`. Fails for any consumer that needs the executor during their own `session_start`.
3. **Emit after session_start** — library isn't available until `session_start`. Dependent extensions can't compile in their own `session_start` (ordering issue — see ADR-004).

## Consequences

- No deadlocks regardless of extension loading order
- Every caller has `ctx.modelRegistry` available in their own event handler context
- Slightly more verbose API: callers pass `modelRegistry` on each call
- No internal state machine — library is stateless w.r.t. credentials
- pi-baml extension has zero lifecycle handlers (no `session_start`, no `session_end`)
