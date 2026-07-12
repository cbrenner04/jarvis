import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const TARGET_DIRECTORIES = ["v2", "shared"];
const CODE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const SYNC_CHILD_PROCESS_NAMES = ["execSync", "execFileSync", "spawnSync"];
const SYNC_GIT_HELPERS = [
  "branchExistsLocal",
  "branchExistsOnOrigin",
  "getCurrentBranch",
  "isWorktreeDirty",
  "isGitRepo",
];
const ALLOWLISTED_FILES = new Set([
  // v1 CLI sync-runner seam.
  "shared/subprocess.ts",
]);

export type GuardViolation = { file: string; line: number; construct: string };

function isExcluded(file: string): boolean {
  return file.endsWith(".test.ts") || file.startsWith("v2/src/testing/");
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function findNamedImports(
  source: string,
  moduleName: string,
  names: readonly string[],
): Array<{ index: number; name: string }> {
  const escapedModule = moduleName.replaceAll("/", "\\/");
  const expression = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["'](?:\\.\\.?\\/)*${escapedModule}(?:\\.ts)?["']`,
    "g",
  );
  const matches: Array<{ index: number; name: string }> = [];
  for (const match of source.matchAll(expression)) {
    const imported = match[1] ?? "";
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b`).test(imported)) {
        matches.push({ index: match.index ?? 0, name });
      }
    }
  }
  return matches;
}

function findChildProcessModuleBindings(source: string): Array<{ index: number; name: string }> {
  const childProcessModule = "(?:node:)?child_process";
  const expressions = [
    new RegExp(`import\\s*\\*\\s*as\\s*(\\w+)\\s*from\\s*["']${childProcessModule}["']`, "g"),
    new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*require\\(\\s*["']${childProcessModule}["']\\s*\\)`, "g"),
    new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*await\\s+import\\(\\s*["']${childProcessModule}["']\\s*\\)`, "g"),
  ];
  const bindings: Array<{ index: number; name: string }> = [];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      const name = match[1];
      if (name !== undefined) bindings.push({ index: match.index ?? 0, name });
    }
  }
  return bindings;
}

/** Finds synchronous child-process APIs and v2 imports of synchronous seams. */
export function findSynchronousChildProcessViolations(file: string, source: string): GuardViolation[] {
  if (isExcluded(file) || ALLOWLISTED_FILES.has(file)) return [];

  const violations: GuardViolation[] = [];
  const add = (index: number, construct: string): void => {
    violations.push({ file, line: lineNumber(source, index), construct });
  };
  const childProcessModule = "(?:node:)?child_process";
  const childProcessBindings = findChildProcessModuleBindings(source);

  for (const name of SYNC_CHILD_PROCESS_NAMES) {
    const staticImport = new RegExp(
      `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${childProcessModule}["']`,
      "g",
    );
    const requireDestructure = new RegExp(
      `(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require\\(\\s*["']${childProcessModule}["']\\s*\\)`,
      "g",
    );
    const requireMember = new RegExp(`require\\(\\s*["']${childProcessModule}["']\\s*\\)\\s*\\.\\s*${name}\\b`, "g");
    const dynamicMember = new RegExp(
      `await\\s+import\\(\\s*["']${childProcessModule}["']\\s*\\)\\s*\\)?\\s*\\.\\s*${name}\\b`,
      "g",
    );
    const dynamicDestructure = new RegExp(
      `(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*await\\s+import\\(\\s*["']${childProcessModule}["']\\s*\\)`,
      "g",
    );
    for (const expression of [staticImport, requireDestructure, requireMember, dynamicMember, dynamicDestructure]) {
      for (const match of source.matchAll(expression)) add(match.index ?? 0, `${name} from child_process`);
    }
    for (const binding of childProcessBindings) {
      const memberAccess = new RegExp(`\\b${binding.name}\\s*\\.\\s*${name}\\b`, "g");
      for (const match of source.matchAll(memberAccess)) add(match.index ?? 0, `${name} from child_process`);
    }
  }

  for (const match of source.matchAll(/\bBun\s*\.\s*spawnSync\b/g)) {
    add(match.index ?? 0, "Bun.spawnSync");
  }

  if (file.startsWith("v2/")) {
    for (const match of findNamedImports(source, "shared/subprocess", ["SubprocessRunner", "realSubprocessRunner"])) {
      add(match.index, `${match.name} from shared/subprocess.ts`);
    }
    for (const match of findNamedImports(source, "shared/git", SYNC_GIT_HELPERS)) {
      add(match.index, `${match.name} from shared/git.ts`);
    }
  }

  return violations;
}

function walkFiles(root: string, directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile() && CODE_FILE_PATTERN.test(entry.name)) files.push(path);
  }
  return files;
}

export function guardSynchronousChildProcessCalls(root: string): GuardViolation[] {
  return TARGET_DIRECTORIES.flatMap((directory) =>
    walkFiles(root, directory).flatMap((path) => {
      const file = relative(root, join(root, path));
      return findSynchronousChildProcessViolations(file, readFileSync(join(root, path), "utf8"));
    }),
  );
}

if (import.meta.main) {
  const violations = guardSynchronousChildProcessCalls(process.cwd());
  for (const violation of violations) {
    process.stderr.write(
      `${violation.file}:${violation.line}: synchronous child-process guard: ${violation.construct}\n`,
    );
  }
  if (violations.length > 0) process.exitCode = 1;
}
