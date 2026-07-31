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
import { basename, dirname, join, relative, resolve } from "node:path";
import { isGitRepoAsync } from "../../../shared/git.ts";
import { validateIntentStage } from "../../../shared/intent-stage.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";

export type IntentOutputConfig = {
  durableDir: string;
};

export type IntentOutputResult = {
  specPath: string;
  files: string[];
  downstreamInputs?: string[];
};

export type IntentPipelineHandoff = Pick<IntentOutputResult, "specPath" | "downstreamInputs">;

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

export function intentStageModifiedPaths(allPaths: readonly string[]): string[] {
  return allPaths.filter((path) => path === ".jarvis-intent-stage" || path.startsWith(".jarvis-intent-stage/"));
}

/** Worktree-relative paths changed since `baseRef` (or full listing when git is unavailable). */
export async function listWorktreeChangedPaths(
  worktreePath: string,
  baseRef: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string[]> {
  if (await isGitRepoAsync(worktreePath)) {
    try {
      const status = await runner.runAsync("git", ["status", "--short", "--untracked-files=all"], worktreePath);
      return status
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
    } catch {
      try {
        return (await runner.runAsync("git", ["diff", "--name-only", baseRef, "--"], worktreePath))
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

export function intentPublicationSpecPath(worktreePath: string, durableDir: string): string {
  return relative(worktreePath, resolve(worktreePath, durableDir)).replace(/\\/g, "/");
}

/** Pipeline handoff for intent landing: one file → file `specPath`; N≥2 → directory `specPath` plus per-file `downstreamInputs`. */
export function intentPipelineHandoff(
  worktreePath: string,
  durableDir: string,
  files: readonly string[],
): IntentPipelineHandoff {
  const durableRel = intentPublicationSpecPath(worktreePath, durableDir).replace(/\/$/, "");
  // Mutation checkpoint: intent-output.test.ts multi-file downstreamInputs
  if (files.length >= 2) {
    return {
      specPath: durableRel,
      downstreamInputs: files.map((file) => `${durableRel}/${file}`),
    };
  }
  if (files.length === 1) {
    return { specPath: `${durableRel}/${files[0]}` };
  }
  return { specPath: durableRel };
}

/** Worktree-relative handoff path: one landed file → file; otherwise the durable directory. */
export function intentHandoffSpecPath(worktreePath: string, durableDir: string, files: string[]): string {
  // Mutation checkpoint: making the single-file branch of `intentPipelineHandoff` return the
  // durable directory instead of the landed file must turn the single-file handoff tests RED.
  return intentPipelineHandoff(worktreePath, durableDir, files).specPath;
}

function landingResult(worktreePath: string, durableDir: string, files: string[]): IntentOutputResult {
  return { files, ...intentPipelineHandoff(worktreePath, durableDir, files) };
}

/** Configured durable ready-intents directory from a file- or directory-shaped handoff path. */
export function configuredIntentDurableDir(worktreePath: string, handoffSpecPath: string): string {
  const resolved = resolve(worktreePath, handoffSpecPath);
  let isFile = false;
  try {
    isFile = statSync(resolved).isFile();
  } catch {
    // missing path — treat as directory handoff
  }
  // Mutation checkpoint: inverting `isFile` here must turn the resume-context durableDir test RED.
  if (isFile) return relative(worktreePath, dirname(resolved)).replace(/\\/g, "/");
  return handoffSpecPath;
}

async function ownershipPath(
  worktreePath: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  try {
    const gitDir = (await runner.runAsync("git", ["rev-parse", "--git-dir"], worktreePath)).trim();
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

/** Owned intent filenames for an invocation; empty when ownership is unresolved. */
export async function listLandedIntentFiles(
  worktreePath: string,
  invocationId?: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string[]> {
  if (invocationId === undefined) return [];
  const ownershipFile = await ownershipPath(worktreePath, runner);
  const owned = readOwnership(ownershipFile)[invocationId] ?? [];
  return [...owned].sort();
}

const INTENT_REVIEW_VERDICT_PATH = ".jarvis-intent-review-verdict.md";
const INTENT_REVIEW_VERDICT_OWNER_PATH = `${INTENT_REVIEW_VERDICT_PATH}.owner`;

/** Worktree-relative paths changed outside the intent stage that deferred landing rejects. */
export async function findIntentLandingRoguePaths(input: {
  worktreePath: string;
  baseRef: string;
  stagingDir: string;
  durableDir: string;
  invocationId?: string;
  runner?: AsyncSubprocessRunner;
}): Promise<string[]> {
  const runner = input.runner ?? realAsyncSubprocessRunner;
  const stageRel = input.stagingDir.replace(/\/$/, "");
  const stageDir = join(input.worktreePath, stageRel);
  if (!existsSync(stageDir) || !statSync(stageDir).isDirectory()) {
    return [];
  }
  const stagedNames = readdirSync(stageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
  const durableResolved = resolve(input.worktreePath, input.durableDir);
  const durablePrefix = `${relative(input.worktreePath, durableResolved).replace(/\\/g, "/").replace(/\/$/, "")}/`;
  const ownershipFile = await ownershipPath(input.worktreePath, runner);
  const ownership = readOwnership(ownershipFile);
  const ownedFiles = input.invocationId === undefined ? [] : (ownership[input.invocationId] ?? []);
  const ownershipRelPath = relative(input.worktreePath, ownershipFile).replace(/\\/g, "/");
  const allPaths = await listWorktreeChangedPaths(input.worktreePath, input.baseRef, runner);
  return allPaths.filter((path) => {
    if (path === stageRel || path.startsWith(`${stageRel}/`)) return false;
    if (path === ownershipRelPath) return false;
    if (path === INTENT_REVIEW_VERDICT_PATH || path === INTENT_REVIEW_VERDICT_OWNER_PATH) return false;
    if (path.startsWith(durablePrefix)) {
      const name = path.slice(durablePrefix.length);
      return !(stagedNames.includes(name) || ownedFiles.includes(name));
    }
    return true;
  });
}

/** Validate and transactionally land an intent step's complete staged output. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation and rollback are one filesystem boundary.
export async function landIntentWorkflowOutput(input: {
  worktreePath: string;
  baseRef: string;
  output: IntentOutputConfig;
  warn?: (message: string) => void;
  invocationId?: string;
  runner?: AsyncSubprocessRunner;
}): Promise<IntentOutputResult> {
  const runner = input.runner ?? realAsyncSubprocessRunner;
  const stageDir = join(input.worktreePath, ".jarvis-intent-stage");
  const durableDir = resolve(input.worktreePath, input.output.durableDir);
  const ownershipFile = await ownershipPath(input.worktreePath, runner);
  const ownership = readOwnership(ownershipFile);
  const ownedFiles = input.invocationId === undefined ? [] : (ownership[input.invocationId] ?? []);
  if (!existsSync(stageDir) && ownedFiles.length > 0) {
    return landingResult(input.worktreePath, input.output.durableDir, ownedFiles);
  }
  if (!existsSync(stageDir) || !statSync(stageDir).isDirectory()) {
    failure("intent: .jarvis-intent-stage is missing");
  }

  const rogue = await findIntentLandingRoguePaths({
    worktreePath: input.worktreePath,
    baseRef: input.baseRef,
    stagingDir: ".jarvis-intent-stage",
    durableDir: input.output.durableDir,
    ...(input.invocationId !== undefined ? { invocationId: input.invocationId } : {}),
    runner,
  });
  if (rogue.length > 0) failure(`intent: splitter wrote outside .jarvis-intent-stage/: ${rogue.join(", ")}`);
  const allPaths = await listWorktreeChangedPaths(input.worktreePath, input.baseRef, runner);
  const paths = intentStageModifiedPaths(allPaths);
  const validation = await validateIntentStage(stageDir, paths, input.warn ?? (() => undefined));
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
    return landingResult(input.worktreePath, input.output.durableDir, files);
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

function intentLandingOffendingFile(error: string): string {
  const match = /^intent: ([^\s]+) /.exec(error);
  return match?.[1] ?? "";
}

function isRepromptableIntentLandingError(error: string): boolean {
  return !(
    error.includes("splitter wrote outside") ||
    error.includes("invalid splitter output") ||
    error.includes("invalid emitted filename") ||
    error.includes("duplicate emitted name") ||
    error.includes("splitter produced no intent files") ||
    error.includes("failed to read stage directory")
  );
}

/** Post-normalize, post-repair landing validation for intent-split write-loop completion. */
export async function evaluateIntentSplitLandingGate(input: {
  worktreePath: string;
  baseRef: string;
  stagingDir: string;
  durableDir: string;
  warn?: (message: string) => void;
}): Promise<
  | { ok: true }
  | { ok: false; error: string; offendingFile: string; repromptable: boolean }
> {
  const rogue = await findIntentLandingRoguePaths({
    worktreePath: input.worktreePath,
    baseRef: input.baseRef,
    stagingDir: input.stagingDir,
    durableDir: input.durableDir,
  });
  if (rogue.length > 0) {
    const stageRel = input.stagingDir.replace(/\/$/, "");
    return {
      ok: false,
      error: `intent: splitter wrote outside ${stageRel}/: ${rogue.join(", ")}`,
      offendingFile: "",
      repromptable: false,
    };
  }
  const stageDir = join(input.worktreePath, input.stagingDir);
  const modifiedPaths = intentStageModifiedPaths(await listWorktreeChangedPaths(input.worktreePath, input.baseRef));
  const validation = await validateIntentStage(stageDir, modifiedPaths, input.warn ?? (() => undefined));
  if (validation.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    error: validation.error,
    offendingFile: intentLandingOffendingFile(validation.error),
    repromptable: isRepromptableIntentLandingError(validation.error),
  };
}
