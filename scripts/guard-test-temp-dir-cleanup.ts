import { join } from "node:path";
import { collectSourceFiles, isTestCodePath, type SourceFile } from "./production-files.ts";

export type TempDirViolation = { file: string; line: number };

/** The one module allowed to call `mkdtemp`/`mkdtempSync` directly: it registers every dir for removal. */
export const TRACKED_TEMP_DIR_MODULE = "shared/tracked-temp-dir.test-support.ts";

/** Test code: test files, `*.test-support.ts`, the v2 test harness, and the bun test preload. */
export function isTestTempDirScope(file: string): boolean {
  return isTestCodePath(file) || file.startsWith("v2/src/testing/") || file === "test/setup-fake-agents.ts";
}

/** Blanks comments and single-line string literals, keeping line numbers. */
function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

/** Direct `mkdtemp(`/`mkdtempSync(` calls in test code; those dirs are never registered for cleanup. */
export function findUntrackedTempDirs(files: readonly SourceFile[]): TempDirViolation[] {
  const violations: TempDirViolation[] = [];
  for (const { file, source } of files) {
    if (file === TRACKED_TEMP_DIR_MODULE || !isTestTempDirScope(file)) continue;
    const text = stripCommentsAndStrings(source);
    for (const match of text.matchAll(/(?<![\w$])mkdtemp(?:Sync)?\s*\(/g)) {
      violations.push({ file, line: text.slice(0, match.index).split("\n").length });
    }
  }
  return violations;
}

if (import.meta.main) {
  const cwd = process.cwd();
  const files = ["v2", "shared", "test", "scripts"].flatMap((root) => collectSourceFiles(join(cwd, root), cwd));
  const violations = findUntrackedTempDirs(files);
  for (const { file, line } of violations) {
    console.error(`${file}:${line}: test temp dir without registered cleanup; use ${TRACKED_TEMP_DIR_MODULE}`);
  }
  process.exitCode = violations.length > 0 ? 1 : 0;
}
