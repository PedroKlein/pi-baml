import type { ProxyConfig } from "./types.js";

/** Maps BAML provider names to Pi's API type identifiers. */
const PROVIDER_MAP: Readonly<Record<string, string>> = {
  anthropic: "anthropic-messages",
  openai: "openai-completions",
  "openai-generic": "openai-completions",
  "google-ai": "google-generative-ai",
  "vertex-ai": "google-vertex",
  "aws-bedrock": "bedrock-converse-stream",
};

/**
 * Map a BAML provider name to the Pi API type.
 *
 * Returns the input unchanged for unknown providers —
 * they may be custom providers that match directly.
 */
export function mapBamlProviderToPiApi(bamlProvider: string): string {
  return PROVIDER_MAP[bamlProvider] ?? bamlProvider;
}

/** Parsed client reference: "provider/model" or just "clientName". */
export interface ParsedClientRef {
  readonly provider: string;
  readonly model: string | undefined;
}

/**
 * Parse a BAML client reference into provider and model parts.
 *
 * Format: "provider/model-name" → { provider: "provider", model: "model-name" }
 * Plain name: "PiClient" → { provider: "PiClient", model: undefined }
 */
export function parseClientRef(ref: string): ParsedClientRef {
  const slashIndex = ref.indexOf("/");
  if (slashIndex === -1) {
    return { provider: ref, model: undefined };
  }
  return {
    provider: ref.slice(0, slashIndex),
    model: ref.slice(slashIndex + 1),
  };
}

/** Configuration needed to call ClientRegistry.addLlmClient(). */
export interface ClientRegistryEntry {
  readonly name: string;
  readonly provider: string;
  readonly options: Record<string, string>;
}

/** Input parameters for createClientRegistryConfig. */
export interface CreateClientConfigInput {
  /** The client reference from the .baml file (e.g. "anthropic/claude-4.5-haiku" or "PiClient") */
  readonly clientRef: string;
  /** Proxy configuration from settings */
  readonly proxy: ProxyConfig;
  /** API key resolved from Pi's ModelRegistry */
  readonly apiKey: string;
  /** Default model for PiClient resolution (e.g. "anthropic/claude-4.5-haiku") */
  readonly defaultModel?: string;
  /** Override model (e.g. "anthropic/claude-4.5-sonnet") */
  readonly modelOverride?: string;
}

/**
 * Create the configuration for a BAML ClientRegistry entry.
 *
 * Pure function: takes proxy config + resolved credentials,
 * returns the data needed to call ClientRegistry.addLlmClient().
 * No side effects, no network calls.
 *
 * Two modes:
 * - Proxy mode: clientRef is "provider/model" — resolves via proxy config
 * - PiClient mode: clientRef is "PiClient" — resolves via defaultModel setting
 */
export function createClientRegistryConfig(
  input: CreateClientConfigInput,
): ClientRegistryEntry {
  const { clientRef, proxy, apiKey, defaultModel, modelOverride } = input;

  // Determine effective provider and model
  let effectiveProvider: string;
  let effectiveModel: string | undefined;

  if (clientRef === "PiClient") {
    // PiClient mode: resolve from defaultModel
    if (!defaultModel) {
      throw new Error(
        "No default model configured. Pass model param or set baml.defaultModel in settings.",
      );
    }
    const parsed = parseClientRef(defaultModel);
    effectiveProvider = parsed.provider;
    effectiveModel = parsed.model;
  } else if (modelOverride) {
    // Override mode: take provider from override
    const parsed = parseClientRef(modelOverride);
    effectiveProvider = parsed.provider;
    effectiveModel = parsed.model;
  } else {
    // Proxy mode: parse the client reference
    const parsed = parseClientRef(clientRef);
    effectiveProvider = parsed.provider;
    effectiveModel = parsed.model;
  }

  // Resolve proxy entry for the provider
  const proxyEntry = proxy[effectiveProvider];
  if (!proxyEntry) {
    throw new Error(
      `No proxy configured for provider "${effectiveProvider}". Add it to settings.json baml.proxy.`,
    );
  }

  // Build options
  const options: Record<string, string> = {
    api_key: apiKey,
  };

  if (effectiveModel) {
    options["model"] = effectiveModel;
  }

  if (proxyEntry.base_url) {
    options["base_url"] = proxyEntry.base_url;
  }

  return {
    name: clientRef,
    provider: effectiveProvider,
    options,
  };
}
