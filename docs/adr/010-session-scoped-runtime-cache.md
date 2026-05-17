# ADR-010: Session-Scoped Runtime Caching

## Status
Accepted

## Context

`BamlRuntime.fromFiles()` compiles .baml source into an executable runtime. For registry functions that are called repeatedly (e.g., a classifier called on every turn), recompiling each time is wasteful. However, file contents are static within a session.

## Decision

Cache `BamlRuntime` instances for the session lifetime, keyed by content hash.

- **Registry functions:** compiled eagerly at `session_start`, cached for the session
- **Dynamic code (`baml_exec`):** compiled fresh per-call (content changes each time, no cache benefit)
- **Cache invalidation:** none needed — .baml files don't change during a session
- **Cache cleared:** on `session_shutdown`

```typescript
const runtimeCache = new Map<string, BamlRuntime>();

function getOrCreateRuntime(files: Record<string, string>): BamlRuntime {
  const key = hashFiles(files);
  if (runtimeCache.has(key)) return runtimeCache.get(key)!;
  const runtime = BamlRuntime.fromFiles("/", files, envVars);
  runtimeCache.set(key, runtime);
  return runtime;
}
```

## Alternatives Considered

1. **Fresh compilation per-call** — simple, no state. But adds unnecessary latency for repeated calls to the same function.
2. **Cache with invalidation on model_select** — considered early, but the BAML model config comes from settings.json (static), not from the user's interactive model. No invalidation trigger exists.
3. **Global persistent cache (across sessions)** — overkill; sessions are short-lived and .baml files may change between sessions.

## Consequences

- First call to a registry function pays compilation cost; subsequent calls are fast
- Memory usage: one BamlRuntime per unique compilation unit (typically 5-15 in a session)
- If user edits .baml files mid-session, changes aren't picked up (acceptable — requires session restart or future `/baml reload`)
- Dynamic code always compiles fresh — no stale cache risk
