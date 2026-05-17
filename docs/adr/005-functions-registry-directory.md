# ADR-005: Functions Registry with Directory Discovery

## Status
Accepted

## Context

The agent needs to invoke pre-defined BAML functions without knowing file paths. We need a way to organize, discover, and reference .baml functions by name — similar to how Pi discovers skills from `~/.agents/skills/`.

## Decision

Implement a functions registry that discovers `.baml` files from well-known directories:

1. `<cwd>/.pi/baml/` — project-specific (highest priority)
2. `~/.pi/baml/` — Pi-local
3. `~/.agents/baml/` — shared across agents

Each **subdirectory** is one compilation unit (files within share types). Functions are referenced by short name when unambiguous, or `group/FunctionName` when collisions exist.

```
~/.agents/baml/
├── extraction/          ← group "extraction"
│   ├── main.baml       ← ExtractActionItems, ExtractEntities
│   └── types.baml      ← shared types
├── classification/      ← group "classification"
│   └── main.baml       ← ClassifyIntent
```

The agent calls: `baml_run({ function: "ExtractActionItems", args: {...} })`

## Alternatives Considered

1. **Flat file registry** — one .baml file per function, all in one directory. Doesn't support shared types between functions in the same domain.
2. **Explicit manifest file** — require a `baml.json` that lists functions. Adds friction to adding new functions.
3. **No registry** — always require full file path. Poor agent ergonomics; path resolution is error-prone.

## Consequences

- Adding a new function = creating a subdirectory + .baml file. No manifest to update.
- Function names must be unique within a group (BAML compiler enforces this)
- Cross-group name collisions require qualified name — clear error message guides the user
- Discovery happens at `session_start` (eager) — new files require session restart or future `/baml reload`
- Priority ordering means project-level .baml files can shadow global ones (intentional)
