# ADR-009: .baml Files Own Their Model Declaration

## Status
Superseded by `client PiClient` convention with three-tier model resolution

The original decision (files own their model) was replaced by a uniform convention: all `.baml` files use `client PiClient`, and the model is selected at call time via the tier system (`light`/`standard`/`heavy`). This simplifies the system — model selection belongs to the caller (agent/tool/extension), not the file author. The `ClientRegistry` override in `bridge.ts` ensures the file-declared client is always replaced by the tier-resolved model.

## Context

When a .baml file lives on disk (in the registry or in an extension's `baml/` directory), it needs to specify which LLM model to use. Two philosophies:

1. The .baml file declares its model — pi-baml only provides credentials/routing
2. The .baml file uses a generic placeholder — pi-baml decides the model from settings

## Decision

File-based .baml functions declare their own model using standard BAML syntax:

```baml
function ClassifySkill(prompt: string) -> SkillMatch {
  client "anthropic/claude-4.5-haiku"   // ← file owns this
  prompt #"..."#
}
```

pi-baml's proxy config routes the `anthropic` provider through the configured Pi provider (e.g., hai-proxy), providing credentials and base_url. But the model choice belongs to the .baml file author.

For **dynamic code** (`baml_exec`), the convention is `client PiClient` — resolved from `settings.json` default or tool params.

## Alternatives Considered

1. **Always override from settings** — .baml files use a placeholder (`client PiClient`), settings.json maps it to a real model. Problem: loses the ability for different functions to use different models. A classifier should use haiku; a complex extractor might need sonnet. The function author knows best.

2. **Pi-specific URI syntax** — `client "pi://hai-proxy/anthropic--claude-4.5-haiku"`. Problem: non-standard, .baml files aren't portable, IDE tooling won't understand it.

## Consequences

- .baml files are portable and use standard BAML syntax — IDE playground works
- Different functions can use different models (cheap for classifiers, smart for complex extraction)
- The proxy config applies to all functions using a given provider — credential resolution is uniform
- `baml_run` supports optional `model` override for when the agent needs a smarter model for a specific call
- No model ID translation — .baml authors use IDs that their proxy understands
