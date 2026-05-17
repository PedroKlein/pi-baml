import { describe, it, expect } from "vitest";
import {
  mapBamlProviderToPiApi,
  parseClientRef,
  createClientRegistryConfig,
} from "../../src/lib/bridge.js";
import type { ProxyConfig } from "../../src/lib/types.js";

describe("mapBamlProviderToPiApi", () => {
  const cases: Array<[string, string]> = [
    ["anthropic", "anthropic-messages"],
    ["openai", "openai-completions"],
    ["openai-generic", "openai-completions"],
    ["google-ai", "google-generative-ai"],
    ["vertex-ai", "google-vertex"],
    ["aws-bedrock", "bedrock-converse-stream"],
  ];

  it.each(cases)("maps %s → %s", (input, expected) => {
    expect(mapBamlProviderToPiApi(input)).toBe(expected);
  });

  it("returns input unchanged for unknown providers", () => {
    expect(mapBamlProviderToPiApi("custom-provider")).toBe("custom-provider");
  });
});

describe("parseClientRef", () => {
  it("parses 'provider/model' format", () => {
    const result = parseClientRef("anthropic/claude-4.5-haiku");
    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-4.5-haiku",
    });
  });

  it("handles model with slashes", () => {
    const result = parseClientRef("openai/gpt-4o-2024-05-13");
    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o-2024-05-13",
    });
  });

  it("handles plain provider name (no slash)", () => {
    const result = parseClientRef("PiClient");
    expect(result).toEqual({
      provider: "PiClient",
      model: undefined,
    });
  });
});

describe("createClientRegistryConfig", () => {
  const proxy: ProxyConfig = {
    anthropic: {
      provider: "hai-proxy",
      base_url: "http://localhost:6655/anthropic",
    },
    openai: { provider: "github-copilot" },
  };

  describe("proxy mode (file-based client)", () => {
    it("creates config for a declared client reference", () => {
      const result = createClientRegistryConfig({
        clientRef: "anthropic/claude-4.5-haiku",
        proxy,
        apiKey: "test-key-123",
      });

      expect(result.name).toBe("anthropic/claude-4.5-haiku");
      expect(result.provider).toBe("anthropic");
      expect(result.options).toEqual({
        model: "claude-4.5-haiku",
        api_key: "test-key-123",
        base_url: "http://localhost:6655/anthropic",
      });
    });

    it("omits base_url when not in proxy config", () => {
      const result = createClientRegistryConfig({
        clientRef: "openai/gpt-4o",
        proxy,
        apiKey: "openai-key",
      });

      expect(result.options["base_url"]).toBeUndefined();
      expect(result.options["api_key"]).toBe("openai-key");
      expect(result.options["model"]).toBe("gpt-4o");
    });
  });

  describe("PiClient mode (dynamic)", () => {
    it("creates PiClient entry from defaultModel", () => {
      const result = createClientRegistryConfig({
        clientRef: "PiClient",
        proxy,
        apiKey: "test-key",
        defaultModel: "anthropic/claude-4.5-haiku",
      });

      expect(result.name).toBe("PiClient");
      expect(result.provider).toBe("anthropic");
      expect(result.options["model"]).toBe("claude-4.5-haiku");
      expect(result.options["api_key"]).toBe("test-key");
      expect(result.options["base_url"]).toBe(
        "http://localhost:6655/anthropic",
      );
    });
  });

  describe("model override", () => {
    it("overrides the model from client ref", () => {
      const result = createClientRegistryConfig({
        clientRef: "anthropic/claude-4.5-haiku",
        proxy,
        apiKey: "test-key",
        modelOverride: "anthropic/claude-4.5-sonnet",
      });

      expect(result.options["model"]).toBe("claude-4.5-sonnet");
      // Provider stays the same (from override ref)
      expect(result.provider).toBe("anthropic");
    });
  });

  describe("missing proxy entry", () => {
    it("throws with actionable message when provider not configured", () => {
      expect(() =>
        createClientRegistryConfig({
          clientRef: "vertex-ai/gemini-pro",
          proxy,
          apiKey: "key",
        }),
      ).toThrow(
        /No proxy configured for provider "vertex-ai"/,
      );
    });
  });
});
