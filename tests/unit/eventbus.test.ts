import { describe, it, expect, vi } from "vitest";
import { createPiBamlLibrary } from "../../src/eventbus.js";
import { FunctionsRegistry } from "../../src/lib/registry.js";
import type { BamlSettings } from "../../src/lib/types.js";
import type { ModelRegistry } from "../../src/lib/bridge.js";

// Mock BAML runtime
vi.mock("@boundaryml/baml", () => ({
  BamlRuntime: {
    fromFiles: vi.fn().mockReturnValue({
      createContextManager: vi.fn().mockReturnValue({}),
      callFunction: vi.fn().mockResolvedValue({
        isOk: () => true,
        parsed: () => ({ answer: "42" }),
      }),
    }),
  },
  ClientRegistry: vi.fn().mockImplementation(() => ({
    addLlmClient: vi.fn(),
    setPrimary: vi.fn(),
  })),
  Collector: vi.fn().mockImplementation(() => ({ last: null })),
}));

const settings: BamlSettings = {
  models: {
    light: "github-copilot/claude-haiku-4.5",
    standard: "github-copilot/claude-sonnet-4.6",
    heavy: "github-copilot/claude-opus-4.7",
  },
};

function createMockModelRegistry(): ModelRegistry {
  return {
    find: vi.fn().mockReturnValue({
      id: "claude-sonnet-4.6",
      api: "anthropic-messages",
      baseUrl: "https://api.individual.githubcopilot.com",
      headers: {},
    }),
    getApiKeyAndHeaders: vi.fn().mockResolvedValue({
      ok: true as const,
      apiKey: "test-key",
      headers: {},
    }),
  };
}

describe("createPiBamlLibrary", () => {
  it("returns available=true when BAML is available", () => {
    const lib = createPiBamlLibrary({ available: true, settings });
    expect(lib.available).toBe(true);
  });

  it("returns available=false when BAML is unavailable", () => {
    const lib = createPiBamlLibrary({ available: false, loadError: "native binary missing", settings });
    expect(lib.available).toBe(false);
  });

  it("throws on method call when unavailable", async () => {
    const lib = createPiBamlLibrary({ available: false, loadError: "test", settings });
    await expect(lib.execBaml("code", "fn", {})).rejects.toThrow("unavailable");
  });

  it("throws before session_start (no modelRegistry)", async () => {
    const lib = createPiBamlLibrary({ available: true, settings });
    await expect(lib.execBaml("code", "fn", {})).rejects.toThrow("not initialized");
  });

  it("works after setModelRegistry is called", async () => {
    const lib = createPiBamlLibrary({ available: true, settings });
    lib.setModelRegistry(createMockModelRegistry());

    // execBaml should attempt to compile (and may fail on BAML compilation,
    // but it should NOT throw "not initialized")
    try {
      await lib.execBaml("invalid baml", "fn", {});
    } catch (err) {
      expect((err as Error).message).not.toContain("not initialized");
    }
  });

  it("list returns empty when no functions registered", () => {
    const lib = createPiBamlLibrary({ available: true, settings });
    expect(lib.list()).toEqual([]);
  });

  it("setRegistry updates the functions registry", () => {
    const lib = createPiBamlLibrary({ available: true, settings });
    const reg = FunctionsRegistry.fromGroups({
      "test": { "main.baml": "function Foo(x: string) -> string { client PiClient\n  prompt #\"{{ x }}\"# }" },
    });
    lib.setRegistry(reg);
    const list = lib.list();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("Foo");
  });
});
