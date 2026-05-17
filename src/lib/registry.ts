import type { FunctionEntry, FunctionInfo } from "./types.js";

/** Parsed function declaration from .baml source. */
interface ParsedFunction {
  readonly name: string;
  readonly inputTypes: string;
  readonly outputType: string;
}

/**
 * Parse function declarations from BAML source code.
 *
 * Extracts name, input parameters, and return type using regex.
 * Does not validate BAML syntax — that's BamlRuntime's job.
 */
export function parseFunctionDeclarations(source: string): ParsedFunction[] {
  const pattern = /function\s+(\w+)\s*\(([^)]*)\)\s*->\s*(.+?)\s*\{/g;
  const results: ParsedFunction[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1];
    const inputTypes = match[2]?.trim() ?? "";
    const outputType = match[3]?.trim() ?? "";

    if (name) {
      results.push({ name, inputTypes, outputType });
    }
  }

  return results;
}

/**
 * Registry of discovered BAML functions.
 *
 * Deep module: simple interface (resolve, list) hiding directory
 * discovery, function parsing, and collision resolution logic.
 */
export class FunctionsRegistry {
  private readonly entries: Map<string, FunctionEntry> = new Map();
  private readonly shortNameIndex: Map<string, string[]> = new Map();

  private constructor() {}

  /**
   * Create a registry from pre-loaded groups.
   *
   * Each key is a group name (subdirectory), value is a map of
   * filename → BAML source content.
   */
  static fromGroups(
    groups: Record<string, Record<string, string>>,
  ): FunctionsRegistry {
    const registry = new FunctionsRegistry();

    for (const [group, files] of Object.entries(groups)) {
      const allFunctions: ParsedFunction[] = [];

      for (const source of Object.values(files)) {
        allFunctions.push(...parseFunctionDeclarations(source));
      }

      for (const fn of allFunctions) {
        const qualifiedName = `${group}/${fn.name}`;

        const entry: FunctionEntry = {
          name: fn.name,
          group,
          files,
          inputTypes: fn.inputTypes,
          outputType: fn.outputType,
        };

        registry.entries.set(qualifiedName, entry);

        const existing = registry.shortNameIndex.get(fn.name) ?? [];
        existing.push(qualifiedName);
        registry.shortNameIndex.set(fn.name, existing);
      }
    }

    return registry;
  }

  /**
   * Resolve a function by short name or qualified name.
   *
   * Short name: "ExtractActionItems" — works if unambiguous.
   * Qualified name: "extraction/ExtractActionItems" — always works.
   *
   * Throws with actionable hint on ambiguity or not-found.
   */
  resolve(name: string): FunctionEntry {
    // Try qualified name first
    const direct = this.entries.get(name);
    if (direct) {
      return direct;
    }

    // Try short name
    const qualifiedNames = this.shortNameIndex.get(name);

    if (!qualifiedNames || qualifiedNames.length === 0) {
      throw new Error(
        `Function '${name}' not found in the registry. Run baml_list to see available functions.`,
      );
    }

    if (qualifiedNames.length > 1) {
      const options = qualifiedNames.map((qn) => `'${qn}'`).join(" or ");
      throw new Error(
        `Ambiguous function name '${name}'. Use ${options}.`,
      );
    }

    const resolved = this.entries.get(qualifiedNames[0]!);
    if (!resolved) {
      throw new Error(
        `Function '${name}' not found in the registry. Run baml_list to see available functions.`,
      );
    }

    return resolved;
  }

  /** List all functions, optionally filtered by group. */
  list(group?: string): FunctionInfo[] {
    const results: FunctionInfo[] = [];

    for (const [qualifiedName, entry] of this.entries) {
      if (group !== undefined && entry.group !== group) {
        continue;
      }

      results.push({
        name: entry.name,
        group: entry.group,
        qualifiedName,
        inputTypes: entry.inputTypes,
        outputType: entry.outputType,
      });
    }

    return results;
  }

  /** Check if the registry has any functions. */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }
}
