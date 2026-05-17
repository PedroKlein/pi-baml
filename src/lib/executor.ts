import {
  BamlRuntime,
  ClientRegistry,
  Collector,
} from "@boundaryml/baml";
import type { BamlExecutor, ProxyConfig, BamlError } from "./types.js";
import { createClientRegistryConfig } from "./bridge.js";

/** Input for creating a BAML executor. */
export interface CreateExecutorInput {
  /** File contents: filename → BAML source */
  readonly files: Record<string, string>;
  /** Proxy configuration from settings */
  readonly proxy: ProxyConfig;
  /** API key resolved from Pi's ModelRegistry */
  readonly apiKey: string;
  /** Client reference to configure (e.g. "anthropic/claude-4.5-haiku" or "PiClient") */
  readonly clientRef: string;
  /** Default model for PiClient resolution */
  readonly defaultModel?: string;
  /** Model override */
  readonly modelOverride?: string;
}

/**
 * Create a BAML executor from file contents.
 *
 * Compiles the .baml files via BamlRuntime.fromFiles(),
 * creates a ClientRegistry configured with Pi's credentials,
 * and returns a minimal BamlExecutor interface.
 *
 * Throws a structured BamlError on compilation failure.
 */
export function createBamlExecutor(input: CreateExecutorInput): BamlExecutor {
  const { files, proxy, apiKey, clientRef, defaultModel, modelOverride } =
    input;

  // Compile the runtime
  let runtime: BamlRuntime;
  try {
    runtime = BamlRuntime.fromFiles("/", files, {});
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    const error: BamlError = {
      error: `BAML compilation failed: ${message}`,
      type: "compilation",
      diagnostics: [message],
    };
    throw Object.assign(new Error(error.error), { bamlError: error });
  }

  // Create context manager
  const ctx = runtime.createContextManager();

  // Build ClientRegistry with Pi credentials
  const registryConfig = createClientRegistryConfig({
    clientRef,
    proxy,
    apiKey,
    ...(defaultModel !== undefined && { defaultModel }),
    ...(modelOverride !== undefined && { modelOverride }),
  });

  const clientRegistry = new ClientRegistry();
  clientRegistry.addLlmClient(
    registryConfig.name,
    registryConfig.provider,
    registryConfig.options,
  );
  clientRegistry.setPrimary(registryConfig.name);

  // Track disposal state
  let disposed = false;

  return {
    async call<T = unknown>(
      functionName: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      if (disposed) {
        throw new Error(
          "Executor has been disposed. Create a new executor to make calls.",
        );
      }

      const collector = new Collector();

      try {
        const result = await runtime.callFunction(
          functionName,
          args,
          ctx,
          null,
          clientRegistry,
          [collector],
        );

        if (!result.isOk()) {
          const rawOutput = collector.last?.rawLlmResponse ?? null;
          const error: BamlError = {
            error: `BAML execution failed for function '${functionName}'`,
            type: "execution",
            ...(rawOutput !== null && { rawOutput }),
          };
          throw Object.assign(new Error(error.error), { bamlError: error });
        }

        return result.parsed(false) as T;
      } catch (err) {
        // Re-throw if already a BamlError
        if (
          err instanceof Error &&
          "bamlError" in err
        ) {
          throw err;
        }

        // Wrap unexpected errors
        const rawOutput = collector.last?.rawLlmResponse ?? null;
        const message =
          err instanceof Error ? err.message : String(err);
        const error: BamlError = {
          error: `BAML execution failed for function '${functionName}': ${message}`,
          type: "execution",
          ...(rawOutput !== null && { rawOutput }),
        };
        throw Object.assign(new Error(error.error), { bamlError: error });
      }
    },

    dispose(): void {
      disposed = true;
    },
  };
}
