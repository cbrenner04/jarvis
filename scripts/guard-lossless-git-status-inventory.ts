import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LosslessGitStatusGuardFile = { file: string; source: string };
export type LosslessGitStatusGuardViolation = { file: string; line: number; construct: string };

export const LOSSLESS_GIT_STATUS_CONSUMER_FILES = [
  "v2/src/execution/review-intent-enforcement.ts",
  "v2/src/execution/completion-commit.ts",
  "v2/src/execution/write-loop.ts",
  "v2/src/commands/cleanup.ts",
] as const;

const CONSUMER_FILES = new Set<string>(LOSSLESS_GIT_STATUS_CONSUMER_FILES);
const EXEMPTIONS = new Map<string, string>([
  // Add only an inventoried file and a durable reason.
]);
const PORCELAIN_STATUS_COMMAND =
  /(?:["']status["'][\s\S]{0,200}["']--porcelain(?:=v1)?["']|["']--porcelain(?:=v1)?["'][\s\S]{0,200}["']status["']|\bgit\s+status\b[^\n]*--porcelain(?:=v1)?\b)/;

const FORBIDDEN_CONSTRUCTS = [
  {
    construct: "newline path-record splitting",
    pattern: /\.split\(\s*(?:["']\\n["']|\/\\r\?\\n\/[dgimsuvy]*)\s*\)/g,
  },
  {
    construct: "status-prefix slicing",
    pattern: /\.\s*(?:slice|substring)\(\s*(?:0\s*,\s*[23]|[23])\s*\)/g,
  },
  {
    construct: "rename-arrow slicing",
    pattern: /\.\s*(?:(?:lastIndexOf|indexOf|split)\(\s*["']\s*->\s*["']\s*\)|slice\(\s*\w*arrow\w*\s*\+\s*\d+\s*\))/gi,
  },
  {
    construct: "path trimming",
    pattern: /(?:\b(?:\w*path\w*|line\w*)|\.\s*slice\([^)]*\))\s*\.\s*trim\(\)/gi,
  },
] as const;

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export function findLosslessGitStatusInventoryViolations(
  files: readonly LosslessGitStatusGuardFile[],
): LosslessGitStatusGuardViolation[] {
  return files.flatMap(({ file, source }) => {
    if (!CONSUMER_FILES.has(file) || EXEMPTIONS.has(file) || !PORCELAIN_STATUS_COMMAND.test(source)) return [];
    return FORBIDDEN_CONSTRUCTS.flatMap(({ construct, pattern }) =>
      [...source.matchAll(pattern)].map((match) => ({ file, line: lineAt(source, match.index), construct })),
    );
  });
}

export function runLosslessGitStatusInventoryGuard(cwd: string): LosslessGitStatusGuardViolation[] {
  for (const [file, reason] of EXEMPTIONS) {
    if (!CONSUMER_FILES.has(file) || reason.trim().length === 0) {
      return [{ file, line: 1, construct: "invalid undocumented exemption" }];
    }
  }
  return findLosslessGitStatusInventoryViolations(
    LOSSLESS_GIT_STATUS_CONSUMER_FILES.map((file) => ({ file, source: readFileSync(join(cwd, file), "utf8") })),
  );
}

if (import.meta.main) {
  const violations = runLosslessGitStatusInventoryGuard(process.cwd());
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.construct}`);
  }
  if (violations.length > 0) process.exitCode = 1;
}
