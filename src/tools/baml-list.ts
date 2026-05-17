import type { FunctionsRegistry } from "../lib/registry.js";

/** Tool definition shape (subset of Pi's tool interface). */
export interface ToolDefinition {
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * Create the baml_list tool.
 *
 * Returns a formatted list of discovered BAML functions.
 * Agent uses this to discover what's available before calling baml_run.
 */
export function createBamlListTool(registry: FunctionsRegistry): ToolDefinition {
  return {
    async execute(args: Record<string, unknown>): Promise<string> {
      const group =
        typeof args["group"] === "string" ? args["group"] : undefined;

      if (registry.isEmpty) {
        return JSON.stringify({
          message:
            "No BAML functions found. Place .baml files in subdirectories of: " +
            "<project>/.pi/baml/, ~/.pi/baml/, or ~/.agents/baml/",
        });
      }

      const functions = registry.list(group);
      return JSON.stringify(functions);
    },
  };
}
