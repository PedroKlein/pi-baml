import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Discovered groups: group name → { filename → BAML source content }.
 *
 * Each subdirectory under a discovery root becomes one compilation unit (group).
 */
export type DiscoveredGroups = Record<string, Record<string, string>>;

/**
 * Discovery directories in priority order (lowest → highest).
 *
 * Higher-priority groups override lower ones when names collide.
 */
function getDiscoveryDirs(cwd: string): string[] {
  const home = homedir();
  return [
    join(home, ".agents", "baml"),   // global
    join(home, ".pi", "baml"),       // pi-local
    join(cwd, ".pi", "baml"),        // project (pi convention)
    join(cwd, ".agents", "baml"),    // project (agents convention)
  ];
}

/**
 * Scan a single directory root for BAML groups.
 *
 * Each immediate subdirectory is a group. All .baml files within
 * that subdirectory (non-recursive) become the compilation unit.
 *
 * Returns empty record if the directory doesn't exist or isn't readable.
 */
function scanDirectory(root: string): DiscoveredGroups {
  const groups: DiscoveredGroups = {};

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // Directory doesn't exist or isn't readable — skip silently
    return groups;
  }

  for (const entry of entries) {
    const entryPath = join(root, entry);

    // Skip dotfiles/dotdirs
    if (entry.startsWith(".")) continue;

    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    // Read all .baml files in this subdirectory
    const files: Record<string, string> = {};
    let subEntries: string[];
    try {
      subEntries = readdirSync(entryPath);
    } catch {
      continue;
    }

    let hasBamlFile = false;
    for (const file of subEntries) {
      const isBAML = file.endsWith(".baml");
      const isReadme = file === "README.md";
      if (!isBAML && !isReadme) continue;

      const filePath = join(entryPath, file);
      try {
        const stat2 = statSync(filePath);
        if (!stat2.isFile()) continue;
        files[file] = readFileSync(filePath, "utf-8");
        if (isBAML) hasBamlFile = true;
      } catch {
        // Skip unreadable files
        continue;
      }
    }

    // Only register groups that have at least one .baml file
    if (hasBamlFile) {
      groups[entry] = files;
    }
  }

  return groups;
}

/**
 * Scan skill directories for BAML groups.
 *
 * Each `<skillsDir>/<skill-name>/baml/` directory becomes a group with
 * a `skill:` prefix (e.g. `skill:diagnose`).
 *
 * Skills without a `baml/` subdirectory are silently skipped.
 * The baml/ directory is scanned flat — .baml files live directly inside it,
 * not in further subdirectories.
 */
export function scanSkillDirectories(skillsDir: string): DiscoveredGroups {
  const groups: DiscoveredGroups = {};

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    // Directory doesn't exist or isn't readable — skip silently
    return groups;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const skillPath = join(skillsDir, entry);
    let skillStat;
    try {
      skillStat = statSync(skillPath);
    } catch {
      continue;
    }
    if (!skillStat.isDirectory()) continue;

    const bamlPath = join(skillPath, "baml");
    let bamlStat;
    try {
      bamlStat = statSync(bamlPath);
    } catch {
      // No baml/ subdir — skip silently
      continue;
    }
    if (!bamlStat.isDirectory()) continue;

    // Read files directly from baml/ (flat — not recursive into subdirs)
    let bamlEntries: string[];
    try {
      bamlEntries = readdirSync(bamlPath);
    } catch {
      continue;
    }

    const files: Record<string, string> = {};
    let hasBamlFile = false;
    for (const file of bamlEntries) {
      const isBAML = file.endsWith(".baml");
      const isReadme = file === "README.md";
      if (!isBAML && !isReadme) continue;

      const filePath = join(bamlPath, file);
      try {
        const fileStat = statSync(filePath);
        if (!fileStat.isFile()) continue;
        files[file] = readFileSync(filePath, "utf-8");
        if (isBAML) hasBamlFile = true;
      } catch {
        continue;
      }
    }

    if (hasBamlFile) {
      groups[`skill:${entry}`] = files;
    }
  }

  return groups;
}

/**
 * Discover all BAML function groups from standard directories.
 *
 * Scans directories in priority order. Higher-priority directories
 * override groups with the same name from lower-priority ones.
 *
 * @param cwd - Current working directory (project root)
 * @param extraDirs - Additional directories to scan (from settings.functionsDirs)
 */
export function discoverBamlGroups(
  cwd: string,
  extraDirs?: readonly string[],
  skillsDirs?: readonly string[],
): DiscoveredGroups {
  const merged: DiscoveredGroups = {};

  // 1. Skill directories — lowest priority (skill: prefixed groups)
  const resolvedSkillsDirs = skillsDirs ?? [join(homedir(), ".agents", "skills")];
  for (const skillsDir of resolvedSkillsDirs) {
    const skillGroups = scanSkillDirectories(skillsDir);
    for (const [group, files] of Object.entries(skillGroups)) {
      merged[group] = files;
    }
  }

  // 2. Standard directories (lowest to highest priority)
  const dirs = getDiscoveryDirs(cwd);

  // Extra dirs from settings go between standard global and project dirs
  // (lower priority than project, higher than pi-local)
  if (extraDirs && extraDirs.length > 0) {
    // Insert extra dirs after position 1 (after ~/.pi/baml, before cwd/.pi/baml)
    dirs.splice(2, 0, ...extraDirs);
  }

  for (const dir of dirs) {
    const groups = scanDirectory(dir);
    // Merge: later (higher priority) overwrites earlier
    for (const [group, files] of Object.entries(groups)) {
      merged[group] = files;
    }
  }

  return merged;
}

/** Exported for testing. */
export { getDiscoveryDirs, scanDirectory };
