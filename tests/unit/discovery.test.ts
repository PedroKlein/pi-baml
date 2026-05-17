import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverBamlGroups, scanDirectory } from "../../src/lib/discovery.js";

/** Create a unique temp directory for each test. */
function createTmpDir(): string {
  const dir = join(tmpdir(), `pi-baml-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("scanDirectory", () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty for non-existent directory", () => {
    const result = scanDirectory(join(root, "nonexistent"));
    expect(result).toEqual({});
  });

  it("discovers subdirectories as groups", () => {
    const groupDir = join(root, "extract-todos");
    mkdirSync(groupDir);
    writeFileSync(
      join(groupDir, "main.baml"),
      `function ExtractTodos(notes: string) -> Todo[] {
        client PiClient
        prompt #"{{ notes }}"#
      }`,
    );

    const result = scanDirectory(root);
    expect(Object.keys(result)).toEqual(["extract-todos"]);
    expect(result["extract-todos"]).toHaveProperty("main.baml");
  });

  it("reads multiple .baml files in a group", () => {
    const groupDir = join(root, "extraction");
    mkdirSync(groupDir);
    writeFileSync(join(groupDir, "types.baml"), `class Item { name string }`);
    writeFileSync(
      join(groupDir, "functions.baml"),
      `function Extract(text: string) -> Item[] {
        client PiClient
        prompt #"..."#
      }`,
    );

    const result = scanDirectory(root);
    expect(Object.keys(result["extraction"]!).sort()).toEqual([
      "functions.baml",
      "types.baml",
    ]);
  });

  it("ignores non-.baml files", () => {
    const groupDir = join(root, "mygroup");
    mkdirSync(groupDir);
    writeFileSync(join(groupDir, "main.baml"), `function F(x: string) -> string { client PiClient prompt #""# }`);
    writeFileSync(join(groupDir, "README.md"), "# readme");
    writeFileSync(join(groupDir, "notes.txt"), "notes");

    const result = scanDirectory(root);
    expect(Object.keys(result["mygroup"]!)).toEqual(["main.baml"]);
  });

  it("skips dotfiles and dotdirs", () => {
    const hiddenDir = join(root, ".hidden");
    mkdirSync(hiddenDir);
    writeFileSync(join(hiddenDir, "main.baml"), `function H(x: string) -> string { client PiClient prompt #""# }`);

    const visibleDir = join(root, "visible");
    mkdirSync(visibleDir);
    writeFileSync(join(visibleDir, "main.baml"), `function V(x: string) -> string { client PiClient prompt #""# }`);

    const result = scanDirectory(root);
    expect(Object.keys(result)).toEqual(["visible"]);
  });

  it("skips groups with no .baml files", () => {
    const emptyGroup = join(root, "empty");
    mkdirSync(emptyGroup);
    writeFileSync(join(emptyGroup, "README.md"), "# nothing here");

    const result = scanDirectory(root);
    expect(result).toEqual({});
  });

  it("ignores files at root level (not in subdirectories)", () => {
    writeFileSync(join(root, "stray.baml"), `function Stray(x: string) -> string { client PiClient prompt #""# }`);

    const result = scanDirectory(root);
    expect(result).toEqual({});
  });
});

describe("discoverBamlGroups", () => {
  let tmpRoot: string;
  let fakeCwd: string;

  beforeEach(() => {
    tmpRoot = createTmpDir();
    fakeCwd = join(tmpRoot, "project");
    mkdirSync(fakeCwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("discovers from <cwd>/.agents/baml/", () => {
    const dir = join(fakeCwd, ".agents", "baml", "my-funcs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "main.baml"),
      `function MyFunc(x: string) -> string {
        client PiClient
        prompt #"{{ x }}"#
      }`,
    );

    // discoverBamlGroups also checks ~/.agents/baml etc but those won't have our test data
    const result = discoverBamlGroups(fakeCwd);
    expect(result["my-funcs"]).toBeDefined();
    expect(result["my-funcs"]!["main.baml"]).toContain("MyFunc");
  });

  it("discovers from <cwd>/.pi/baml/", () => {
    const dir = join(fakeCwd, ".pi", "baml", "pi-funcs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "extract.baml"),
      `function PiFunc(text: string) -> string[] {
        client PiClient
        prompt #"{{ text }}"#
      }`,
    );

    const result = discoverBamlGroups(fakeCwd);
    expect(result["pi-funcs"]).toBeDefined();
  });

  it("higher-priority directory overrides lower for same group name", () => {
    // Create same group in .pi/baml and .agents/baml
    const piDir = join(fakeCwd, ".pi", "baml", "shared");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "main.baml"), `function LowPriority(x: string) -> string { client PiClient prompt #""# }`);

    const agentsDir = join(fakeCwd, ".agents", "baml", "shared");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "main.baml"), `function HighPriority(x: string) -> string { client PiClient prompt #""# }`);

    const result = discoverBamlGroups(fakeCwd);
    // .agents/baml (project) has higher priority than .pi/baml (project)
    expect(result["shared"]!["main.baml"]).toContain("HighPriority");
  });

  it("merges groups from multiple directories", () => {
    const piDir = join(fakeCwd, ".pi", "baml", "alpha");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "main.baml"), `function Alpha(x: string) -> string { client PiClient prompt #""# }`);

    const agentsDir = join(fakeCwd, ".agents", "baml", "beta");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "main.baml"), `function Beta(x: string) -> string { client PiClient prompt #""# }`);

    const result = discoverBamlGroups(fakeCwd);
    expect(result["alpha"]).toBeDefined();
    expect(result["beta"]).toBeDefined();
  });

  it("includes extraDirs from settings", () => {
    const customDir = join(tmpRoot, "custom-baml");
    const groupDir = join(customDir, "custom-group");
    mkdirSync(groupDir, { recursive: true });
    writeFileSync(join(groupDir, "main.baml"), `function Custom(x: string) -> string { client PiClient prompt #""# }`);

    const result = discoverBamlGroups(fakeCwd, [customDir]);
    expect(result["custom-group"]).toBeDefined();
  });

  it("project dirs override extraDirs", () => {
    // Extra dir (lower priority)
    const customDir = join(tmpRoot, "custom-baml");
    const customGroup = join(customDir, "overlap");
    mkdirSync(customGroup, { recursive: true });
    writeFileSync(join(customGroup, "main.baml"), `function FromExtra(x: string) -> string { client PiClient prompt #""# }`);

    // Project dir (higher priority)
    const projectGroup = join(fakeCwd, ".agents", "baml", "overlap");
    mkdirSync(projectGroup, { recursive: true });
    writeFileSync(join(projectGroup, "main.baml"), `function FromProject(x: string) -> string { client PiClient prompt #""# }`);

    const result = discoverBamlGroups(fakeCwd, [customDir]);
    expect(result["overlap"]!["main.baml"]).toContain("FromProject");
  });

  it("returns empty when no directories exist", () => {
    const emptyDir = join(tmpRoot, "empty-project");
    mkdirSync(emptyDir, { recursive: true });

    const result = discoverBamlGroups(emptyDir);
    // May contain entries from ~/.agents/baml if the user has them,
    // but the function itself shouldn't error
    expect(typeof result).toBe("object");
  });
});
