# ADR-004: Emit Library from Factory Function

## Status
Accepted

## Context

Pi extensions that depend on pi-baml need the library reference to eagerly compile their .baml files at `session_start`. Pi loads extensions in this order:

1. Project-local extensions (`cwd/.pi/extensions/`)
2. Global extensions (`~/.pi/agent/extensions/`) — where pi-memory, workflow-modes live
3. Package extensions (`npm:*` from settings.json) — where pi-baml lives

After all factories complete, `session_start` fires for all extensions (in load order).

If pi-baml emits on `session_start`, its handler fires AFTER dependent extensions' handlers (since packages load last). Dependent extensions wouldn't have the reference when they need it.

## Decision

pi-baml emits `"pi-baml:ready"` from its factory function (during the load phase), not from `session_start`.

Sequence:
```
1. pi-memory factory → registers pi.events.on("pi-baml:ready", cb)
2. pi-baml factory → emits pi.events.emit("pi-baml:ready", lib)
   → pi-memory's callback fires synchronously
3. session_start fires → pi-memory already has the library reference
```

## Alternatives Considered

1. **Emit on session_start** — broken because pi-baml's session_start fires after dependent extensions.
2. **Install pi-baml as local extension** — it would sort alphabetically before pi-memory. Defeats npm package distribution.
3. **Two-phase lazy init** — extensions get a Promise that resolves when pi-baml is ready. Adds complexity to every consumer.
4. **Pi core extension dependencies** — requires upstream changes.

## Consequences

- The library is emitted before `session_start` — `ModelRegistry` is NOT available yet at emit time
- Library methods that need ModelRegistry must defer (lazy capture pattern — see ADR-007)
- Extensions can grab the reference in their factory but cannot call executor methods until `session_start`
- If pi-baml is not in the packages list, the event never fires — consumers handle null
