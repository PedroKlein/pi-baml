import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseBamlSettings } from "./lib/config.js";
import { FunctionsRegistry } from "./lib/registry.js";
import { createPiBamlLibrary, type PiBamlLibraryInternal } from "./eventbus.js";
import { createBamlListTool } from "./tools/baml-list.js";
import { createBamlRunTool } from "./tools/baml-run.js";
import { createBamlExecTool } from "./tools/baml-exec.js";
import { createBamlExecutor } from "./lib/executor.js";
import {
  renderBamlExecCall,
  renderBamlRunCall,
  renderBamlListCall,
  renderBamlResult,
  renderBamlListResult,
} from "./tools/render.js";
import type { BamlError } from "./lib/types.js";
import type { ToolContext, ToolResult } from "./tools/types.js";

/**
 * Create a Text component for tool rendering.
 *
 * Uses dynamic import of @earendil-works/pi-tui with caching.
 * Falls back to a minimal component satisfying Pi's Component interface
 * when the TUI package isn't available (e.g. in unit tests).
 */
type TextConstructor = new (text: string, px: number, py: number) => unknown;
let textClassPromise: Promise<TextConstructor | null> | undefined;

function getTextClass(): Promise<TextConstructor | null> {
  if (!textClassPromise) {
    textClassPromise = import("@earendil-works/pi-tui")
      .then((tui) => (tui as { Text: TextConstructor }).Text)
      .catch(() => null);
  }
  return textClassPromise;
}

// Eagerly start resolution so it's ready by the time renderCall is invoked
let resolvedTextClass: TextConstructor | null | undefined;
getTextClass().then((cls) => { resolvedTextClass = cls; });

function createTextComponent(text: string): unknown {
  // Use pre-resolved class if available (synchronous fast path)
  if (resolvedTextClass) {
    return new resolvedTextClass(text, 0, 0);
  }

  // Fallback: minimal component matching Pi's Component.render interface
  return {
    render(_width: number) {
      return text.split("\n");
    },
  };
}

/** Options for testing — allows injecting failure state. */
export interface ExtensionOptions {
  bamlAvailable?: boolean;
  loadError?: string;
  /** Override settings (for testing). When provided, skips disk read. */
  settings?: unknown;
}

/** Minimal Pi extension API subset we depend on. */
interface PiExtensionAPI {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (...args: unknown[]) => Promise<ToolResult>;
    renderCall?: (args: unknown, theme: unknown, context: unknown) => unknown;
    renderResult?: (result: unknown, options: unknown, theme: unknown, context: unknown) => unknown;
  }): void;
  events: {
    emit(event: string, payload: unknown): void;
  };
  on(event: string, handler: (...args: unknown[]) => unknown): void;
}

/** Path to Pi's global settings.json */
const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

/**
 * Read Pi's settings.json from disk.
 * Returns {} on any error (missing file, invalid JSON, permissions).
 */
