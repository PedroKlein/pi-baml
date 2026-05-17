import { describe, it, expect } from "vitest";
import { createBamlListTool } from "../../src/tools/baml-list.js";
import { FunctionsRegistry } from "../../src/lib/registry.js";
import type { ToolResult } from "../../src/tools/types.js";

/** Extract text content from a ToolResult for assertions. */
function textOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join("");
}

describe("baml_list tool", () => {
  it("returns all functions formatted for agent", async () => {
    const registry = FunctionsRegistry.fromGroups({
      extraction: {
        "main.baml": `function ExtractItems(text: string) -> Item[] {
          client PiClient
          prompt #"..."#
        }`,
      },
      classification: {
        "main.baml": `function ClassifyIntent(text: string) -> Intent {
          client PiClient
          prompt #"..."#
        }`,
      },
    });

    const tool = createBamlListTool(registry);
    const result = await tool.execute({});

    const parsed = JSON.parse(textOf(result));
    expect(parsed).toHaveLength(2);
    expect(parsed.map((f: { name: string }) => f.name).sort()).toEqual([
      "ClassifyIntent",
      "ExtractItems",
    ]);
    expect(parsed[0]).toHaveProperty("group");
    expect(parsed[0]).toHaveProperty("qualifiedName");
    expect(parsed[0]).toHaveProperty("inputTypes");
    expect(parsed[0]).toHaveProperty("outputType");
  });

  it("filters by group parameter", async () => {
    const registry = FunctionsRegistry.fromGroups({
      extraction: {
        "main.baml": `function ExtractItems(text: string) -> Item[] {
          client PiClient
          prompt #"..."#
        }`,
      },
      classification: {
        "main.baml": `function ClassifyIntent(text: string) -> Intent {
          client PiClient
          prompt #"..."#
        }`,
      },
    });

    const tool = createBamlListTool(registry);
    const result = await tool.execute({ group: "extraction" });

    const parsed = JSON.parse(textOf(result));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("ExtractItems");
  });

  it("returns helpful message when registry is empty", async () => {
    const registry = FunctionsRegistry.fromGroups({});

    const tool = createBamlListTool(registry);
    const result = await tool.execute({});
    const text = textOf(result);

    expect(text).toContain("No BAML functions found");
    expect(text).toContain(".pi/baml/");
  });
});
