import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { isProductionSourceFile, type SourceFile } from "./production-files.ts";

/**
 * Dead-export gate: every export of a v2/src production module must be imported by some other file
 * anywhere in the repo (tests, harness, scripts included). Intentionally public but statically
 * unreferenced surface is allowlisted as `<file>#<symbol>`.
 */
export const DEAD_EXPORT_ALLOWLIST = new Map<string, string>([["v2/src/cli.ts#main", "bin/jarvis entry point"]]);

const REFERENCE_ROOTS = ["v2", "shared", "scripts", "test"] as const;
const NAMESPACE = "*";

export type DeadExport = { file: string; line: number; symbol: string };
export type ModuleSurface = { exports: Map<string, number>; references: Map<string, Set<string>> };

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []));
}

type SpecifierResolver = (importer: string, specifier: string) => string | undefined;

/** Resolves relative import specifiers against the scanned file set (extension-less, `.ts`, `.tsx`, or `index.ts`). */
export function specifierResolver(known: ReadonlySet<string>, cwd: string): SpecifierResolver {
  return (importer, specifier) => {
    if (!specifier.startsWith(".")) return undefined;
    const base = relative(cwd, resolve(cwd, dirname(importer), specifier));
    return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((candidate) => known.has(candidate));
  };
}

function addReference(references: Map<string, Set<string>>, target: string, name: string): void {
  const names = references.get(target) ?? new Set<string>();
  names.add(name);
  references.set(target, names);
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Exports declared by `file` and the names it references from every relative module it imports. */
export function moduleSurface({ file, source }: SourceFile, resolveImport: SpecifierResolver): ModuleSurface {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declared = new Map<string, number>();
  const references = new Map<string, Set<string>>();
  const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const addExport = (name: string | undefined, node: ts.Node) => {
    if (name !== undefined && !declared.has(name)) declared.set(name, lineOf(node));
  };
  const specifierTarget = (specifier: ts.Expression | undefined) =>
    specifier !== undefined && ts.isStringLiteral(specifier) ? resolveImport(file, specifier.text) : undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const target = specifierTarget(statement.moduleSpecifier);
      if (target === undefined) continue;
      const clause = statement.importClause;
      if (clause === undefined) continue;
      if (clause.name !== undefined) addReference(references, target, "default");
      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) addReference(references, target, NAMESPACE);
      else
        for (const element of bindings.elements)
          addReference(references, target, (element.propertyName ?? element.name).text);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const target = specifierTarget(statement.moduleSpecifier);
      const clause = statement.exportClause;
      if (clause === undefined) {
        if (target !== undefined) addReference(references, target, NAMESPACE);
        continue;
      }
      if (ts.isNamespaceExport(clause)) {
        addExport(clause.name.text, statement);
        if (target !== undefined) addReference(references, target, NAMESPACE);
        continue;
      }
      for (const element of clause.elements) {
        addExport(element.name.text, element);
        if (target !== undefined) addReference(references, target, (element.propertyName ?? element.name).text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      addExport("default", statement);
      continue;
    }
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) addExport(name, declaration);
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      const isDefault = (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      addExport(isDefault ? "default" : statement.name?.getText(sourceFile), statement);
    }
  }

  const visitDynamic = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = specifierTarget(node.arguments[0]);
      if (target !== undefined) addReference(references, target, NAMESPACE);
    }
    ts.forEachChild(node, visitDynamic);
  };
  visitDynamic(sourceFile);
  return { exports: declared, references };
}

/** Exports of `v2/src` production modules that no other file imports, minus the allowlist. */
export function findDeadExports(
  files: readonly SourceFile[],
  cwd: string,
  allowlist: ReadonlyMap<string, string> = DEAD_EXPORT_ALLOWLIST,
): DeadExport[] {
  const resolveImport = specifierResolver(new Set(files.map((file) => file.file)), cwd);
  const surfaces = new Map(files.map((file) => [file.file, moduleSurface(file, resolveImport)] as const));
  const referenced = new Map<string, Set<string>>();
  for (const [importer, surface] of surfaces) {
    for (const [target, names] of surface.references) {
      if (target === importer) continue;
      const set = referenced.get(target) ?? new Set<string>();
      for (const name of names) set.add(name);
      referenced.set(target, set);
    }
  }
  const dead: DeadExport[] = [];
  for (const [file, surface] of surfaces) {
    if (!isProductionSourceFile(file) || !file.startsWith("v2/src/")) continue;
    const names = referenced.get(file);
    for (const [symbol, line] of surface.exports) {
      if (names?.has(symbol) || names?.has(NAMESPACE)) continue;
      if (allowlist.has(`${file}#${symbol}`)) continue;
      dead.push({ file, line, symbol });
    }
  }
  return dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function collectFiles(root: string, cwd: string): SourceFile[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : collectFiles(path, cwd);
    const file = relative(cwd, path);
    return entry.isFile() && /\.tsx?$/.test(file) ? [{ file, source: readFileSync(path, "utf8") }] : [];
  });
}

/** Every TypeScript file the reference scan reads: v2, shared, scripts, and root test trees. */
export function collectReferenceSourceFiles(cwd: string): SourceFile[] {
  return REFERENCE_ROOTS.flatMap((root) => collectFiles(join(cwd, root), cwd));
}

export function runDeadExportGuard(cwd: string): DeadExport[] {
  return findDeadExports(collectReferenceSourceFiles(cwd), cwd);
}

if (import.meta.main) {
  const dead = runDeadExportGuard(process.cwd());
  for (const entry of dead) console.error(`${entry.file}:${entry.line}: unreferenced export ${entry.symbol}`);
  if (dead.length > 0) process.exitCode = 1;
}
