import { parseBamlSettings } from "./lib/config.js";
import { FunctionsRegistry } from "./lib/registry.js";
import { createPiBamlLibrary, type PiBamlLibraryInternal } from "./eventbus.js";
import { createBamlListTool } from "./tools/baml-list.js";
import { createBamlRunTool } from "./tools/baml-run.js";
import { createBamlExecTool } from "./tools/baml-exec.js";
import { createBamlExecutor } from "./lib/executor.js";
import type { BamlError } from "./lib/types.js";

/** Options for testing — allows injecting failure state. */
export interface ExtensionOptions {
  bamlAvailable?: boolean;
  loadError?: string;
}

/** Minimal Pi extension API subset we depend on. */
interface PiExtensionAPI {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }): void;
  events: {
    emit(event: string, payload: unknown): void;
  };
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  settings?: unknown;
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
  // Determine BAML availability
  const bamlAvailable = options?.bamlAvailable ?? true;
  const loadError = options?.loadError;

  // Read settings
  const settings = parseBamlSettings(pi.settings ?? {});

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
      apiKey: "__placeholder__", // Resolved at call time in real usage
      clientRef: input.clientRef,
      ...(input.defaultModel !== undefined && { defaultModel: input.defaultModel }),
      ...(input.modelOverride !== undefined && { modelOverride: input.modelOverride }),
    });
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
    execute: listTool.execute,
  });

  const runTool = createBamlRunTool(registry, toolExecutorFactory);
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
    execute: runTool.execute,
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
    execute: execTool.execute,
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
