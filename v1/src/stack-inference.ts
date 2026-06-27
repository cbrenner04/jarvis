import { existsSync } from "fs";
import { join } from "path";

/**
 * Infers a project's stack from marker files in its root directory.
 *
 * Detects ecosystems by checking for presence of marker files (not content).
 * When multiple markers exist, resolves to the highest-priority ecosystem.
 * Never throws; returns an explicit unknown label for unrecognized roots.
 *
 * Marker→label priority (first match wins):
 * 1. `bun.lock`/`bun.lockb` + `package.json` → "TypeScript (Bun)"
 * 2. `package.json` (no Bun lockfile) → "JavaScript/TypeScript (Node)"
 * 3. `Gemfile` → "Ruby"
 * 4. `go.mod` → "Go"
 * 5. `pyproject.toml` or `requirements.txt` → "Python"
 * 6. `Cargo.toml` → "Rust"
 * 7. (no markers) → "Unknown"
 *
 * @param rootPath - Absolute path to the project root. Only this directory is
 *   checked; subdirectories are ignored.
 * @returns Display string label for the inferred stack. Contains no structured
 *   metadata—future consumers should extend this function's return type as
 *   richer context is needed, not create wrapper types.
 *
 * Invariants:
 * - Pure: reads only marker files at rootPath, requires no network/git/config.
 * - Deterministic: same rootPath always returns the same label.
 * - Syncronous.
 */
export function inferStackFromRoot(rootPath: string): string {
  // Priority order: Bun > Node > Ruby > Go > Python > Rust
  // Check Bun marker (bun.lock/bun.lockb + package.json)
  if (
    hasFiles(rootPath, ["package.json"]) &&
    hasFiles(rootPath, ["bun.lock", "bun.lockb"])
  ) {
    return "TypeScript (Bun)";
  }

  // Check Node marker (package.json, no Bun lockfile)
  if (hasFiles(rootPath, ["package.json"])) {
    return "JavaScript/TypeScript (Node)";
  }

  // Check Ruby marker
  if (hasFiles(rootPath, ["Gemfile"])) {
    return "Ruby";
  }

  // Check Go marker
  if (hasFiles(rootPath, ["go.mod"])) {
    return "Go";
  }

  // Check Python markers
  if (hasFiles(rootPath, ["pyproject.toml", "requirements.txt"])) {
    return "Python";
  }

  // Check Rust marker
  if (hasFiles(rootPath, ["Cargo.toml"])) {
    return "Rust";
  }

  // No recognized markers
  return "Unknown";
}

/**
 * Check if at least one file from names exists in rootPath.
 * @param rootPath Directory to check.
 * @param names Array of filenames. Returns true if any exist.
 * @returns true if at least one file exists, false otherwise.
 */
function hasFiles(rootPath: string, names: string[]): boolean {
  return names.some((name) => existsSync(join(rootPath, name)));
}
