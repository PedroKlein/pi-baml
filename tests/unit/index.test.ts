import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPiBamlExtension } from "../../src/index.js";

// Mock @boundaryml/baml
vi.mock("@boundaryml/baml", () => ({
  BamlRuntime: {
    fromFiles: vi.fn().mockReturnValue({
      callFunction: vi.fn().mockResolvedValue({
        isOk: () => true,
        parsed: () => "result",
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

function createMockPi() {
  const tools: Array<{ name: string }> = [];
  const eventListeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const emitted: Array<{ event: string; payload: unknown }> = [];

  return {
    registerTool: vi.fn((tool: { name: string }) => {
      tools.push(tool);
    }),
    events: {
      emit: vi.fn((event: string, payload: unknown) => {
        emitted.push({ event, payload });
      }),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!eventListeners[event]) {
          eventListeners[event] = [];
        }
        eventListeners[event]!.push(handler);
      }),
    },
    on: vi.fn(),
    // Test helpers
    _tools: tools,
    _emitted: emitted,
    _eventListeners: eventListeners,
  };
}

/** Settings override for tests — avoids reading from disk. */
const testSettings = {
  baml: {
    proxy: {
      anthropic: {
        provider: "hai-proxy",
        base_url: "http://localhost:6655/anthropic",
      },
    },
    defaultModel: "anthropic/claude-4.5-haiku",
  },
};

describe("pi-baml extension factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all three tools", () => {
    const pi = createMockPi();
    createPiBamlExtension(pi, { settings: testSettings });

    expect(pi.registerTool).toHaveBeenCalledTimes(3);
    const names = pi._tools.map((t) => t.name).sort();
    expect(names).toEqual(["baml_exec", "baml_list", "baml_run"]);
  });

  it("emits pi-baml:ready on EventBus during factory", () => {
    const pi = createMockPi();
    createPiBamlExtension(pi, { settings: testSettings });

    expect(pi.events.emit).toHaveBeenCalledWith(
      "pi-baml:ready",
      expect.objectContaining({ available: true }),
    );
  });

  it("emits library with all expected methods", () => {
    const pi = createMockPi();
    createPiBamlExtension(pi, { settings: testSettings });

    const emitCall = pi.events.emit.mock.calls[0];
    const lib = emitCall?.[1] as Record<string, unknown>;

    expect(lib["available"]).toBe(true);
    expect(typeof lib["createExecutor"]).toBe("function");
    expect(typeof lib["createExecutorFromDir"]).toBe("function");
    expect(typeof lib["execBaml"]).toBe("function");
    expect(typeof lib["call"]).toBe("function");
    expect(typeof lib["list"]).toBe("function");
    expect(typeof lib["forExtension"]).toBe("function");
  });

  it("registers session_start handler", () => {
    const pi = createMockPi();
    createPiBamlExtension(pi, { settings: testSettings });

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("session_start captures ModelRegistry", async () => {
    const pi = createMockPi();
    createPiBamlExtension(pi, { settings: testSettings });

    // Get the library from the emit
    const lib = pi.events.emit.mock.calls[0]?.[1] as {
      available: boolean;
      createExecutor: (files: Record<string, string>) => Promise<unknown>;
    };

    // Before session_start, should throw
    await expect(lib.createExecutor({ "x.baml": "code" })).rejects.toThrow(
      /not initialized/,
    );

    // Simulate session_start
    const sessionHandler = pi.on.mock.calls.find(
      (c) => c[0] === "session_start",
    )?.[1] as (event: unknown, ctx: unknown) => Promise<void>;

    const mockCtx = {
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue("test-key"),
      },
    };
    await sessionHandler({}, mockCtx);

    // After session_start, should work (or at least not throw "not initialized")
    // It may throw other errors since we're mocking, but not "not initialized"
    try {
      await lib.createExecutor({
        "main.baml": `function T(x: string) -> string { client "anthropic/c" prompt #""# }`,
      });
    } catch (err) {
      expect((err as Error).message).not.toContain("not initialized");
    }
  });
});

describe("pi-baml soft-fail", () => {
  it("emits available=false when BAML import fails", () => {
    // We can't easily simulate import failure with vi.mock already active,
    // so we test the factory's error handling path directly
    const pi = createMockPi();

    // Call with bamlAvailable=false to test soft-fail path
    createPiBamlExtension(pi, { bamlAvailable: false, loadError: "NAPI not found", settings: testSettings });

    expect(pi.events.emit).toHaveBeenCalledWith(
      "pi-baml:ready",
      expect.objectContaining({ available: false }),
    );

    // Tools should still be registered
    expect(pi.registerTool).toHaveBeenCalledTimes(3);
  });
});
