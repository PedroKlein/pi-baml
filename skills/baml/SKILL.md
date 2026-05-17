---
name: baml
description: >
  Write correct BAML code for structured LLM output via pi-baml.
  Use when authoring dynamic BAML for baml_exec or creating .baml
  files for the functions registry. Covers type system, prompt
  patterns, and conventions.
---

# BAML Authoring for pi-baml

Write BAML code that compiles and produces typed structured output via pi-baml's tools.

## Quick Start

```baml
class ActionItem {
  description string @description("what needs to be done")
  priority "high" | "medium" | "low"
}

function ExtractActionItems(notes: string) -> ActionItem[] {
  client PiClient
  prompt #"
    Extract action items from the text below.

    {{ ctx.output_format }}

    ---
    {{ notes }}
  "#
}
```

## Type System

### Primitives

| Type | Description |
|------|-------------|
| `string` | Text |
| `int` | Integer |
| `float` | Floating point |
| `bool` | Boolean |

### Literal Unions

```baml
"high" | "medium" | "low"
"bug" | "feature" | "chore"
```

### Optionals

```baml
assignee string?          // nullable field
due_date string?
```

### Arrays

```baml
tags string[]             // array of strings
items ActionItem[]        // array of custom type
```

### Classes

```baml
class Person {
  name string
  age int
  email string?
  roles string[]
}
```

### Nested Types

```baml
class Address {
  street string
  city string
  country string
}

class Company {
  name string
  address Address
  employees Person[]
}
```

### Enums

```baml
enum Category {
  BUG
  FEATURE
  DOCUMENTATION
  REFACTOR
}
```

## Function Structure

Every function has: input params, return type, client, and prompt.

```baml
function FunctionName(param1: type1, param2: type2) -> ReturnType {
  client PiClient
  prompt #"
    Your instructions here.

    {{ ctx.output_format }}

    Input: {{ param1 }}
  "#
}
```

### Rules

1. **Always use `client PiClient`** for dynamic code (`baml_exec`)
2. **Always include `{{ ctx.output_format }}`** — this injects the schema for the LLM
3. **Reference params with `{{ param_name }}`** — Jinja syntax
4. **Return type is mandatory** — the LLM output is parsed against it

## Prompt Patterns

### Raw string syntax

Use `#"..."#` for prompts (BAML's raw string — no escape needed):

```baml
prompt #"
  Multi-line prompt.
  No escaping needed for "quotes" or \backslashes\.
"#
```

### Jinja templating

```baml
prompt #"
  {# Comment — not sent to LLM #}

  {% if context %}
  Context: {{ context }}
  {% endif %}

  {% for item in items %}
  - {{ item }}
  {% endfor %}

  {{ ctx.output_format }}
"#
```

### The `ctx.output_format` directive

**Always include this.** It generates schema instructions for the LLM based on your return type, including `@description` annotations.

Place it where you want the schema to appear — typically after your instructions, before the input data.

## Annotations

### `@description` on fields

Guide the LLM on what each field means:

```baml
class Meeting {
  title string @description("the meeting subject line")
  duration_minutes int @description("total length in minutes")
  key_decisions string[] @description("list of decisions made, one per item")
  next_steps string? @description("agreed follow-up, if any")
}
```

### `@alias` on fields

Rename the JSON key the LLM sees:

```baml
class Record {
  user_name string @alias("name")
}
```

## Anti-Patterns

### ❌ Do NOT define client blocks

```baml
// BAD — do not do this
client MyClient {
  provider anthropic
  options { model "claude-4.5-haiku" }
}
```

pi-baml handles client configuration through settings.json. Just use `client PiClient`.

### ❌ Do NOT use environment variables

```baml
// BAD
client MyClient {
  options { api_key env.ANTHROPIC_API_KEY }
}
```

pi-baml resolves credentials from Pi's ModelRegistry.

### ❌ Do NOT add generator blocks

```baml
// BAD
generator my_gen {
  output_type typescript
  output_dir ./generated
}
```

pi-baml uses the runtime API directly — no code generation needed.

### ❌ Do NOT omit `ctx.output_format`

Without it, the LLM doesn't know your expected schema and output parsing will fail.

### ❌ Do NOT omit `client`

Every function must declare a client. Use `client PiClient` for dynamic code.

## Example: Simple Extraction

```baml
class ContactInfo {
  name string @description("full name of the person")
  email string? @description("email address if mentioned")
  phone string? @description("phone number if mentioned")
  role string? @description("job title or role if mentioned")
}

function ExtractContacts(text: string) -> ContactInfo[] {
  client PiClient
  prompt #"
    Extract all contact information from the text.
    Return an empty array if no contacts are found.

    {{ ctx.output_format }}

    ---
    {{ text }}
  "#
}
```

## Example: Classification with Unions

```baml
function ClassifySentiment(text: string) -> "positive" | "negative" | "neutral" {
  client PiClient
  prompt #"
    Classify the sentiment of the following text.

    {{ ctx.output_format }}

    Text: {{ text }}
  "#
}
```

## Example: Complex Nested Output

```baml
class CodeReview {
  summary string @description("one-line summary of the review")
  issues Issue[] @description("problems found in the code")
  suggestions string[] @description("improvement ideas, not bugs")
  approved bool @description("true if code is ready to merge")
}

class Issue {
  severity "critical" | "warning" | "info"
  file string @description("relative file path")
  line int? @description("line number if applicable")
  description string @description("what the problem is")
  fix string? @description("suggested fix if obvious")
}

function ReviewCode(diff: string, context: string) -> CodeReview {
  client PiClient
  prompt #"
    Review this code change. Be specific about issues.

    {{ ctx.output_format }}

    Context about the codebase:
    {{ context }}

    Diff to review:
    {{ diff }}
  "#
}
```

## Checklist

Before submitting BAML code:

- [ ] Uses `client PiClient` (not a custom client block)
- [ ] Includes `{{ ctx.output_format }}` in the prompt
- [ ] All input params referenced with `{{ param_name }}`
- [ ] Return type fully defined (all fields have types)
- [ ] `@description` on non-obvious fields
- [ ] No generator blocks, no env vars, no client definitions
