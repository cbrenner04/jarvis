import { join } from "node:path";
import { collectSourceFiles, isProductionSourceFile, type SourceFile } from "./production-files.ts";

/** Forbid inline `runAsync("git"|"gh", …)` in v2 production code except `github-operations.ts` `gh`; escape with `// guard-git-spawn-bypass: <reason>` on the spawn line or above. */
export const ALLOW_MARKER = "guard-git-spawn-bypass:";
export const GH_OWNER_FILE = "src/execution/github-operations.ts";
/** The Git boundary itself (moved under v2/src): the one place that may spawn `git`. */
export const GIT_OWNER_DIR = "src/shared/";

export type GitSpawnBypassViolation = { file: string; line: number; command: "git" | "gh" };

const RUN_ASYNC_COMMAND = /\.runAsync\s*\(\s*["'](git|gh)["']/g;

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function allowedByMarker(lines: readonly string[], line: number): boolean {
  return [lines[line - 1], lines[line - 2]].some((text) => text?.includes(ALLOW_MARKER) === true);
}

function isAllowedGhOwner(file: string, command: string): boolean {
  return command === "gh" && file === GH_OWNER_FILE;
}

export function findGitSpawnBypassViolations(files: readonly SourceFile[]): GitSpawnBypassViolation[] {
  return files.flatMap(({ file, source }) => {
    if (!isProductionSourceFile(file) || !file.startsWith("src/") || file.startsWith(GIT_OWNER_DIR)) return [];
    const lines = source.split("\n");
    const violations: GitSpawnBypassViolation[] = [];
    for (const match of source.matchAll(RUN_ASYNC_COMMAND)) {
      const command = match[1] as "git" | "gh";
      const line = lineAt(source, match.index);
      if (allowedByMarker(lines, line) || isAllowedGhOwner(file, command)) continue;
      violations.push({ file, line, command });
    }
    return violations;
  });
}

export function runGitSpawnBypassGuard(cwd: string): GitSpawnBypassViolation[] {
  return findGitSpawnBypassViolations(collectSourceFiles(join(cwd, "src"), cwd));
}

export function exitCodeForGitSpawnBypassViolations(violations: readonly GitSpawnBypassViolation[]): number {
  return violations.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  const violations = runGitSpawnBypassGuard(process.cwd());
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}: inline runAsync("${violation.command}") (use shared/git or github-operations, or mark \`// ${ALLOW_MARKER} <reason>\`)`,
    );
  }
  process.exitCode = exitCodeForGitSpawnBypassViolations(violations);
}
