import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type GuardViolation = { file: string; line: number; module: string; exportName: string };
type GuardFile = { file: string; source: string };

const ALLOWED_CALLS = new Set([
  "../cli.ts#main",
  "../persistence/state-store.ts#openStateStore",
  "../daemon/daemon-lifecycle.ts#startDaemon",
  "../daemon/daemon-lifecycle.ts#isProcessAlive",
]);

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function isProductionModule(modulePath: string, fromFile: string): boolean {
  // Production modules are those outside v2/src/testing/
  // modulePath is a relative path like ../cli.ts or ../../../shared/something.ts
  // Callers only invoke this for files already under v2/src/testing/.
  const fileDirParts = fromFile.split("/").slice(0, -1);
  const moduleParts = modulePath.split("/");
  const resolvedParts = [...fileDirParts];

  for (const part of moduleParts) {
    if (part === ".." || part === ".") {
      if (part === "..") resolvedParts.pop();
    } else {
      resolvedParts.push(part);
    }
  }

  const resolvedPath = resolvedParts.join("/");

  // It's a production module if it doesn't contain "testing" or if it's in shared/
  return !resolvedPath.includes("testing");
}

function parseImports(source: string): Map<string, string> {
  const valueImports = new Map<string, string>(); // localName -> modulePath#exportName

  // Match: import { name } from "path" (but not import type)
  // Also match: import { name as alias } from "path"
  for (const match of source.matchAll(/^import\s+(?!type\s+)([^;]+)\s+from\s+["']([^"']+)["']/gm)) {
    const importSpec = match[1];
    const modulePath = match[2];

    // Skip node: and bun: imports
    if (modulePath.startsWith("node:") || modulePath.startsWith("bun:")) continue;

    // Skip sibling imports (./)
    if (modulePath.startsWith("./")) continue;

    // Parse the import spec: could be:
    // - name
    // - name as alias
    // - { name } or { name as alias }
    // - { name, other } or { name as alias, other as other2 }
    const bindingMatches = [...importSpec.matchAll(/\b(\w+)(?:\s+as\s+(\w+))?\b/g)];

    for (const bindingMatch of bindingMatches) {
      const exportName = bindingMatch[1];
      const localName = bindingMatch[2] || bindingMatch[1];
      valueImports.set(localName, `${modulePath}#${exportName}`);
    }
  }

  return valueImports;
}

function findCallViolations(
  source: string,
  valueImports: Map<string, string>,
  file: string,
  allowedCalls: Set<string>,
): GuardViolation[] {
  const violations: GuardViolation[] = [];

  // For each value import, find calls to it
  for (const [localName, moduleExport] of valueImports) {
    // Skip if this call is allowed
    if (allowedCalls.has(moduleExport)) continue;

    // Match: localName( or localName (with optional whitespace)
    // Also handle: localName. (property access, which would make it not a call by itself)
    const pattern = new RegExp(`\\b${localName}\\s*\\(`, "g");

    for (const match of source.matchAll(pattern)) {
      violations.push({
        file,
        line: lineAt(source, match.index ?? 0),
        module: moduleExport.split("#")[0],
        exportName: moduleExport.split("#")[1],
      });
    }
  }

  return violations;
}

export function findProductionCallViolations(files: readonly GuardFile[]): GuardViolation[] {
  const violations: GuardViolation[] = [];

  for (const { file, source } of files) {
    // Only scan testing files
    if (!file.includes("testing")) continue;

    const valueImports = parseImports(source);

    // Filter to only production module imports
    const productionImports = new Map<string, string>();
    for (const [localName, moduleExport] of valueImports) {
      const modulePath = moduleExport.split("#")[0];
      if (isProductionModule(modulePath, file)) {
        productionImports.set(localName, moduleExport);
      }
    }

    // Find violations
    const fileViolations = findCallViolations(source, productionImports, file, ALLOWED_CALLS);
    violations.push(...fileViolations);
  }

  return violations;
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

export function runProductionCallGuard(cwd: string): GuardViolation[] {
  const files = collectFiles(join(cwd, "v2/src/testing"), cwd);
  return findProductionCallViolations(files);
}

if (import.meta.main) {
  const violations = runProductionCallGuard(process.cwd());
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.module}#${violation.exportName}`);
  }
  if (violations.length > 0) process.exitCode = 1;
}
