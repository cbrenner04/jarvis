import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectProductionSourceFiles,
  isProductionSourceFile,
  isTestSupportImport,
  type SourceFile,
  TEST_SUPPORT_SUFFIX,
} from "./production-files.ts";

export type GuardViolation = { file: string; line: number; specifier: string };

const IMPORT_SPECIFIERS = [
  /\bimport\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bexport\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
];

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Production modules must not import `*.test-support.ts`; support code is test-only. */
export function findTestSupportImportViolations(files: readonly SourceFile[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const { file, source } of files) {
    if (!isProductionSourceFile(file)) continue;
    for (const pattern of IMPORT_SPECIFIERS) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier !== undefined && isTestSupportImport(specifier)) {
          violations.push({ file, line: lineAt(source, match.index), specifier });
        }
      }
    }
  }
  return violations;
}

/** The v2 typecheck project excludes test-support files from its production compilation glob. */
export function tsconfigExcludesTestSupport(cwd: string): boolean {
  const config = JSON.parse(readFileSync(join(cwd, "v2/tsconfig.json"), "utf8")) as { exclude?: unknown };
  return Array.isArray(config.exclude) && config.exclude.includes(`src/**/*${TEST_SUPPORT_SUFFIX}`);
}

export function runTestSupportImportGuard(cwd: string): GuardViolation[] {
  return findTestSupportImportViolations(collectProductionSourceFiles(cwd));
}

if (import.meta.main) {
  const cwd = process.cwd();
  const violations = runTestSupportImportGuard(cwd);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: production import of ${violation.specifier}`);
  }
  if (!tsconfigExcludesTestSupport(cwd)) {
    console.error(`v2/tsconfig.json: missing exclude for src/**/*${TEST_SUPPORT_SUFFIX}`);
    process.exitCode = 1;
  }
  if (violations.length > 0) process.exitCode = 1;
}
