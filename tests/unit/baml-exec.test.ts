import { describe, it, expect, vi } from "vitest";
import { createBamlExecTool } from "../../src/tools/baml-exec.js";
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
      call: vi.fn().mockResolvedValue({
        parsed: result,
        metadata: {
          inputTokens: 80,
          outputTokens: 10,
          cachedInputTokens: null,
          durationMs: 950,
          model: "PiClient",
        },
      }),
      dispose: vi.fn(),
    };
    return vi.fn().mockReturnValue(mockExecutor);
  }

  it("compiles and executes valid BAML code", async () => {
    const factory = createMockExecutorFactory("positive");
    const tool = createBamlExecTool(settings, factory);
    const ctx = createMockContext();

    const result = await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "I love it" },
    }, ctx);

    const parsed = JSON.parse(textOf(result));
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
    const ctx = createMockContext();

    const result = await tool.execute({
      code: "invalid { syntax",
      function: "Classify",
      args: {},
    }, ctx);

    const parsed = JSON.parse(textOf(result));
    expect(parsed.type).toBe("compilation");
    expect(parsed.diagnostics).toBeDefined();
  });

  it("resolves PiClient from defaultModel setting", async () => {
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settings, factory);
    const ctx = createMockContext();

    await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
    }, ctx);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRef: "PiClient",
        apiKey: "test-api-key",
        defaultModel: "anthropic/claude-4.5-haiku",
      }),
    );
  });

  it("applies provider and model overrides", async () => {
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settings, factory);
    const ctx = createMockContext();

    await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
      provider: "openai",
      model: "gpt-4o",
    }, ctx);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRef: "PiClient",
        apiKey: "test-api-key",
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

    const parsed = JSON.parse(textOf(result));
    expect(parsed.type).toBe("configuration");
    expect(parsed.error).toContain("No model available");
  });

  it("falls back to session model when no defaultModel configured", async () => {
    const settingsNoDefault: BamlSettings = {
      proxy: { anthropic: { provider: "hai-proxy" } },
    };
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settingsNoDefault, factory);

    const ctx: ToolContext = {
      model: {
        id: "claude-4.5-sonnet",
        provider: "anthropic",
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
      },
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue("session-key"),
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ apiKey: "session-key", headers: {} }),
      },
    };

    await tool.execute(
      { code: validCode, function: "Classify", args: { text: "test" } },
      ctx,
    );

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRef: "PiClient",
        apiKey: "session-key",
        defaultModel: "anthropic/claude-4.5-sonnet",
      }),
    );
  });

  it("returns clear error when no modelRegistry available", async () => {
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settings, factory);

    // No ctx provided — simulates pre-session_start state
    const result = await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.type).toBe("configuration");
    expect(parsed.error).toContain("No API key available");
  });

  it("returns clear error when modelRegistry returns no key", async () => {
    const factory = createMockExecutorFactory("result");
    const tool = createBamlExecTool(settings, factory);

    const ctx: ToolContext = {
      model: undefined,
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue(undefined),
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ apiKey: "", headers: {} }),
      },
    };

    const result = await tool.execute({
      code: validCode,
      function: "Classify",
      args: { text: "test" },
    }, ctx);

    const parsed = JSON.parse(textOf(result));
    expect(parsed.type).toBe("configuration");
    expect(parsed.error).toContain("No API key available");
  });
});
