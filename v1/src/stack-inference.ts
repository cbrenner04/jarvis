import { existsSync } from "node:fs";
import { join } from "node:path";

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
 * - Synchronous.
 */
export function inferStackFromRoot(rootPath: string): string {
  if (hasFiles(rootPath, ["package.json"]) && hasFiles(rootPath, ["bun.lock", "bun.lockb"])) {
    return "TypeScript (Bun)";
  }
  if (hasFiles(rootPath, ["package.json"])) {
    return "JavaScript/TypeScript (Node)";
  }
  if (hasFiles(rootPath, ["Gemfile"])) {
    return "Ruby";
  }
  if (hasFiles(rootPath, ["go.mod"])) {
    return "Go";
  }
  if (hasFiles(rootPath, ["pyproject.toml", "requirements.txt"])) {
    return "Python";
  }
  if (hasFiles(rootPath, ["Cargo.toml"])) {
    return "Rust";
  }
  return "Unknown";
}

function hasFiles(rootPath: string, names: string[]): boolean {
  return names.some((name) => existsSync(join(rootPath, name)));
}
