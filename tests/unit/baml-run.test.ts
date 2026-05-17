import { describe, it, expect, vi } from "vitest";
import { createBamlRunTool } from "../../src/tools/baml-run.js";
import { FunctionsRegistry } from "../../src/lib/registry.js";
import type { BamlExecutor } from "../../src/lib/types.js";

describe("baml_run tool", () => {
  const registry = FunctionsRegistry.fromGroups({
    extraction: {
      "main.baml": `function ExtractItems(text: string) -> Item[] {
        client "anthropic/claude-4.5-haiku"
        prompt #"..."#
      }`,
    },
  });

  function createMockExecutorFactory(result: unknown) {
    const mockExecutor: BamlExecutor = {
      call: vi.fn().mockResolvedValue(result),
      dispose: vi.fn(),
    };
    return vi.fn().mockReturnValue(mockExecutor);
  }

  it("resolves and executes function by name", async () => {
    const items = [{ description: "task 1", priority: "high" }];
    const factory = createMockExecutorFactory(items);
    const tool = createBamlRunTool(registry, factory);

    const result = await tool.execute({
      function: "ExtractItems",
      args: { text: "meeting notes here" },
    });

    const parsed = JSON.parse(result);
    expect(parsed).toEqual(items);
    expect(factory).toHaveBeenCalled();
  });

  it("passes model override to executor factory", async () => {
    const factory = createMockExecutorFactory([]);
    const tool = createBamlRunTool(registry, factory);

    await tool.execute({
      function: "ExtractItems",
      args: { text: "hi" },
      model: "anthropic/claude-4.5-sonnet",
    });

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: "anthropic/claude-4.5-sonnet",
      }),
    );
  });

  it("returns actionable error for unknown function", async () => {
    const factory = createMockExecutorFactory(null);
    const tool = createBamlRunTool(registry, factory);

    const result = await tool.execute({
      function: "NonExistent",
      args: {},
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("not found");
    expect(parsed.type).toBe("configuration");
  });

  it("returns structured BamlError on execution failure", async () => {
    const mockExecutor: BamlExecutor = {
      call: vi.fn().mockRejectedValue(
        Object.assign(new Error("BAML execution failed"), {
          bamlError: {
            error: "BAML execution failed",
            type: "execution",
            rawOutput: "I cannot parse this...",
          },
        }),
      ),
      dispose: vi.fn(),
    };
    const factory = vi.fn().mockReturnValue(mockExecutor);
    const tool = createBamlRunTool(registry, factory);

    const result = await tool.execute({
      function: "ExtractItems",
      args: { text: "bad input" },
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("execution");
    expect(parsed.rawOutput).toBe("I cannot parse this...");
  });
});
