import type {
  BamlExecutor,
  BamlSettings,
  FunctionInfo,
  PiBamlConfig,
  PiBamlExtensionAPI,
  PiBamlLibrary,
} from "./lib/types.js";
import { createBamlExecutor } from "./lib/executor.js";
import { FunctionsRegistry } from "./lib/registry.js";
import { RuntimeCache } from "./lib/cache.js";

/** Minimal ModelRegistry interface — only what we need from Pi. */
export interface ModelRegistry {
  getApiKeyForProvider(name: string): Promise<string>;
}

/** Input for creating the library object. */
export interface CreateLibraryInput {
  readonly available: boolean;
  readonly loadError?: string;
  readonly settings: BamlSettings;
}

/** Extended library with internal setters used by the extension factory. */
export interface PiBamlLibraryInternal extends PiBamlLibrary {
  /** Set the ModelRegistry after session_start fires. */
  setModelRegistry(registry: ModelRegistry): void;
  /** Set the functions registry after discovery. */
  setRegistry(registry: FunctionsRegistry): void;
}

/**
 * Create the PiBamlLibrary object emitted on the EventBus.
 *
 * Returns the full library shape. If available=false, all methods
 * throw helpful errors. If available=true, methods that need
 * ModelRegistry throw until setModelRegistry() is called.
 */
export function createPiBamlLibrary(
  input: CreateLibraryInput,
): PiBamlLibraryInternal {
  const { available, loadError, settings } = input;

  // State captured lazily
  let modelRegistry: ModelRegistry | null = null;
  let functionsRegistry: FunctionsRegistry = FunctionsRegistry.fromGroups({});
  const runtimeCache = new RuntimeCache<BamlExecutor>();

  function throwUnavailable(): never {
    throw new Error(
      `pi-baml: BAML runtime unavailable. @boundaryml/baml native binary failed to load: ${loadError ?? "unknown reason"}`,
    );
  }

  function assertInitialized(): void {
    if (!modelRegistry) {
      throw new Error(
        "pi-baml: not initialized. Library methods are available only after session_start.",
      );
    }
  }

  async function resolveApiKey(provider: string): Promise<string> {
    assertInitialized();
    const proxyEntry = settings.proxy[provider];
    const piProvider = proxyEntry?.provider ?? provider;
    return modelRegistry!.getApiKeyForProvider(piProvider);
  }

  // Unavailable path: all methods throw
  if (!available) {
    return {
      available: false,
      createExecutor: async () => throwUnavailable(),
      createExecutorFromDir: async () => throwUnavailable(),
      execBaml: async () => throwUnavailable(),
      call: async () => throwUnavailable(),
      list: () => throwUnavailable(),
      forExtension: () => throwUnavailable(),
      setModelRegistry: () => {},
      setRegistry: () => {},
    };
  }

  // Available path
  const lib: PiBamlLibraryInternal = {
    available: true,

    async createExecutor(
      files: Record<string, string>,
      config?: PiBamlConfig,
    ): Promise<BamlExecutor> {
      assertInitialized();

      const provider = config?.provider ?? parseProvider(settings.defaultModel);
      const apiKey = await resolveApiKey(provider);

      const clientRef = config?.model
        ? `${config.provider ?? provider}/${config.model}`
        : settings.defaultModel ?? "PiClient";

      return runtimeCache.getOrCreate(files, (f) =>
        createBamlExecutor({
          files: f,
          proxy: settings.proxy,
          apiKey,
          clientRef,
          ...spreadDefaultModel(settings.defaultModel),
        }),
      );
    },

    async createExecutorFromDir(
      _path: string,
      _config?: PiBamlConfig,
    ): Promise<BamlExecutor> {
      assertInitialized();
      // Directory reading will be implemented in the integration layer
      throw new Error("createExecutorFromDir: not yet implemented");
    },

    async execBaml<T = unknown>(
      code: string,
      fn: string,
      args: Record<string, unknown>,
      config?: PiBamlConfig,
    ): Promise<T> {
      assertInitialized();

      const provider = config?.provider ?? parseProvider(settings.defaultModel);
      const apiKey = await resolveApiKey(provider);

      const clientRef = config?.model
        ? `${config.provider ?? provider}/${config.model}`
        : "PiClient";

      const executor = createBamlExecutor({
        files: { "dynamic.baml": code },
        proxy: settings.proxy,
        apiKey,
        clientRef,
        ...spreadDefaultModel(settings.defaultModel),
      });

      try {
        return await executor.call<T>(fn, args);
      } finally {
        executor.dispose();
      }
    },

    async call<T = unknown>(
      fn: string,
      args: Record<string, unknown>,
      modelOverride?: string,
    ): Promise<T> {
      assertInitialized();

      const entry = functionsRegistry.resolve(fn);
      const provider = parseProvider(settings.defaultModel);
      const apiKey = await resolveApiKey(provider);

      const executor = runtimeCache.getOrCreate(entry.files, (f) =>
        createBamlExecutor({
          files: f,
          proxy: settings.proxy,
          apiKey,
          clientRef: settings.defaultModel ?? "PiClient",
          ...spreadDefaultModel(settings.defaultModel),
          ...(modelOverride !== undefined && { modelOverride }),
        }),
      );

      return executor.call<T>(entry.name, args);
    },

    list(group?: string): FunctionInfo[] {
      return functionsRegistry.list(group);
    },

    forExtension(name: string): PiBamlExtensionAPI {
      const extConfig = settings.extensions?.[name];

      return {
        async createExecutor(files: Record<string, string>): Promise<BamlExecutor> {
          const config: PiBamlConfig | undefined = extConfig
            ? { provider: extConfig.provider, model: extConfig.model }
            : undefined;
          return lib.createExecutor(files, config);
        },
        async createExecutorFromDir(path: string): Promise<BamlExecutor> {
          const config: PiBamlConfig | undefined = extConfig
            ? { provider: extConfig.provider, model: extConfig.model }
            : undefined;
          return lib.createExecutorFromDir(path, config);
        },
      };
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

/** Extract provider from a "provider/model" string. */
function parseProvider(defaultModel: string | undefined): string {
  if (!defaultModel) return "unknown";
  const slash = defaultModel.indexOf("/");
  return slash === -1 ? defaultModel : defaultModel.slice(0, slash);
}

/** Spread defaultModel only when defined (satisfies exactOptionalPropertyTypes). */
function spreadDefaultModel(defaultModel: string | undefined): { defaultModel: string } | Record<string, never> {
  return defaultModel !== undefined ? { defaultModel } : {};
}
