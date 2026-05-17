import { describe, it, expect, vi } from "vitest";
import { createBamlRunTool } from "../../src/tools/baml-run.js";
import { FunctionsRegistry } from "../../src/lib/registry.js";
import type { BamlExecutor, BamlSettings } from "../../src/lib/types.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";

/** Extract text content from a ToolResult for assertions. */
function textOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join("");
}

/** Create a mock ToolContext with modelRegistry that resolves an API key. */
function createMockContext(apiKey = "test-api-key"): ToolContext {
  return {
    model: {
      id: "claude-4.5-haiku",
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: "http://localhost:6655/anthropic",
    },
    modelRegistry: {
      getApiKeyForProvider: vi.fn().mockResolvedValue(apiKey),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ apiKey, headers: {} }),
    },
  };
}

describe("baml_run tool", () => {
  const settings: BamlSettings = {
    proxy: {
      anthropic: {
        provider: "hai-proxy",
        base_url: "http://localhost:6655/anthropic",
      },
    },
    defaultModel: "anthropic/claude-4.5-haiku",
  };

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
    const tool = createBamlRunTool(registry, factory, settings);
    const ctx = createMockContext();

    const result = await tool.execute({
      function: "ExtractItems",
      args: { text: "meeting notes here" },
    }, ctx);

    const parsed = JSON.parse(textOf(result));
    expect(parsed).toEqual(items);
    expect(factory).toHaveBeenCalled();
  });

  it("passes model override to executor factory", async () => {
    const factory = createMockExecutorFactory([]);
    const tool = createBamlRunTool(registry, factory, settings);
    const ctx = createMockContext();

    await tool.execute({
      function: "ExtractItems",
      args: { text: "hi" },
      model: "anthropic/claude-4.5-sonnet",
    }, ctx);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: "anthropic/claude-4.5-sonnet",
        apiKey: "test-api-key",
      }),
    );
  });

  it("returns actionable error for unknown function", async () => {
    const factory = createMockExecutorFactory(null);
    const tool = createBamlRunTool(registry, factory, settings);

    const result = await tool.execute({
      function: "NonExistent",
      args: {},
    });

    const parsed = JSON.parse(textOf(result));
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
    const tool = createBamlRunTool(registry, factory, settings);
    const ctx = createMockContext();

    const result = await tool.execute({
      function: "ExtractItems",
      args: { text: "bad input" },
    }, ctx);

    const parsed = JSON.parse(textOf(result));
    expect(parsed.type).toBe("execution");
    expect(parsed.rawOutput).toBe("I cannot parse this...");
  });

  it("returns clear error when no modelRegistry available", async () => {
    const factory = createMockExecutorFactory(null);
    const tool = createBamlRunTool(registry, factory, settings);

    const result = await tool.execute({
      function: "ExtractItems",
      args: { text: "test" },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.type).toBe("configuration");
    expect(parsed.error).toContain("No API key available");
  });
});
