import { describe, it, expect } from "vitest";
import { parseBamlSettings } from "../../src/lib/config.js";

describe("parseBamlSettings", () => {
  describe("valid complete settings", () => {
    it("parses all fields from a complete config", () => {
      const input = {
        baml: {
          proxy: {
            anthropic: {
              provider: "hai-proxy",
              base_url: "http://localhost:6655/anthropic",
            },
            openai: {
              provider: "github-copilot",
            },
          },
          defaultModel: "anthropic/claude-4.5-haiku",
          extensions: {
            "pi-memory": {
              provider: "anthropic",
              model: "claude-4.5-haiku",
            },
          },
          functionsDirs: ["~/my-custom-baml-dir"],
        },
      };

      const result = parseBamlSettings(input);

      expect(result.proxy).toEqual({
        anthropic: {
          provider: "hai-proxy",
          base_url: "http://localhost:6655/anthropic",
        },
        openai: { provider: "github-copilot" },
      });
      expect(result.defaultModel).toBe("anthropic/claude-4.5-haiku");
      expect(result.extensions).toEqual({
        "pi-memory": { provider: "anthropic", model: "claude-4.5-haiku" },
      });
      expect(result.functionsDirs).toEqual(["~/my-custom-baml-dir"]);
    });
  });

  describe("missing baml key", () => {
    it("returns empty defaults when baml key is absent", () => {
      const result = parseBamlSettings({});

      expect(result.proxy).toEqual({});
      expect(result.defaultModel).toBeUndefined();
      expect(result.extensions).toBeUndefined();
      expect(result.functionsDirs).toBeUndefined();
    });

    it("returns empty defaults for null settings", () => {
      const result = parseBamlSettings(null);

      expect(result.proxy).toEqual({});
      expect(result.defaultModel).toBeUndefined();
    });
  });

  describe("partial config", () => {
    it("handles missing optional fields", () => {
      const input = {
        baml: {
          proxy: {
            anthropic: { provider: "hai-proxy" },
          },
        },
      };

      const result = parseBamlSettings(input);

      expect(result.proxy).toEqual({ anthropic: { provider: "hai-proxy" } });
      expect(result.defaultModel).toBeUndefined();
      expect(result.extensions).toBeUndefined();
      expect(result.functionsDirs).toBeUndefined();
    });

    it("handles empty proxy map", () => {
      const input = {
        baml: {
          proxy: {},
          defaultModel: "anthropic/claude-4.5-haiku",
        },
      };

      const result = parseBamlSettings(input);

      expect(result.proxy).toEqual({});
      expect(result.defaultModel).toBe("anthropic/claude-4.5-haiku");
    });
  });

  describe("malformed entries", () => {
    it("rejects proxy entry without provider field", () => {
      const input = {
        baml: {
          proxy: {
            anthropic: { base_url: "http://localhost:6655" },
          },
        },
      };

      expect(() => parseBamlSettings(input)).toThrow(
        /proxy entry "anthropic".*missing.*provider/i,
      );
    });

    it("rejects proxy entry with non-string provider", () => {
      const input = {
        baml: {
          proxy: {
            anthropic: { provider: 123 },
          },
        },
      };

      expect(() => parseBamlSettings(input)).toThrow(
        /proxy entry "anthropic".*provider.*string/i,
      );
    });
  });

  describe("functionsDirs resolution", () => {
    it("returns custom dirs from config", () => {
      const input = {
        baml: {
          proxy: {},
          functionsDirs: ["/custom/path", "~/another"],
        },
      };

      const result = parseBamlSettings(input);

      expect(result.functionsDirs).toEqual(["/custom/path", "~/another"]);
    });
  });
});
