import type { FunctionsRegistry } from "../lib/registry.js";
import type { BamlError, BamlExecutor, FunctionEntry } from "../lib/types.js";

/** Factory type for creating executors (injected dependency). */
export type ExecutorFactory = (input: {
  files: Record<string, string>;
  clientRef: string;
  modelOverride?: string;
}) => BamlExecutor;

/** Tool definition shape. */
export interface ToolDefinition {
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * Create the baml_run tool.
 *
 * Resolves a function from the registry by name, creates an executor,
 * and calls the function with the provided arguments.
 */
export function createBamlRunTool(
  registry: FunctionsRegistry,
  executorFactory: ExecutorFactory,
): ToolDefinition {
  return {
    async execute(args: Record<string, unknown>): Promise<string> {
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
        return JSON.stringify(error);
      }

      // Create executor and call function
      try {
        const executor = executorFactory({
          files: entry.files,
          clientRef: `${entry.group}/default`,
          ...(model !== undefined && { modelOverride: model }),
        });

        const result = await executor.call(entry.name, functionArgs);
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
