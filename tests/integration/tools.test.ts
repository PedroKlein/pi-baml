import { describe, it, expect } from "vitest";
import { BamlRuntime } from "@boundaryml/baml";
import { FunctionsRegistry, parseFunctionDeclarations } from "../../src/lib/registry.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EXAMPLES_DIR = join(import.meta.dirname, "../../examples");

describe("full tool integration", () => {
  it("registry discovers and parses real example files", () => {
    const groups: Record<string, Record<string, string>> = {};

    const dirs = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const groupPath = join(EXAMPLES_DIR, dir.name);
      const files: Record<string, string> = {};

      for (const file of readdirSync(groupPath).filter((f) => f.endsWith(".baml"))) {
        files[file] = readFileSync(join(groupPath, file), "utf-8");
      }

      groups[dir.name] = files;
    }

    const registry = FunctionsRegistry.fromGroups(groups);
    const list = registry.list();

    expect(list.length).toBeGreaterThan(0);

    // Verify each function can be resolved
    for (const fn of list) {
      const entry = registry.resolve(fn.name);
      expect(entry.files).toBeDefined();
      expect(Object.keys(entry.files).length).toBeGreaterThan(0);
    }
  });

  it("registry functions compile via BamlRuntime", () => {
    const dirs = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const groupPath = join(EXAMPLES_DIR, dir.name);
      const files: Record<string, string> = {};

      for (const file of readdirSync(groupPath).filter((f) => f.endsWith(".baml"))) {
        files[file] = readFileSync(join(groupPath, file), "utf-8");
      }

      // Should compile without error
      const runtime = BamlRuntime.fromFiles("/", files, {});
      expect(runtime).toBeDefined();
    }
  });

  it("function declarations match what BAML compiles", () => {
    const source = readFileSync(
      join(EXAMPLES_DIR, "classify-intent/main.baml"),
      "utf-8",
    );

    const declarations = parseFunctionDeclarations(source);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.name).toBe("ClassifyIntent");

    // Should also compile
    const runtime = BamlRuntime.fromFiles("/", { "main.baml": source }, {});
    expect(runtime).toBeDefined();
  });
});
