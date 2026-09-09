import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import ts from "typescript";

export type GuardViolation = { file: string; line: number; shape: string };
type GuardFile = { file: string; source: string };

const SKIPPED_PATHS = new Set(["shared/prompts/step-rules.ts"]);
const SCAN_ROOTS = ["v2/src", "shared"] as const;

const SHAPES = {
  setInvertExport: "setInvert*ForTest export",
  setForTestExport: "set*ForTest export",
  forTestExport: "*ForTest export",
  invertModuleVariable: "invert*ForTest module variable",
  forTestModuleVariable: "*ForTest module variable",
  invertParameter: "invert* parameter",
  forTestParameter: "*ForTest parameter",
  invertTypeMember: "invert*ForTest type member",
  forTestTypeMember: "*ForTest type member",
} as const;

const FOR_TEST_SUFFIX = /ForTests?$/;
const INVERT_FOR_TEST = /^invert\w+ForTest$/;
const INVERT_PREFIX = /^invert/;

export function isTestFile(file: string): boolean {
  return basename(file).includes(".test.");
}

export function shouldScanFile(file: string): boolean {
  if (!SCAN_ROOTS.some((root) => file.startsWith(`${root}/`))) return false;
  if (SKIPPED_PATHS.has(file)) return false;
  if (isTestFile(file)) return false;
  return /\.tsx?$/.test(file);
}

function declaredName(name: ts.Node | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function exportShape(name: string): string | undefined {
  if (!FOR_TEST_SUFFIX.test(name)) return undefined;
  if (/^setInvert\w+ForTest$/.test(name)) return SHAPES.setInvertExport;
  if (name.startsWith("set")) return SHAPES.setForTestExport;
  return SHAPES.forTestExport;
}

function moduleVariableShape(name: string): string | undefined {
  if (!FOR_TEST_SUFFIX.test(name)) return undefined;
  return INVERT_FOR_TEST.test(name) ? SHAPES.invertModuleVariable : SHAPES.forTestModuleVariable;
}

function parameterShape(name: string): string | undefined {
  if (INVERT_PREFIX.test(name)) return SHAPES.invertParameter;
  return FOR_TEST_SUFFIX.test(name) ? SHAPES.forTestParameter : undefined;
}

function typeMemberShape(name: string): string | undefined {
  if (!FOR_TEST_SUFFIX.test(name)) return undefined;
  return INVERT_FOR_TEST.test(name) ? SHAPES.invertTypeMember : SHAPES.forTestTypeMember;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

type Collector = { report: (node: ts.Node, shape: string | undefined) => void };

function collectExportViolations(node: ts.Node, collector: Collector): void {
  if (ts.isFunctionDeclaration(node) && hasExportModifier(node)) {
    collector.report(node, exportShape(declaredName(node.name) ?? ""));
    return;
  }
  if (ts.isVariableStatement(node) && hasExportModifier(node)) {
    for (const declaration of node.declarationList.declarations) {
      collector.report(declaration, exportShape(declaredName(declaration.name) ?? ""));
    }
    return;
  }
  if (ts.isExportDeclaration(node) && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
    for (const specifier of node.exportClause.elements) {
      collector.report(specifier, exportShape(specifier.name.text));
    }
  }
}

function collectModuleVariableViolations(node: ts.Node, collector: Collector): void {
  if (!ts.isVariableStatement(node) || !ts.isSourceFile(node.parent)) return;
  for (const declaration of node.declarationList.declarations) {
    collector.report(declaration, moduleVariableShape(declaredName(declaration.name) ?? ""));
  }
}

function collectParameterViolations(node: ts.Node, collector: Collector): void {
  if (!ts.isParameter(node)) return;
  const name = declaredName(node.name);
  if (name !== undefined) collector.report(node, parameterShape(name));
}

function collectTypeMemberViolations(node: ts.Node, collector: Collector): void {
  if (!(ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isMethodSignature(node))) return;
  const name = declaredName(node.name);
  if (name !== undefined) collector.report(node, typeMemberShape(name));
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Walk one production source file's declarations; a mere mention (type reference, property access, condition) is never a declaration. */
function findFileViolations(file: string, source: string): GuardViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const violations: GuardViolation[] = [];
  const seen = new Set<string>();
  const collector: Collector = {
    report: (node, shape) => {
      if (shape === undefined) return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const key = `${line}:${shape}`;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({ file, line, shape });
    },
  };
  const walk = (node: ts.Node): void => {
    collectExportViolations(node, collector);
    collectModuleVariableViolations(node, collector);
    collectParameterViolations(node, collector);
    collectTypeMemberViolations(node, collector);
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return violations.sort((a, b) => a.line - b.line);
}

export function findProductionInvertHookViolations(files: readonly GuardFile[]): GuardViolation[] {
  return files.flatMap(({ file, source }) => (shouldScanFile(file) ? findFileViolations(file, source) : []));
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

/** Every file the guard scans under `cwd`, so a meta-test can enumerate candidates over the same corpus. */
export function collectProductionSourceFiles(cwd: string): GuardFile[] {
  return SCAN_ROOTS.flatMap((root) => collectFiles(join(cwd, root), cwd)).filter(({ file }) => shouldScanFile(file));
}

export function runProductionInvertHookGuard(cwd: string): GuardViolation[] {
  return findProductionInvertHookViolations(collectProductionSourceFiles(cwd));
}

if (import.meta.main) {
  const violations = runProductionInvertHookGuard(process.cwd());
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.shape}`);
  }
  if (violations.length > 0) process.exitCode = 1;
}
