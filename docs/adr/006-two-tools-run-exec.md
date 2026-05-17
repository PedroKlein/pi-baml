# ADR-006: Separate baml_run and baml_exec Tools

## Status
Accepted

## Context

The agent needs two distinct capabilities:
1. Invoke pre-defined BAML functions from the registry (by name)
2. Dynamically author and execute new BAML code

These could be one unified tool or two separate tools.

## Decision

Register two separate tools:

- **`baml_run`** — execute a pre-defined function by name from the registry
  - Params: `{ function, args, model? }`
  - No code writing — just invocation
  
- **`baml_exec`** — compile + execute inline BAML code
  - Params: `{ code, function, args, provider?, model? }`
  - Agent writes the .baml source

Plus **`baml_list`** for discovery.

## Alternatives Considered

1. **Single unified `baml` tool** — with either `path` or `code` parameter. Problem: overloaded semantics (both params optional), harder for the agent to learn distinct use patterns, less precise schema validation.

## Consequences

- Clear intent separation: the agent knows when it's using existing code vs writing new code
- `baml_run` is simple — agent just needs a function name and args
- `baml_exec` triggers the BAML authoring skill for guidance on writing correct code
- Three tools in the tool list (baml_list + baml_run + baml_exec) — acceptable token cost
- Different prompt guidelines per tool (baml_run: "check baml_list first", baml_exec: "follow BAML patterns from skill")
