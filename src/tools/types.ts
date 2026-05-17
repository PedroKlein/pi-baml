/**
 * Pi-compatible tool result shape.
 *
 * Pi's AgentToolResult expects { content: TextContent[], details: T }.
 * Tools MUST return this format — returning a plain string crashes the renderer.
 */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  details: unknown;
}

/**
 * Minimal context passed to tool execute functions.
 *
 * Subset of Pi's ExtensionContext relevant to BAML tools.
 */
export interface ToolContext {
  /** Current session model (provider/id format available via model.provider + model.id) */
  model: {
    id: string;
    provider: string;
    api: string;
    baseUrl: string;
  } | undefined;
  /** Model registry for API key resolution */
  modelRegistry: {
    getApiKeyForProvider(provider: string): Promise<string | undefined>;
    getApiKeyAndHeaders(model: { provider: string }): Promise<{ apiKey: string; headers?: Record<string, string> }>;
  } | undefined;
}

/** Tool definition shape (subset of Pi's tool interface). */
export interface ToolDefinition {
  execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult>;
}
