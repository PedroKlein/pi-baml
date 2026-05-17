# ADR-011: Return Raw LLM Output Alongside Errors

## Status
Accepted

## Context

When BAML's SAP parser fails to match LLM output to the declared type, the agent needs to understand what went wrong. Possible issues:
- Schema too strict for the model's output style
- Prompt unclear, model returned something unexpected
- Model wrote chain-of-thought before structured output (usually SAP handles this, but not always)

Without seeing the raw output, the agent would be debugging blind.

## Decision

On execution errors, return a structured error that includes the raw LLM response:

```typescript
interface BamlError {
  error: string;            // "Failed to parse output for function ExtractActionItems"
  type: "execution";
  rawOutput?: string;       // The actual LLM response text
  diagnostics?: string[];   // BAML parser diagnostics
}
```

For compilation errors (bad .baml syntax), return diagnostics only (no LLM call was made):

```typescript
{
  error: "BAML compilation failed",
  type: "compilation",
  diagnostics: ["line 3: Expected '->' but found '{'", ...]
}
```

## Alternatives Considered

1. **Error message only** — simple but unhelpful. Agent can't distinguish "schema problem" from "model hallucinated".
2. **Auto-retry internally** — retry 1-2 times before surfacing error. Adds latency and cost without guarantee of success. Better to let the agent (which has context) decide whether to retry, adjust the schema, or change the prompt.
3. **Return partial parse** — try to extract whatever matched. Dangerous — partial data with missing required fields can cause downstream bugs.

## Consequences

- Agent can make informed retry decisions (adjust schema, fix prompt, try different model)
- Works naturally with pi's `auto-retry` extension — tool error triggers retry logic
- Raw output might be large (potentially truncated for tool result limits)
- BAML's `Collector` class provides access to raw responses after execution
