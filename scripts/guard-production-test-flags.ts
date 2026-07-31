import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

export type GuardViolation = { file: string; line: number; shape: string };
type GuardFile = { file: string; source: string };

const SKIPPED_PATHS = new Set(["shared/prompts/step-rules.ts"]);
const SCAN_ROOTS = ["v2/src", "v1/src", "shared"] as const;

const SHAPES = {
  setInvertExport: "setInvert*ForTest export",
  invertModuleVariable: "invert*ForTest module variable",
  invertParameter: "invert* parameter",
  invertTypeMember: "invert*ForTest type member",
} as const;

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export function isTestFile(file: string): boolean {
  return basename(file).includes(".test.");
}

export function shouldScanFile(file: string): boolean {
  if (!SCAN_ROOTS.some((root) => file.startsWith(`${root}/`))) return false;
  if (SKIPPED_PATHS.has(file)) return false;
  if (isTestFile(file)) return false;
  return /\.tsx?$/.test(file);
}

function paramsContainInvert(params: string): boolean {
  return /\binvert\w*\b/.test(params);
}

function findSetInvertExportViolations(source: string, file: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+(setInvert\w+ForTest)\b/g,
    /\bexport\s+(?:const|let|var)\s+(setInvert\w+ForTest)\b/g,
    /\bexport\s*\{[^}]*\b(setInvert\w+ForTest)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      violations.push({ file, line: lineAt(source, match.index ?? 0), shape: SHAPES.setInvertExport });
    }
  }
  return violations;
}

function findInvertModuleVariableViolations(source: string, file: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const match of source.matchAll(/^(?:export\s+)?(?:const|let|var)\s+(invert\w+ForTest)\b/gm)) {
    violations.push({ file, line: lineAt(source, match.index ?? 0), shape: SHAPES.invertModuleVariable });
  }
  return violations;
}

function findInvertParameterViolations(source: string, file: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const signaturePatterns = [
    /\bfunction\s*(?:\w+\s*)?\(([^)]*)\)/g,
    /\bconstructor\s*\(([^)]*)\)/g,
    /\b(?:public|private|protected|readonly|async\s+)*\w+\s*\(([^)]*)\)\s*(?::[^{;]*)?\s*\{/g,
    /\(([^)]*)\)\s*=>/g,
  ];
  for (const pattern of signaturePatterns) {
    for (const match of source.matchAll(pattern)) {
      const params = match[1] ?? "";
      if (paramsContainInvert(params)) {
        violations.push({ file, line: lineAt(source, match.index ?? 0), shape: SHAPES.invertParameter });
      }
    }
  }
  return violations;
}

function findInvertTypeMemberViolations(source: string, file: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const patterns = [
    /\binterface\s+[\w<>,\s]*\{[^}]*\b(invert\w+ForTest)\s*\??:/g,
    /\btype\s+[\w<>,\s=`]*\{[^}]*\b(invert\w+ForTest)\s*\??:/g,
    /<[^>]*\b(invert\w+ForTest)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      violations.push({ file, line: lineAt(source, match.index ?? 0), shape: SHAPES.invertTypeMember });
    }
  }
  return violations;
}

function dedupeViolations(violations: GuardViolation[]): GuardViolation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.line}:${violation.shape}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findProductionInvertHookViolations(files: readonly GuardFile[]): GuardViolation[] {
  return files.flatMap(({ file, source }) => {
    if (!shouldScanFile(file)) return [];
    return dedupeViolations([
      ...findSetInvertExportViolations(source, file),
      ...findInvertModuleVariableViolations(source, file),
      ...findInvertParameterViolations(source, file),
      ...findInvertTypeMemberViolations(source, file),
    ]);
  });
}

function collectFiles(root: string, cwd: string): GuardFile[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return collectFiles(path, cwd);
      const file = relative(cwd, path);
      return entry.isFile() && /\.tsx?$/.test(file) ? [{ file, source: readFileSync(path, "utf8") }] : [];
    });
  } catch {
    return [];
  }
}

export function runProductionInvertHookGuard(cwd: string): GuardViolation[] {
  return findProductionInvertHookViolations(SCAN_ROOTS.flatMap((root) => collectFiles(join(cwd, root), cwd)));
}

if (import.meta.main) {
  const violations = runProductionInvertHookGuard(process.cwd());
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.shape}`);
  }
  if (violations.length > 0) process.exitCode = 1;
}
