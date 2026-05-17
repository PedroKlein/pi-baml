import type { FunctionsRegistry } from "../lib/registry.js";
import type { ToolDefinition, ToolResult } from "./types.js";

/**
 * Create the baml_list tool.
 *
 * Returns a formatted list of discovered BAML functions.
 * Agent uses this to discover what's available before calling baml_run.
 */
export function createBamlListTool(registry: FunctionsRegistry): ToolDefinition {
  return {
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const group =
        typeof args["group"] === "string" ? args["group"] : undefined;

      if (registry.isEmpty) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message:
                "No BAML functions found. Place .baml files in subdirectories of: " +
                "<project>/.pi/baml/, ~/.pi/baml/, or ~/.agents/baml/",
            }),
          }],
          details: undefined,
        };
      }

      const functions = registry.list(group);
      return {
        content: [{ type: "text", text: JSON.stringify(functions) }],
        details: undefined,
      };
    },
  };
}
