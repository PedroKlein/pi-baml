import type { BamlError, BamlExecutor, BamlSettings } from "../lib/types.js";

/** Factory type for creating executors from dynamic code. */
export type ExecExecutorFactory = (input: {
  files: Record<string, string>;
  clientRef: string;
  defaultModel?: string;
  modelOverride?: string;
}) => BamlExecutor;

/** Tool definition shape. */
export interface ToolDefinition {
  execute(args: Record<string, unknown>): Promise<string>;
}

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
    async execute(args: Record<string, unknown>): Promise<string> {
      const code = args["code"] as string;
      const functionName = args["function"] as string;
      const functionArgs = (args["args"] as Record<string, unknown>) ?? {};
      const provider =
        typeof args["provider"] === "string" ? args["provider"] : undefined;
      const model =
        typeof args["model"] === "string" ? args["model"] : undefined;

      // Validate we have a model to use
      if (!settings.defaultModel && !model) {
        const error: BamlError = {
          error:
            "No default model configured. Pass model param or set baml.defaultModel in settings.",
          type: "configuration",
        };
        return JSON.stringify(error);
      }

      // Build model override if provider/model specified
      const modelOverride =
        provider && model
          ? `${provider}/${model}`
          : model
            ? `${parseProvider(settings.defaultModel)}/${model}`
            : provider
              ? `${provider}/${parseModel(settings.defaultModel)}`
              : undefined;

      try {
        const executor = executorFactory({
          files: { "dynamic.baml": code },
          clientRef: "PiClient",
          ...(settings.defaultModel !== undefined && { defaultModel: settings.defaultModel }),
          ...(modelOverride !== undefined && { modelOverride }),
        });

        const result = await executor.call(functionName, functionArgs);

        // Dispose dynamic executors after use
        executor.dispose();

        return JSON.stringify(result);
      } catch (err) {
        if (err instanceof Error && "bamlError" in err) {
          return JSON.stringify(
            (err as Error & { bamlError: BamlError }).bamlError,
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        const error: BamlError = {
          error: message,
          type: "execution",
        };
        return JSON.stringify(error);
      }
    },
  };
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
