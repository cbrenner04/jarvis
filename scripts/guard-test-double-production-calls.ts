import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type GuardViolation = { file: string; line: number; module: string; export: string };
type GuardFile = { file: string; source: string };

// Allowlist of production imports that are permitted in test doubles
const ALLOWLIST = new Set([
  "../cli.ts#main",
  "../persistence/state-store.ts#openStateStore",
  "../daemon/daemon-lifecycle.ts#startDaemon",
  "../daemon/daemon-lifecycle.ts#isProcessAlive",
]);

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

// A production path escapes v2/src/testing, e.g. "../cli.ts" or "../../../shared/helpers.ts"
function isProductionPath(importPath: string): boolean {
  const parts = importPath.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "..") {
      depth++;
    } else if (part !== "." && part !== "") {
      return depth > 0;
    }
  }
  return false;
}

export function findProductionCallViolations(files: readonly GuardFile[]): GuardViolation[] {
  const violations: GuardViolation[] = [];

  for (const { file, source } of files) {
    if (!file.startsWith("v2/src/testing/")) continue;

    // Imported binding name -> production module path
    const importedProductions = new Map<string, string>();

    for (const match of source.matchAll(
      /^(?!import\s+type\s+)import\s+(?:\{([^}]+)\}|([^'"]+))\s+from\s+["']([^"']+)["']/gm,
    )) {
      const namedImports = match[1];
      const defaultImport = match[2];
      const importPath = match[3];

      if (!importPath) continue;
      if (importPath.startsWith("node:") || importPath.startsWith("bun:")) continue;
      if (importPath.startsWith("./")) continue;
      if (!isProductionPath(importPath)) continue;

      if (namedImports) {
        for (const name of namedImports.split(",").map((s) => s.trim())) {
          if (name) importedProductions.set(name, importPath);
        }
      }

      if (defaultImport) {
        const name = defaultImport.trim();
        if (name) importedProductions.set(name, importPath);
      }
    }

    // Calls to imported production bindings, e.g. bindingName(...) or await bindingName(...)
    for (const [bindingName, module] of importedProductions) {
      for (const match of source.matchAll(new RegExp(`\\b${bindingName}\\s*\\(`, "g"))) {
        if (!ALLOWLIST.has(`${module}#${bindingName}`)) {
          violations.push({ file, line: lineAt(source, match.index ?? 0), module, export: bindingName });
        }
      }
    }
  }

  return violations;
}

function collectFiles(root: string, cwd: string): GuardFile[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return collectFiles(path, cwd);
      const file = relative(cwd, path);
      return entry.isFile() && /\.[jt]sx?$/.test(file) ? [{ file, source: readFileSync(path, "utf8") }] : [];
    });
  } catch {
    return [];
  }
}

export function runProductionCallGuard(cwd: string): GuardViolation[] {
  const files = collectFiles(join(cwd, "v2/src/testing"), cwd);
  return findProductionCallViolations(files);
}

if (import.meta.main) {
  const violations = runProductionCallGuard(process.cwd());
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.module}#${violation.export}`);
  }
  if (violations.length > 0) process.exitCode = 1;
}