function readSettingsFromDisk(): unknown {
  try {
    return JSON.parse(readFileSync(GLOBAL_SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * pi-baml extension factory.
 *
 * Called during Pi's extension loading phase.
 * Emits "pi-baml:ready" on EventBus (ADR-004).
 * Registers baml_list, baml_run, baml_exec tools.
 * Captures ModelRegistry on session_start (ADR-007).
 */
export function createPiBamlExtension(
  pi: PiExtensionAPI,
  options?: ExtensionOptions,
): void {
  // Suppress BAML's built-in INFO logging (prints prompts/responses to stdout)
  try {
    // Dynamic import avoids hard failure when @boundaryml/baml isn't available
    import("@boundaryml/baml").then(({ setLogLevel }) => {
      setLogLevel("warn");
    }).catch(() => { /* BAML unavailable */ });
  } catch { /* ignore */ }

  // Determine BAML availability
  const bamlAvailable = options?.bamlAvailable ?? true;
  const loadError = options?.loadError;

  // Read settings from disk (pi.settings does not exist in Pi's extension API)
  const rawSettings = options?.settings !== undefined ? options.settings : readSettingsFromDisk();
  const settings = parseBamlSettings(rawSettings);

  // Create the library (emitted on EventBus)
  const lib: PiBamlLibraryInternal = createPiBamlLibrary({
    available: bamlAvailable,
    ...(loadError !== undefined && { loadError }),
    settings,
  });

  // Discover functions registry (empty for now, populated at session_start from disk)
  const registry = FunctionsRegistry.fromGroups({});
  lib.setRegistry(registry);

  // Emit library on EventBus (factory phase — ADR-004)
  pi.events.emit("pi-baml:ready", lib);

  // Create executor factory for tools
  function toolExecutorFactory(input: {
    files: Record<string, string>;
    clientRef: string;
    apiKey: string;
    defaultModel?: string;
    modelOverride?: string;
  }) {
    if (!bamlAvailable) {
      throw Object.assign(
        new Error(`pi-baml: BAML runtime unavailable: ${loadError ?? "unknown"}`),
        {
          bamlError: {
            error: `pi-baml: BAML runtime unavailable: ${loadError ?? "unknown"}`,
            type: "unavailable" as const,
          } satisfies BamlError,
        },
      );
    }

    return createBamlExecutor({
      files: input.files,
      proxy: settings.proxy,
      apiKey: input.apiKey,
      clientRef: input.clientRef,
      ...(input.defaultModel !== undefined && { defaultModel: input.defaultModel }),
      ...(input.modelOverride !== undefined && { modelOverride: input.modelOverride }),
    });
  }

  /**
   * Extract ToolContext from Pi's execute arguments.
   *
   * Pi calls: execute(toolCallId, params, signal, onUpdate, ctx)
   * Our registerTool passes these through as rest args.
   * ctx is the 5th argument (index 4).
   */
  function extractToolContext(piArgs: unknown[]): ToolContext | undefined {
    // Pi's ToolDefinition.execute signature:
    // execute(toolCallId: string, params, signal, onUpdate, ctx: ExtensionContext)
    // The ctx is the 5th positional argument
    const ctx = piArgs[4] as Record<string, unknown> | undefined;
    if (!ctx) return undefined;

    const model = ctx["model"] as { id: string; provider: string; api: string; baseUrl: string } | undefined;
    const modelRegistry = ctx["modelRegistry"] as ToolContext["modelRegistry"] | undefined;

    return { model, modelRegistry };
  }

  // Register tools
  const listTool = createBamlListTool(registry);
  pi.registerTool({
    name: "baml_list",
    description:
      "List available BAML functions from the registry. Use before baml_run to discover function names and signatures.",
    parameters: {
      type: "object",
      properties: {
        group: {
          type: "string",
          description: "Filter by group name (optional)",
        },
      },
    },
    execute: (...piArgs: unknown[]) => {
      const params = (piArgs[1] ?? piArgs[0] ?? {}) as Record<string, unknown>;
      return listTool.execute(params);
    },
    renderCall(args: unknown, theme: unknown) {
      const t = theme as { fg(c: string, s: string): string; bold(s: string): string };
      const a = (args ?? {}) as Record<string, unknown>;
      return createTextComponent(renderBamlListCall(a, t));
    },
    renderResult(result: unknown, options: unknown, theme: unknown) {
      const t = theme as { fg(c: string, s: string): string; bold(s: string): string };
      const r = result as { content: { type: string; text?: string }[]; details?: unknown };
      const opts = options as { isPartial?: boolean };
      return createTextComponent(renderBamlListResult(r, t, opts.isPartial));
    },
  });

  const runTool = createBamlRunTool(registry, toolExecutorFactory, settings);
  pi.registerTool({
    name: "baml_run",
    description:
      "Execute a pre-defined BAML function by name from the registry. Returns typed structured output.",
    parameters: {
      type: "object",
      properties: {
        function: {
          type: "string",
          description: "Function name (or group/name if ambiguous)",
        },
        args: {
          type: "object",
          description: "Function arguments as key-value pairs",
        },
        model: {
          type: "string",
          description: "Optional model override (e.g. 'anthropic/claude-4.5-sonnet')",
        },
      },
      required: ["function", "args"],
    },
    execute: (...piArgs: unknown[]) => {
      const params = (piArgs[1] ?? piArgs[0] ?? {}) as Record<string, unknown>;
      const ctx = extractToolContext(piArgs);
      return runTool.execute(params, ctx);
    },
    renderCall(args: unknown, theme: unknown) {
      const t = theme as { fg(c: string, s: string): string; bold(s: string): string };
      const a = (args ?? {}) as Record<string, unknown>;
      return createTextComponent(renderBamlRunCall(a, t));
    },
    renderResult(result: unknown, options: unknown, theme: unknown) {
      const t = theme as { fg(c: string, s: string): string; bold(s: string): string };
      const r = result as { content: { type: string; text?: string }[]; details?: unknown };
      const opts = options as { isPartial?: boolean };
      return createTextComponent(renderBamlResult(r, t, opts.isPartial));
    },
  });

  const execTool = createBamlExecTool(settings, toolExecutorFactory);
  pi.registerTool({
    name: "baml_exec",
    description:
      "Compile and execute inline BAML code. Use for dynamic structured extraction/classification. Always use 'client PiClient' in your code.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "BAML source code defining at least one function",
        },
        function: {
          type: "string",
          description: "Function name to call from the provided code",
        },
        args: {
          type: "object",
          description: "Function arguments as key-value pairs",
        },
        provider: {
          type: "string",
          description: "BAML provider name override (e.g. 'openai')",
        },
        model: {
          type: "string",
          description: "Model override (e.g. 'gpt-4o')",
        },
      },
      required: ["code", "function", "args"],
    },
    execute: (...piArgs: unknown[]) => {
      const params = (piArgs[1] ?? piArgs[0] ?? {}) as Record<string, unknown>;
      const ctx = extractToolContext(piArgs);
      return execTool.execute(params, ctx);
    },
    renderCall(args: unknown, theme: unknown) {
      const t = theme as { fg(c: string, s: string): string; bold(s: string): string };
      const a = (args ?? {}) as Record<string, unknown>;
      return createTextComponent(renderBamlExecCall(a, t));
    },
    renderResult(result: unknown, options: unknown, theme: unknown) {
      const t = theme as { fg(c: string, s: string): string; bold(s: string): string };
      const r = result as { content: { type: string; text?: string }[]; details?: unknown };
      const opts = options as { isPartial?: boolean };
      return createTextComponent(renderBamlResult(r, t, opts.isPartial));
    },
  });

  // session_start: capture ModelRegistry, compile registry functions
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    const context = ctx as {
      modelRegistry?: {
        getApiKeyForProvider(name: string): Promise<string>;
      };
    };

    if (context.modelRegistry) {
      lib.setModelRegistry(context.modelRegistry);
    }
  });
}

// Default export for Pi's extension loader
export default createPiBamlExtension;
