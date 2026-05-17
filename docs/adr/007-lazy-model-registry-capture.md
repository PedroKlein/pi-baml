# ADR-007: Lazy ModelRegistry Capture

## Status
Accepted

## Context

pi-baml emits its library API during the factory phase (ADR-004), but `ctx.modelRegistry` is only accessible in event handlers (like `session_start`). The library needs ModelRegistry to resolve credentials, but doesn't have it at emit time.

## Decision

Use lazy capture: the library object is emitted immediately (valid reference), but internally stores `modelRegistry = null`. At `session_start`, pi-baml captures `ctx.modelRegistry` and stores it. Library methods that need credentials check the internal reference.

If a method is called before `session_start` (before modelRegistry is set), throw a clear error:
```
"pi-baml: not initialized. Library methods are available only after session_start."
```

## Alternatives Considered

1. **Pass modelRegistry per-call** — every extension passes `ctx.modelRegistry` when calling the library. No internal state, but verbose API: `baml.createExecutor(files, config, ctx.modelRegistry)`. Every consumer needs access to ctx.
2. **Emit after session_start** — library isn't available until session_start. But then dependent extensions can't compile in their own session_start (ordering issue — see ADR-004).
3. **Emit a Promise** — library is a Promise that resolves when modelRegistry is captured. Adds async complexity to every consumer's factory.

## Consequences

- Clean caller API: `baml.createExecutor(files, config)` — no modelRegistry param
- Extensions must not call executor methods during their factory phase (only after session_start)
- The timing constraint matches natural usage: extensions grab the reference in factory, use it in session_start or later event handlers
- Single clear error message if the constraint is violated
