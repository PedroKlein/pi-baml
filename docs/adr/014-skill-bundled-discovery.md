# ADR-014: Skill-Bundled BAML Discovery

## Status
Accepted

## Context

BAML functions were discoverable from four well-known directories (`<cwd>/.agents/baml/`, `<cwd>/.pi/baml/`, `~/.pi/baml/`, `~/.agents/baml/`), but the registry had no descriptions and no connection to Pi skills. Two problems followed:

1. **Agent discoverability** — the agent had no passive signal that BAML functions existed or what they did. It had to call `baml_list` proactively or remember from prior sessions. There was no mechanism equivalent to `<available_skills>` that primed the agent's context.

2. **Skill colocation** — skills that wanted BAML-backed logic (e.g. `diagnose`, `go-dev`) had no obvious home for `.baml` files. Placing them in `~/.agents/baml/` mixed skill-private functions with general-purpose ones. Placing them in the skill directory itself was conventional but not discovered.

## Decision

### 1. Skill directory scanning

Discovery gains a new tier at the lowest priority. Skill-colocated BAML is discovered lazily on the first agent turn via `before_agent_start`, using Pi's fully resolved skill paths (from `event.systemPromptOptions.skills[].baseDir`). This automatically follows the active profile — including custom `--skill` flags, npm-packaged skills, and profile-specific directories.

Two layouts are supported per skill (first match wins):

1. `<skill>/baml/*.baml` — dedicated subdirectory (preferred for multiple files)
2. `<skill>/*.baml` — flat files alongside SKILL.md (convenient for single-file schemas)

Each discovered skill becomes group `skill:<skill>`.

Full discovery priority (lowest → highest):

| Priority | Path | Group prefix |
|----------|------|-------------|
| 1 (lowest) | Pi's resolved skill paths (lazy) | `skill:` |
| 2 | `~/.agents/baml/<group>/` | none |
| 3 | `~/.pi/baml/<group>/` | none |
| 4 | `[settings.functionsDirs]` | none |
| 5 | `<cwd>/.pi/baml/<group>/` | none |
| 6 (highest) | `<cwd>/.agents/baml/<group>/` | none |

### 2. README.md descriptions

Each group directory may contain a `README.md`. Discovery reads it and extracts a `description` from the YAML frontmatter. This description propagates to `GroupInfo` and appears in the system prompt.

```markdown
---
description: Extract TODO items from freeform text — meeting notes, changelogs, code comments.
---

# Extract TODOs

Longer documentation shown when the agent calls `baml_list` with a group filter.
```

`README.md` is never passed to `BamlRuntime.fromFiles()` — only `.baml` files are compiled.

### 3. System prompt injection via `before_agent_start`

`src/index.ts` registers a `before_agent_start` handler. When called, it renders an `<available_baml_functions>` XML block (matching the shape of `<available_skills>`) and appends it to the system prompt. The block lists all non-skill groups with their descriptions.

`skill:*` groups are excluded from the system prompt — they are implementation details of their owning skill, not general-purpose tools the agent should reach for directly.

The injection can be disabled with `baml.systemPrompt: false` in settings.

### 4. Two-shape `baml_list`

`baml_list` gains two response shapes:

- **No filter** — returns `GroupInfo[]`: compact index of groups with name, file count, function count, and description.
- **With `group` filter** — returns `GroupDetail`: full detail including function signatures, type definitions, and README body.

This keeps the unfiltered response token-efficient while providing rich detail on demand.

## Consequences

- Groups without `README.md` still work — they appear in `baml_list` but lack description in the system prompt.
- Skill-colocated BAML is discovered lazily on the first agent turn, not at factory time. This is correct because `skill:` groups are excluded from the system prompt (which is the only factory-time consumer) and `baml_run` calls only happen after the agent starts.
- The `skill:` prefix is a literal string in registry keys. Qualified function names become `skill:diagnose/ClassifyBugPhase`. The prefix signals to both the agent and human readers that the function belongs to a skill's internal implementation.
- `baml_list` output format is a breaking change. No backward compatibility migration is needed (project convention: prefer clean over compatible).
- The `before_agent_start` pattern is an established Pi extension hook; no new lifecycle coupling is introduced.
- Flat `.baml` layout (`<skill>/*.baml`) enables single-file skill schemas without a dedicated subdirectory. The `baml/` subdirectory takes precedence when both exist.
