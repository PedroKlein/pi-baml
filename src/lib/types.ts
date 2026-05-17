/**
 * pi-baml shared types.
 *
 * This module contains all type definitions used across the package.
 * No runtime logic — only interfaces, types, and type-level constants.
 */

// ─── Configuration Types ─────────────────────────────────────────────────────

/** A single proxy mapping entry: which Pi provider handles a BAML provider. */
export interface ProxyEntry {
  /** Pi provider name (from models.json), e.g. "hai-proxy" */
  readonly provider: string;
  /** Override base URL. If omitted, resolved from Pi's ModelRegistry. */
  readonly base_url?: string;
}

/** Full proxy mapping: BAML provider name → Pi provider routing. */
export type ProxyConfig = Readonly<Record<string, ProxyEntry>>;

/** Per-extension configuration for the forExtension() API. */
export interface ExtensionConfig {
  readonly provider: string;
  readonly model: string;
}

/** The complete baml section from Pi's settings.json. */
export interface BamlSettings {
  /** BAML provider name → Pi provider routing */
  readonly proxy: ProxyConfig;
  /** Default model for dynamic code (baml_exec), e.g. "anthropic/claude-4.5-haiku" */
  readonly defaultModel?: string;
  /** Per-extension configuration overrides */
  readonly extensions?: Readonly<Record<string, ExtensionConfig>>;
  /** Additional directories to scan for .baml function files */
  readonly functionsDirs?: readonly string[];
}

// ─── Executor Types ──────────────────────────────────────────────────────────

/** Configuration for creating an executor or running a function. */
export interface PiBamlConfig {
  /** BAML provider name (e.g. "anthropic", "openai") */
  readonly provider?: string;
  /** Model identifier (e.g. "claude-4.5-haiku") */
  readonly model?: string;
}

/** Metadata captured from BAML's Collector after a function call. */
export interface BamlCallMetadata {
  /** Number of input tokens consumed (null if provider didn't report) */
  readonly inputTokens: number | null;
  /** Number of output tokens generated (null if provider didn't report) */
  readonly outputTokens: number | null;
  /** Number of cached input tokens (null if not applicable) */
  readonly cachedInputTokens: number | null;
  /** Wall-clock duration of the LLM call in milliseconds (null if unavailable) */
  readonly durationMs: number | null;
  /** Model/client name used for the call (null if unavailable) */
  readonly model: string | null;
}

/** Result of a BAML function call including parsed output and execution metadata. */
export interface BamlCallResult<T = unknown> {
  /** The parsed, typed output from the BAML function */
  readonly parsed: T;
  /** Execution metadata (tokens, timing, model) */
  readonly metadata: BamlCallMetadata;
}

/**
 * Minimal interface for executing BAML functions.
 *
 * Deep module: small interface hiding BamlRuntime complexity.
 * Two methods: call a function, release resources.
 */
export interface BamlExecutor {
  /** Execute a named function with arguments, returning parsed typed output with metadata. */
  call<T = unknown>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<BamlCallResult<T>>;

  /** Release resources. Safe to call multiple times. */
  dispose(): void;
}

// ─── Registry Types ──────────────────────────────────────────────────────────

/** Internal representation of a discovered BAML function. */
export interface FunctionEntry {
  /** Function name as declared in .baml source */
  readonly name: string;
  /** Group name (subdirectory name) */
  readonly group: string;
  /** File contents of the compilation unit: filename → source */
  readonly files: Readonly<Record<string, string>>;
  /** Raw input parameter signature, e.g. "text: string, count: int" */
  readonly inputTypes: string;
  /** Raw output type, e.g. "ActionItem[]" */
  readonly outputType: string;
}

/** Public-facing function metadata for baml_list. */
export interface FunctionInfo {
  /** Function name */
  readonly name: string;
  /** Group (subdirectory) this function belongs to */
  readonly group: string;
  /** Qualified name: "group/name" */
  readonly qualifiedName: string;
  /** Input parameters signature */
  readonly inputTypes: string;
  /** Output type */
  readonly outputType: string;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

/** Discriminated error type for BAML operations. */
export type BamlErrorType =
  | "compilation"
  | "execution"
  | "configuration"
  | "unavailable";

/** Structured error returned from tools and library methods. */
export interface BamlError {
  /** Human-readable error message */
  readonly error: string;
  /** Error category */
  readonly type: BamlErrorType;
  /** Raw LLM response text (execution errors only) */
  readonly rawOutput?: string;
  /** BAML compiler diagnostics (compilation errors only) */
  readonly diagnostics?: readonly string[];
}

// ─── EventBus Library API ────────────────────────────────────────────────────

/**
 * The public API shape emitted via pi.events on "pi-baml:ready".
 *
 * Extensions receive this during factory phase. Methods that require
 * ModelRegistry throw until session_start fires (lazy capture).
 */
export interface PiBamlLibrary {
  /** Whether the BAML runtime loaded successfully */
  readonly available: boolean;

  /** Create executor from in-memory .baml file contents */
  createExecutor(
    files: Record<string, string>,
    config?: PiBamlConfig,
  ): Promise<BamlExecutor>;

  /** Create executor from a directory of .baml files */
  createExecutorFromDir(
    path: string,
    config?: PiBamlConfig,
  ): Promise<BamlExecutor>;

  /** One-shot: compile + execute dynamic BAML code */
  execBaml<T = unknown>(
    code: string,
    fn: string,
    args: Record<string, unknown>,
    config?: PiBamlConfig,
  ): Promise<T>;

  /** Call a registered function by name (from the registry) */
  call<T = unknown>(
    fn: string,
    args: Record<string, unknown>,
    modelOverride?: string,
  ): Promise<T>;

  /** List all discovered functions */
  list(group?: string): FunctionInfo[];

  /** Get a pre-configured API for a specific extension */
  forExtension(name: string): PiBamlExtensionAPI;
}

/** Pre-configured API returned by PiBamlLibrary.forExtension(). */
export interface PiBamlExtensionAPI {
  /** Create executor from in-memory .baml file contents */
  createExecutor(files: Record<string, string>): Promise<BamlExecutor>;

  /** Create executor from a directory of .baml files */
  createExecutorFromDir(path: string): Promise<BamlExecutor>;
}
