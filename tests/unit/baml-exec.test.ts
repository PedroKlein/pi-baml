import { describe, it, expect, vi } from "vitest";
import { createBamlExecTool } from "../../src/tools/baml-exec.js";
import type { BamlExecutor, BamlSettings } from "../../src/lib/types.js";

describe("baml_exec tool", () => {
  const settings: BamlSettings = {
    proxy: {
      anthropic: {
        provider: "hai-proxy",
        base_url: "http://localhost:6655/anthropic",
      },
    },
    defaultModel: "anthropic/claude-4.5-haiku",
  };

  const validCode = `
function Classify(text: string) -> "positive" | "negative" {
  client PiClient
  prompt #"Classify: {{ text }}"#
}`;

  function createMockExecutorFactory(result: unknown) {
    const mockExecutor: BamlExecutor = {
      call: vi.fn().mockResolvedValue(result),
      dispose: vi.fn(),
    };
    return vi.fn().mockReturnValue(mockExecutor);
  }

  it("compiles and executes valid BAML code", async () => {
    const factory = createMockExecutorFactory("positive");
    const tool = createBamlExecTool(settings, factory);

    const result = await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "I love it" },
    });

    const parsed = JSON.parse(result);
    expect(parsed).toBe("positive");
  });

  it("returns compilation diagnostics on invalid syntax", async () => {
    const factory = vi.fn().mockImplementation(() => {
      throw Object.assign(new Error("BAML compilation failed: Expected '->'"), {
        bamlError: {
          error: "BAML compilation failed: Expected '->'",
          type: "compilation",
          diagnostics: ["Expected '->' but found '{'"],
        },
      });
    });
    const tool = createBamlExecTool(settings, factory);

    const result = await tool.execute({
      code: "invalid { syntax",
      function: "Classify",
      args: {},
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("compilation");
    expect(parsed.diagnostics).toBeDefined();
  });

  it("resolves PiClient from defaultModel setting", async () => {
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settings, factory);

    await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
    });

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRef: "PiClient",
        defaultModel: "anthropic/claude-4.5-haiku",
      }),
    );
  });

  it("applies provider and model overrides", async () => {
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settings, factory);

    await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
      provider: "openai",
      model: "gpt-4o",
    });

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRef: "PiClient",
        modelOverride: "openai/gpt-4o",
      }),
    );
  });

  it("returns clear error when no defaultModel and no model param", async () => {
    const settingsNoDefault: BamlSettings = {
      proxy: { anthropic: { provider: "hai-proxy" } },
    };
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settingsNoDefault, factory);

    const result = await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("configuration");
    expect(parsed.error).toContain("No default model configured");
  });
});
