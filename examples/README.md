# pi-baml Examples

These examples demonstrate common BAML patterns for use with pi-baml.

## Directory Structure

Each subdirectory is a **compilation unit** — a self-contained set of .baml files that can be discovered by pi-baml's functions registry.

## Examples

### `classify-intent/`

**Pattern:** Classification with literal unions

Demonstrates:
- Literal union types (`"question" | "command" | ...`)
- `@description` annotations for field guidance
- Optional input parameters (`context: string?`)
- Jinja conditionals (`{% if context %}`)

**Use when:** You need to categorize input into a fixed set of categories.

### `extract-structured/`

**Pattern:** Structured data extraction

Demonstrates:
- Nested class types (`MeetingSummary` → `ActionItem`)
- Array fields (`string[]`, `ActionItem[]`)
- Optional fields (`string?`)
- Complex output structure with multiple levels

**Use when:** You need to extract structured data from unstructured text (meeting notes, documents, logs).

## Using These Examples

### As registry functions

Place these directories in any of pi-baml's discovery paths:
- `<project>/.pi/baml/`
- `~/.pi/baml/`
- `~/.agents/baml/`

Then invoke via `baml_run`:
```
baml_run({ function: "ClassifyIntent", args: { message: "Hello!" } })
```

### As templates for baml_exec

Copy the pattern, replace `client "anthropic/..."` with `client PiClient`, and pass to `baml_exec`.

## Key Conventions

1. Each function declares its own client (for registry use)
2. Always include `{{ ctx.output_format }}` in prompts
3. Use `@description` on fields to guide the LLM
4. One compilation unit per domain concept (classification, extraction, etc.)
