import type { BamlError, BamlExecutor, BamlSettings } from "../lib/types.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

/** Factory type for creating executors from dynamic code. */
export type ExecExecutorFactory = (input: {
  files: Record<string, string>;
  clientRef: string;
  apiKey: string;
  defaultModel?: string;
  modelOverride?: string;
}) => BamlExecutor;

/**
 * Create the baml_exec tool.
 *
 * Compiles inline BAML code, creates a PiClient-mode executor,
 * and executes the specified function.
 */
export function createBamlExecTool(
  settings: BamlSettings,
  executorFactory: ExecExecutorFactory,
): ToolDefinition {
  return {
    async execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> {
      const code = args["code"] as string;
      const functionName = args["function"] as string;
      const functionArgs = (args["args"] as Record<string, unknown>) ?? {};
      const provider =
        typeof args["provider"] === "string" ? args["provider"] : undefined;
      const model =
        typeof args["model"] === "string" ? args["model"] : undefined;

      // Resolve effective model: explicit param > settings.defaultModel > session model
      const effectiveDefaultModel = settings.defaultModel ?? deriveModelFromContext(ctx);

      // Validate we have a model to use
      if (!effectiveDefaultModel && !model) {
        const error: BamlError = {
          error:
            "No model available. Pass model param, set baml.defaultModel in settings, or ensure a session model is active.",
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

      // Build model override if provider/model specified
      const modelOverride =
        provider && model
          ? `${provider}/${model}`
          : model
            ? `${parseProvider(effectiveDefaultModel)}/${model}`
            : provider
              ? `${provider}/${parseModel(effectiveDefaultModel)}`
              : undefined;

      try {
        const executor = executorFactory({
          files: { "dynamic.baml": code },
          clientRef: "PiClient",
          apiKey,
          ...(effectiveDefaultModel !== undefined && { defaultModel: effectiveDefaultModel }),
          ...(modelOverride !== undefined && { modelOverride }),
        });

        const callResult = await executor.call(functionName, functionArgs);

        // Dispose dynamic executors after use
        executor.dispose();

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
 * Derive a "provider/model" string from the current session model context.
 * Returns undefined if no model is available in context.
 */
function deriveModelFromContext(ctx?: ToolContext): string | undefined {
  if (!ctx?.model) return undefined;
  // Use the model's provider and id to form "provider/model-id"
  return `${ctx.model.provider}/${ctx.model.id}`;
}

/**
 * Resolve API key from the tool context's modelRegistry.
 *
 * Looks up the Pi provider configured in baml.proxy for the effective
 * BAML provider. Returns undefined if no registry or key is available.
 */
async function resolveApiKey(
  settings: BamlSettings,
  ctx?: ToolContext,
): Promise<string | undefined> {
  if (!ctx?.modelRegistry) return undefined;

  // Find the first proxy entry to determine which Pi provider to query
  const proxyEntries = Object.values(settings.proxy);
  if (proxyEntries.length === 0) return undefined;

  // Use the first proxy entry's provider for key resolution
  const piProvider = proxyEntries[0]!.provider;

  try {
    const result = await ctx.modelRegistry.getApiKeyForProvider(piProvider);
    return result ?? undefined;
  } catch {
    return undefined;
  }
}

function parseProvider(defaultModel: string | undefined): string {
  if (!defaultModel) return "unknown";
  const slash = defaultModel.indexOf("/");
  return slash === -1 ? defaultModel : defaultModel.slice(0, slash);
}

function parseModel(defaultModel: string | undefined): string {
  if (!defaultModel) return "unknown";
  const slash = defaultModel.indexOf("/");
  return slash === -1 ? defaultModel : defaultModel.slice(slash + 1);
}
