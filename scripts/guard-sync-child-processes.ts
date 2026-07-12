import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SYNC_CHILD_PROCESS_NAMES = ["execSync", "execFileSync", "spawnSync"] as const;
const SYNC_GIT_HELPERS = [
  "branchExistsLocal",
  "branchExistsOnOrigin",
  "getCurrentBranch",
  "isWorktreeDirty",
  "isGitRepo",
] as const;
const ALLOWLISTED_FILES = new Map([
  // The v1 CLI-only synchronous runner lives here; daemon-reachable code uses AsyncSubprocessRunner.
  ["shared/subprocess.ts", "v1 CLI seam"],
]);

export type GuardViolation = { file: string; line: number; construct: string };
type GuardFile = { file: string; source: string };

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function guarded(file: string): boolean {
  return (
    (file.startsWith("v2/") || file.startsWith("shared/")) &&
    !file.endsWith(".test.ts") &&
    !file.startsWith("v2/src/testing/")
  );
}

function moduleViolations(
  source: string,
  file: string,
  moduleSource: string,
  names: readonly string[],
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const add = (index: number, construct: string) => violations.push({ file, line: lineAt(source, index), construct });
  const namePattern = names.join("|");
  const destructures = [
    [
      new RegExp(`\\bimport\\s+(?:type\\s+)?\\{([\\s\\S]*?)\\}\\s+from\\s*["']${moduleSource}["']`, "g"),
      "static import",
    ],
    [new RegExp(`\\{([\\s\\S]*?)\\}\\s*=\\s*require\\(\\s*["']${moduleSource}["']\\s*\\)`, "g"), "require"],
    [
      new RegExp(`\\{([\\s\\S]*?)\\}\\s*=\\s*await\\s+import\\(\\s*["']${moduleSource}["']\\s*\\)`, "g"),
      "dynamic import",
    ],
  ] as const;
  for (const [pattern, reach] of destructures) {
    for (const match of source.matchAll(pattern)) {
      const name = names.find((candidate) => new RegExp(`\\b${candidate}\\b`).test(match[1] ?? ""));
      if (name) add(match.index, `${name} from ${reach}`);
    }
  }

  const directCall = new RegExp(
    `(?:require|import)\\(\\s*["']${moduleSource}["']\\s*\\)\\s*(?:\\.\\s*(${namePattern})|\\[\\s*["'](${namePattern})["']\\s*\\])\\s*\\(`,
    "g",
  );
  for (const match of source.matchAll(directCall)) {
    add(match.index, `${match[1] ?? match[2]} from module import`);
  }

  const bindings = [
    new RegExp(`\\bimport\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s*["']${moduleSource}["']`, "g"),
    new RegExp(`\\bimport\\s+(\\w+)\\s+from\\s*["']${moduleSource}["']`, "g"),
    new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*require\\(\\s*["']${moduleSource}["']\\s*\\)`, "g"),
    new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*await\\s+import\\(\\s*["']${moduleSource}["']\\s*\\)`, "g"),
  ];
  for (const pattern of bindings) {
    for (const match of source.matchAll(pattern)) {
      const binding = match[1];
      if (!binding) continue;
      const call = new RegExp(
        `\\b${binding}\\s*(?:\\.\\s*(${namePattern})|\\[\\s*["'](${namePattern})["']\\s*\\])\\s*\\(`,
      ).exec(source.slice(match.index));
      if (call) add((match.index ?? 0) + (call.index ?? 0), `${call[1] ?? call[2]} from module binding`);
    }
  }
  return violations;
}

export function findSyncChildProcessViolations(files: readonly GuardFile[]): GuardViolation[] {
  return files.flatMap(({ file, source }) => {
    if (!guarded(file) || ALLOWLISTED_FILES.has(file)) return [];
    const violations = [
      ...moduleViolations(source, file, "node:child_process", SYNC_CHILD_PROCESS_NAMES),
      ...moduleViolations(source, file, "child_process", SYNC_CHILD_PROCESS_NAMES),
      ...moduleViolations(source, file, "(?:.*\\/)?shared\\/subprocess\\.ts", [
        "SubprocessRunner",
        "realSubprocessRunner",
      ]),
      ...moduleViolations(source, file, "(?:.*\\/)?shared\\/git\\.ts", SYNC_GIT_HELPERS),
    ];
    for (const match of source.matchAll(/\bBun\s*(?:\.\s*spawnSync|\[\s*["']spawnSync\s*["']\s*\])\s*\(/g)) {
      violations.push({ file, line: lineAt(source, match.index), construct: "Bun.spawnSync" });
    }
    return violations;
  });
}

function collectFiles(root: string, cwd: string): GuardFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return collectFiles(path, cwd);
    const file = relative(cwd, path);
    return entry.isFile() && /\.tsx?$/.test(file) ? [{ file, source: readFileSync(path, "utf8") }] : [];
  });
}

export function runSyncChildProcessGuard(cwd: string): GuardViolation[] {
  return findSyncChildProcessViolations([
    ...collectFiles(join(cwd, "v2"), cwd),
    ...collectFiles(join(cwd, "shared"), cwd),
  ]);
}

if (import.meta.main) {
  const violations = runSyncChildProcessGuard(process.cwd());
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: ${violation.construct}`);
  if (violations.length > 0) process.exitCode = 1;
}
