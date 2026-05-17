import type { BamlSettings, ProxyEntry } from "./types.js";

/**
 * Parse the `baml` section from Pi's settings.json content.
 *
 * Pure function: takes the parsed settings object, returns validated BamlSettings.
 * Returns sensible defaults when config is missing or partial.
 * Throws on malformed entries with actionable error messages.
 */
export function parseBamlSettings(settings: unknown): BamlSettings {
  if (settings === null || settings === undefined || typeof settings !== "object") {
    return { proxy: {} };
  }

  const root = settings as Record<string, unknown>;
  const baml = root["baml"];

  if (baml === undefined || baml === null || typeof baml !== "object") {
    return { proxy: {} };
  }

  const raw = baml as Record<string, unknown>;

  const proxy = parseProxy(raw["proxy"]);
  const defaultModel = parseOptionalString(raw["defaultModel"]);
  const extensions = parseExtensions(raw["extensions"]);
  const functionsDirs = parseStringArray(raw["functionsDirs"]);

  return {
    proxy,
    ...(defaultModel !== undefined && { defaultModel }),
    ...(extensions !== undefined && { extensions }),
    ...(functionsDirs !== undefined && { functionsDirs }),
  };
}

function parseProxy(value: unknown): Record<string, ProxyEntry> {
  if (value === undefined || value === null || typeof value !== "object") {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const result: Record<string, ProxyEntry> = {};

  for (const [name, entry] of Object.entries(raw)) {
    if (entry === null || entry === undefined || typeof entry !== "object") {
      throw new Error(
        `Invalid baml.proxy entry "${name}": expected an object with a "provider" field.`,
      );
    }

    const entryObj = entry as Record<string, unknown>;
    const provider = entryObj["provider"];

    if (provider === undefined || provider === null) {
      throw new Error(
        `Invalid baml.proxy entry "${name}": missing required "provider" field.`,
      );
    }

    if (typeof provider !== "string") {
      throw new Error(
        `Invalid baml.proxy entry "${name}": "provider" must be a string, got ${typeof provider}.`,
      );
    }

    const proxyEntry: ProxyEntry = { provider };
    const baseUrl = entryObj["base_url"];

    if (baseUrl !== undefined && baseUrl !== null) {
      if (typeof baseUrl !== "string") {
        throw new Error(
          `Invalid baml.proxy entry "${name}": "base_url" must be a string.`,
        );
      }
      result[name] = { ...proxyEntry, base_url: baseUrl };
    } else {
      result[name] = proxyEntry;
    }
  }

  return result;
}

function parseExtensions(
  value: unknown,
): Record<string, { provider: string; model: string }> | undefined {
  if (value === undefined || value === null || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const result: Record<string, { provider: string; model: string }> = {};

  for (const [name, entry] of Object.entries(raw)) {
    if (entry === null || entry === undefined || typeof entry !== "object") {
      continue;
    }
    const entryObj = entry as Record<string, unknown>;
    const provider = entryObj["provider"];
    const model = entryObj["model"];

    if (typeof provider === "string" && typeof model === "string") {
      result[name] = { provider, model };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );

  return result.length > 0 ? result : undefined;
}
