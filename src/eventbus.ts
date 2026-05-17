import type {
  BamlExecutor,
  BamlSettings,
  FunctionInfo,
  ModelTier,
  PiBamlLibrary,
} from "./lib/types.js";
import { createBamlExecutor } from "./lib/executor.js";
import { FunctionsRegistry } from "./lib/registry.js";
import { RuntimeCache } from "./lib/cache.js";
import { resolveModelTier } from "./lib/bridge.js";
import type { ModelRegistry } from "./lib/bridge.js";

/** Input for creating the library object. */
export interface CreateLibraryInput {
  readonly available: boolean;
  readonly loadError?: string;
  readonly settings: BamlSettings;
}

/** Extended library with internal setters used by the extension factory. */
export interface PiBamlLibraryInternal extends PiBamlLibrary {
  setModelRegistry(registry: ModelRegistry): void;
  setRegistry(registry: FunctionsRegistry): void;
}

export { type ModelRegistry };

/**
 * Create the PiBamlLibrary object emitted on the EventBus.
 */
export function createPiBamlLibrary(
  input: CreateLibraryInput,
): PiBamlLibraryInternal {
  const { available, loadError, settings } = input;

  let modelRegistry: ModelRegistry | null = null;
  let functionsRegistry: FunctionsRegistry = FunctionsRegistry.fromGroups({});
  const runtimeCache = new RuntimeCache<BamlExecutor>();

  function throwUnavailable(): never {
    throw new Error(
      `pi-baml: BAML runtime unavailable: ${loadError ?? "unknown reason"}`,
    );
  }

  function assertReady(): ModelRegistry {
    if (!modelRegistry) {
      throw new Error("pi-baml: not initialized. Available only after session_start.");
    }
    return modelRegistry;
  }

  if (!available) {
    return {
      available: false,
      createExecutor: async () => throwUnavailable(),
      execBaml: async () => throwUnavailable(),
      call: async () => throwUnavailable(),
      list: () => throwUnavailable(),
      setModelRegistry: () => {},
      setRegistry: () => {},
    };
  }

  const lib: PiBamlLibraryInternal = {
    available: true,

    async createExecutor(
      files: Record<string, string>,
      tier?: ModelTier,
    ): Promise<BamlExecutor> {
      const registry = assertReady();
      const { clientRegistry, bamlProvider } = await resolveModelTier(settings, registry, tier);

      return runtimeCache.getOrCreate(files, (f) =>
        createBamlExecutor({ files: f, clientRegistry, syntheticProvider: bamlProvider }),
      );
    },

    async execBaml<T = unknown>(
      code: string,
      fn: string,
      args: Record<string, unknown>,
      tier?: ModelTier,
    ): Promise<T> {
      const registry = assertReady();
      const { clientRegistry, bamlProvider } = await resolveModelTier(settings, registry, tier);

      const executor = createBamlExecutor({
        files: { "dynamic.baml": code },
        clientRegistry,
        syntheticProvider: bamlProvider,
      });

      try {
        const result = await executor.call<T>(fn, args);
        return result.parsed;
      } finally {
        executor.dispose();
      }
    },

    async call<T = unknown>(
      fn: string,
      args: Record<string, unknown>,
      tier?: ModelTier,
    ): Promise<T> {
      const registry = assertReady();
      const entry = functionsRegistry.resolve(fn);
      const { clientRegistry, bamlProvider } = await resolveModelTier(settings, registry, tier);

      const executor = runtimeCache.getOrCreate(entry.files, (f) =>
        createBamlExecutor({ files: f, clientRegistry, syntheticProvider: bamlProvider }),
      );

      const result = await executor.call<T>(entry.name, args);
      return result.parsed;
    },

    list(group?: string): FunctionInfo[] {
      return functionsRegistry.list(group);
    },

    setModelRegistry(registry: ModelRegistry): void {
      modelRegistry = registry;
    },

    setRegistry(registry: FunctionsRegistry): void {
      functionsRegistry = registry;
    },
  };

  return lib;
}
