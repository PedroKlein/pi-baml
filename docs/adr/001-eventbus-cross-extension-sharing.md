# ADR-001: EventBus for Cross-Extension Sharing

## Status
Accepted

## Context

Pi extensions need to use pi-baml's library (createExecutor, execBaml, etc.) to compile and execute .baml files. However, Pi's extension loader uses jiti with a fixed alias map — only built-in packages (`@earendil-works/*`, `@sinclair/typebox`) are resolvable by local extensions. Arbitrary npm packages cannot be imported from local extension files.

We need a mechanism for pi-baml (npm package) to expose its library API to local extensions (in `~/.pi/agent/extensions/`).

## Decision

Use Pi's shared `EventBus` (`pi.events`) for cross-extension communication. pi-baml emits a `"pi-baml:ready"` event with the full library API as payload. Other extensions subscribe to this event and receive a typed reference.

```typescript
// pi-baml emits:
pi.events.emit("pi-baml:ready", { available: true, createExecutor, execBaml, ... });

// Consumer extension receives:
pi.events.on("pi-baml:ready", (lib) => { bamlLib = lib; });
```

## Alternatives Considered

1. **Global variable (`globalThis.__piBaml`)** — works but pollutes global namespace, no type safety, fragile.
2. **Internal tool invocation** — extensions call a registered tool instead of importing. Adds tool-call overhead and JSON serialization round-trip for every call.
3. **Local sibling library** — keep pi-baml-lib as a relative-import sibling in extensions/. Defeats the purpose of publishing as an npm package; not reusable by others.
4. **Request Pi core change for extension dependencies** — correct long-term but requires upstream changes we don't control.

## Consequences

- Other extensions must register their EventBus listener during their factory phase
- The library reference is untyped at the EventBus boundary (`unknown`) — consumers cast to `PiBamlLibrary`
- If pi-baml is not installed, the event never fires — consumers should handle `null` gracefully
- No compile-time type checking across the boundary (runtime contract only)
