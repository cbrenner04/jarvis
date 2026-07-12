import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { isGitRepo } from "../../../shared/git.ts";
import { validateIntentStage } from "../../../shared/intent-stage.ts";

export type IntentOutputConfig = {
  durableDir: string;
};

export type IntentOutputResult = { specPath: string; files: string[] };

/** Relative file paths currently present under `worktreePath`, excluding `.git`. */
function listFiles(worktreePath: string, dir: string = worktreePath, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(worktreePath, full, out);
    } else if (entry.isFile()) {
      out.push(relative(worktreePath, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

function changedPaths(worktreePath: string, baseRef: string): string[] {
  if (isGitRepo(worktreePath)) {
    try {
      const status = execFileSync("git", ["status", "--short", "--untracked-files=all"], {
        cwd: worktreePath,
        encoding: "utf8",
      });
      return status
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
    } catch {
      try {
        return execFileSync("git", ["diff", "--name-only", baseRef, "--"], {
          cwd: worktreePath,
          encoding: "utf8",
        })
          .split("\n")
          .filter(Boolean);
      } catch {
        // fall through to a plain filesystem listing
      }
    }
  }
  return existsSync(worktreePath) ? listFiles(worktreePath) : [];
}

function failure(message: string): never {
  throw new Error(`${message}; rerun to retry pre-publication`);
}

function worktreeRelativePath(worktreePath: string, absolutePath: string): string {
  return relative(worktreePath, absolutePath).replace(/\\/g, "/");
}

function ownershipPath(worktreePath: string): string {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: worktreePath, encoding: "utf8" }).trim();
    return join(resolve(worktreePath, gitDir), "jarvis-intent-output.json");
  } catch {
    return join(worktreePath, ".jarvis-intent-output.json");
  }
}

function readOwnership(path: string): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

/** Validate and transactionally land an intent step's complete staged output. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation and rollback are one filesystem boundary.
export function landIntentWorkflowOutput(input: {
  worktreePath: string;
  baseRef: string;
  output: IntentOutputConfig;
  warn?: (message: string) => void;
  invocationId?: string;
}): IntentOutputResult {
  const stageDir = join(input.worktreePath, ".jarvis-intent-stage");
  const durableDir = resolve(input.worktreePath, input.output.durableDir);
  const ownershipFile = ownershipPath(input.worktreePath);
  const ownership = readOwnership(ownershipFile);
  const ownedFiles = input.invocationId === undefined ? [] : (ownership[input.invocationId] ?? []);
  if (!existsSync(stageDir) && ownedFiles.length > 0) {
    return { specPath: worktreeRelativePath(input.worktreePath, durableDir), files: ownedFiles };
  }
  if (!existsSync(stageDir) || !statSync(stageDir).isDirectory()) {
    failure("intent: .jarvis-intent-stage is missing");
  }

  const stagedNames = readdirSync(stageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
  const durablePrefix = `${relative(input.worktreePath, durableDir).replace(/\\/g, "/").replace(/\/$/, "")}/`;
  const ownershipRelPath = relative(input.worktreePath, ownershipFile).replace(/\\/g, "/");
  const allPaths = changedPaths(input.worktreePath, input.baseRef);
  const rogue = allPaths.filter((path) => {
    if (path === ".jarvis-intent-stage" || path.startsWith(".jarvis-intent-stage/")) return false;
    if (path === ownershipRelPath) return false;
    if (path.startsWith(durablePrefix)) {
      const name = path.slice(durablePrefix.length);
      return !(stagedNames.includes(name) || ownedFiles.includes(name));
    }
    return true;
  });
  if (rogue.length > 0) failure(`intent: splitter wrote outside .jarvis-intent-stage/: ${rogue.join(", ")}`);
  const paths = allPaths.filter((path) => path === ".jarvis-intent-stage" || path.startsWith(".jarvis-intent-stage/"));
  const validation = validateIntentStage(stageDir, paths, input.warn ?? (() => undefined));
  if (!validation.ok) failure(validation.error);

  const files = validation.intents.map((intent) => basename(intent.path));
  const backups = new Map<string, string>();
  const created: string[] = [];
  const backupDir = join(input.worktreePath, `.jarvis-intent-backup-${crypto.randomUUID()}`);
  const durableDirExisted = existsSync(durableDir);
  try {
    mkdirSync(durableDir, { recursive: true });
    for (const file of files) {
      const source = join(stageDir, file);
      const destination = join(durableDir, file);
      if (existsSync(destination)) {
        if (!ownedFiles.includes(file) || readFileSync(source).compare(readFileSync(destination)) !== 0) {
          failure(`intent: ready-intents/${file} already exists with different contents`);
        }
        continue;
      }
      created.push(destination);
    }

    mkdirSync(backupDir, { recursive: true });
    for (const destination of created) {
      const file = basename(destination);
      copyFileSync(join(stageDir, file), destination);
      backups.set(destination, join(backupDir, file));
    }
    if (input.invocationId !== undefined) {
      writeOwnership(ownershipFile, { ...ownership, [input.invocationId]: files });
    }
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
    return { specPath: worktreeRelativePath(input.worktreePath, durableDir), files };
  } catch (error) {
    for (const destination of created) rmSync(destination, { force: true });
    for (const [destination, backup] of backups) {
      if (existsSync(backup)) copyFileSync(backup, destination);
    }
    if (!durableDirExisted) rmSync(durableDir, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
    if (error instanceof Error) throw error;
    failure(String(error));
  }
}

function writeOwnership(path: string, ownership: Record<string, string[]>): void {
  writeFileSync(path, `${JSON.stringify(ownership)}\n`, "utf8");
}
