import type { FunctionsRegistry } from "../lib/registry.js";
import type { BamlError, BamlExecutor, BamlSettings, FunctionEntry } from "../lib/types.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

/** Factory type for creating executors (injected dependency). */
export type ExecutorFactory = (input: {
  files: Record<string, string>;
  clientRef: string;
  apiKey: string;
  modelOverride?: string;
}) => BamlExecutor;

/**
 * Create the baml_run tool.
 *
 * Resolves a function from the registry by name, creates an executor,
 * and calls the function with the provided arguments.
 */
export function createBamlRunTool(
  registry: FunctionsRegistry,
  executorFactory: ExecutorFactory,
  settings: BamlSettings,
): ToolDefinition {
  return {
    async execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> {
      const functionName = args["function"] as string;
      const functionArgs = (args["args"] as Record<string, unknown>) ?? {};
      const model =
        typeof args["model"] === "string" ? args["model"] : undefined;

      // Resolve function from registry
      let entry: FunctionEntry;
      try {
        entry = registry.resolve(functionName);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const error: BamlError = {
          error: message,
          type: "configuration",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(error) }],
          details: undefined,
        };
      }

      // Resolve API key from context
      const apiKey = await resolveApiKey(settings, ctx);
      if (!apiKey) {
        const error: BamlError = {
          error:
            "No API key available. Ensure modelRegistry is accessible (session must be started) and proxy provider is configured.",
          type: "configuration",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(error) }],
          details: undefined,
        };
      }

      // Create executor and call function
      try {
        const executor = executorFactory({
          files: entry.files,
          clientRef: settings.defaultModel ?? "PiClient",
          apiKey,
          ...(model !== undefined && { modelOverride: model }),
        });

        const callResult = await executor.call(entry.name, functionArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(callResult.parsed) }],
          details: { metadata: callResult.metadata },
        };
      } catch (err) {
        if (err instanceof Error && "bamlError" in err) {
          const bamlError = (err as Error & { bamlError: BamlError }).bamlError;
          return {
            content: [{ type: "text", text: JSON.stringify(bamlError) }],
            details: undefined,
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        const error: BamlError = {
          error: message,
          type: "execution",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(error) }],
          details: undefined,
        };
      }
    },
  };
}

/**
 * Resolve API key from the tool context's modelRegistry.
 */
async function resolveApiKey(
  settings: BamlSettings,
  ctx?: ToolContext,
): Promise<string | undefined> {
  if (!ctx?.modelRegistry) return undefined;

  const proxyEntries = Object.values(settings.proxy);
  if (proxyEntries.length === 0) return undefined;

  const piProvider = proxyEntries[0]!.provider;

  try {
    const result = await ctx.modelRegistry.getApiKeyForProvider(piProvider);
    return result ?? undefined;
  } catch {
    return undefined;
  }
}
