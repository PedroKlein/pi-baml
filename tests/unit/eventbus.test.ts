import { describe, it, expect, vi } from "vitest";
import { createPiBamlLibrary } from "../../src/eventbus.js";
import type { BamlSettings } from "../../src/lib/types.js";

// Mock executor creation
vi.mock("@boundaryml/baml", () => ({
  BamlRuntime: {
    fromFiles: vi.fn().mockReturnValue({
      callFunction: vi.fn().mockResolvedValue({
        isOk: () => true,
        parsed: () => ({ result: "test" }),
      }),
      createContextManager: vi.fn().mockReturnValue({}),
    }),
  },
  ClientRegistry: vi.fn().mockImplementation(() => ({
    addLlmClient: vi.fn(),
    setPrimary: vi.fn(),
  })),
  Collector: vi.fn().mockImplementation(() => ({
    last: null,
    logs: [],
  })),
}));

describe("createPiBamlLibrary", () => {
  const settings: BamlSettings = {
    proxy: {
      anthropic: {
        provider: "hai-proxy",
        base_url: "http://localhost:6655/anthropic",
      },
    },
    defaultModel: "anthropic/claude-4.5-haiku",
    extensions: {
      "pi-memory": { provider: "anthropic", model: "claude-4.5-haiku" },
    },
  };

  describe("available=true (happy path)", () => {
    it("has available=true when BAML runtime loads", () => {
      const lib = createPiBamlLibrary({ available: true, settings });
      expect(lib.available).toBe(true);
    });

    it("has all library methods defined", () => {
      const lib = createPiBamlLibrary({ available: true, settings });
      expect(typeof lib.createExecutor).toBe("function");
      expect(typeof lib.createExecutorFromDir).toBe("function");
      expect(typeof lib.execBaml).toBe("function");
      expect(typeof lib.call).toBe("function");
      expect(typeof lib.list).toBe("function");
      expect(typeof lib.forExtension).toBe("function");
    });
  });

  describe("available=false (soft-fail)", () => {
    it("has available=false", () => {
      const lib = createPiBamlLibrary({
        available: false,
        loadError: "NAPI binary not found",
        settings,
      });
      expect(lib.available).toBe(false);
    });

    it("every method throws with runtime unavailable message", async () => {
      const lib = createPiBamlLibrary({
        available: false,
        loadError: "NAPI binary not found",
        settings,
      });

      await expect(lib.createExecutor({})).rejects.toThrow(
        /BAML runtime unavailable.*NAPI binary not found/,
      );
      await expect(lib.createExecutorFromDir("/tmp")).rejects.toThrow(
        /BAML runtime unavailable/,
      );
      await expect(lib.execBaml("code", "fn", {})).rejects.toThrow(
        /BAML runtime unavailable/,
      );
      await expect(lib.call("fn", {})).rejects.toThrow(
        /BAML runtime unavailable/,
      );
      expect(() => lib.list()).toThrow(/BAML runtime unavailable/);
    });
  });

  describe("lazy ModelRegistry", () => {
    it("throws before setModelRegistry is called", async () => {
      const lib = createPiBamlLibrary({ available: true, settings });

      await expect(
        lib.createExecutor({ "main.baml": "content" }),
      ).rejects.toThrow(/not initialized.*session_start/);
    });

    it("works after setModelRegistry is called", async () => {
      const lib = createPiBamlLibrary({ available: true, settings });

      const mockRegistry = {
        getApiKeyForProvider: vi.fn().mockResolvedValue("test-api-key"),
      };

      lib.setModelRegistry(mockRegistry);

      // Should not throw "not initialized" anymore
      const executor = await lib.createExecutor({
        "main.baml": `function Test(x: string) -> string { client "anthropic/claude-4.5-haiku" prompt #""# }`,
      });
      expect(executor).toBeDefined();
    });
  });

  describe("forExtension", () => {
    it("returns pre-configured factory for known extension", () => {
      const lib = createPiBamlLibrary({ available: true, settings });
      const api = lib.forExtension("pi-memory");

      expect(typeof api.createExecutor).toBe("function");
      expect(typeof api.createExecutorFromDir).toBe("function");
    });

    it("returns default config for unknown extension", () => {
      const lib = createPiBamlLibrary({ available: true, settings });
      const api = lib.forExtension("unknown-ext");

      expect(typeof api.createExecutor).toBe("function");
    });
  });
});
