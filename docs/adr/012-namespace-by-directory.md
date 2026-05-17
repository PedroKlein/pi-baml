# ADR-012: Namespace Functions by Directory Group

## Status
Accepted

## Context

The functions registry discovers .baml files from multiple directories. Two different groups could define functions with the same name (e.g., both `extraction/Summarize` and `transformation/Summarize`). We need a naming/resolution strategy.

## Decision

Functions are namespaced by their directory group name. Resolution supports both short names (when unambiguous) and qualified names (always unique):

- **Short name:** `"Summarize"` — works if only one function has this name across all groups
- **Qualified name:** `"transformation/Summarize"` — always works, group name is the subdirectory

On ambiguous short name, return an error with a hint:
```
"Ambiguous function name 'Summarize'. Use 'extraction/Summarize' or 'transformation/Summarize'."
```

## Alternatives Considered

1. **Flat namespace, error on collision** — refuse to load when names collide. Too restrictive — forces users to rename functions to avoid conflicts.
2. **Last-wins by priority** — project-level shadows global. Problem: global function silently becomes unreachable. User confusion.
3. **Always require qualified names** — safe but verbose. `baml_run({ function: "extraction/ExtractActionItems" })` is annoying when there's no ambiguity.

## Consequences

- Short names work in the common case (no collisions) — good ergonomics
- Qualified names provide an escape hatch when collisions exist
- Error messages are actionable — user knows exactly what to type
- `baml_list` shows both short and qualified names so the agent can choose
- Registry must track all names per-group and detect collisions at discovery time
