import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Word-boundary `v2` token in operator markdown (live-engine branding, not `@v2` action pins). */
export const OPERATOR_DOC_V2_WORD = /\bv2\b/;

const OPERATOR_DOC_IGNORES = ["**/completed/**", "**/verdict-*.md"] as const;

export type OperatorDocV2Violation = { file: string; line: number; text: string };

function matchesIgnore(path: string, ignores: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  for (const pattern of ignores) {
    const glob = new Bun.Glob(pattern);
    if (glob.match(normalized)) {
      return true;
    }
  }
  return false;
}

/** Former nested engine tree paths and directory prose (`v2/src`, `` `v2/` subtrees ``). */
export function isFormerV2DirectoryLayoutLine(line: string): boolean {
  return /\bv2\//.test(line);
}

/** Retired npm script and runner names from before the top-level tree move. */
export function isRetiredPackageScriptTokenLine(line: string): boolean {
  return /test:(?:integration:)?v2|coverage:v2|run-v2-tests/.test(line);
}

/** Explicit `jarvis` vs `jarvis1` coexistence after binary rename. */
export function isJarvisJarvis1CoexistenceLine(line: string): boolean {
  return /\bjarvis1\b/.test(line);
}

/** Frozen-generation contrast naming the retired `v1/` tree alongside v2 history. */
export function isFrozenV1ContrastLine(line: string): boolean {
  return /Frozen\s+`v1\/`/.test(line);
}

export function isAllowedRetiredGenerationHistoryLine(line: string): boolean {
  if (!OPERATOR_DOC_V2_WORD.test(line)) {
    return true;
  }
  return (
    isFormerV2DirectoryLayoutLine(line) ||
    isRetiredPackageScriptTokenLine(line) ||
    isJarvisJarvis1CoexistenceLine(line) ||
    isFrozenV1ContrastLine(line)
  );
}

export function findOperatorDocV2Violations(
  files: ReadonlyArray<{ file: string; source: string }>,
): OperatorDocV2Violation[] {
  const violations: OperatorDocV2Violation[] = [];
  for (const { file, source } of files) {
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (!OPERATOR_DOC_V2_WORD.test(line) || isAllowedRetiredGenerationHistoryLine(line)) {
        continue;
      }
      violations.push({ file, line: index + 1, text: line.trim() });
    }
  }
  return violations;
}

export async function collectOperatorDocCorpusPaths(rootDir: string): Promise<string[]> {
  const paths = new Set<string>();
  const docsGlob = new Bun.Glob("docs/**/*.md");
  for await (const path of docsGlob.scan({ cwd: rootDir, onlyFiles: true })) {
    const normalized = path.replaceAll("\\", "/");
    if (!matchesIgnore(normalized, OPERATOR_DOC_IGNORES)) {
      paths.add(normalized);
    }
  }
  for (const rootFile of ["AGENTS.md", "README.md"] as const) {
    paths.add(rootFile);
  }
  return [...paths].sort();
}

export function runOperatorDocV2LanguageGuard(rootDir: string): Promise<OperatorDocV2Violation[]> {
  return collectOperatorDocCorpusPaths(rootDir).then((paths) => {
    const files = paths.map((file) => ({
      file,
      source: readFileSync(join(rootDir, file), "utf8"),
    }));
    return findOperatorDocV2Violations(files);
  });
}

export function exitCodeForOperatorDocV2Violations(violations: readonly OperatorDocV2Violation[]): number {
  return violations.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  const violations = await runOperatorDocV2LanguageGuard(process.cwd());
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}: operator doc uses live-engine \\bv2\\b (retired-generation history only): ${violation.text}`,
    );
  }
  process.exitCode = exitCodeForOperatorDocV2Violations(violations);
}
