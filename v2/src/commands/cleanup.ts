import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getCurrentBranchAsync } from "../../../shared/git.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { isProcessAlive, type WorktreeLock } from "../../../shared/worktree-lock.ts";
import { jarvisHome } from "../paths.ts";
import type { Run, StateStore } from "../persistence/state-store.ts";
import { isBoundaryTerminalRunStatus } from "../persistence/state-store.ts";
import { type ArtifactSpec, archiveCompletedSpec, checkArtifactEligibility } from "./cleanup-artifacts.ts";

export type DiscoveredWorktree = {
  path: string;
  branch: string | undefined;
};

/**
 * Discover materialized worktrees under ~/.jarvis/worktrees/<project>/.
 * Returns one candidate per real git worktree, excluding empty directories
 * and non-worktree debris. Each candidate carries its absolute path and
 * resolved branch (including slash-nested paths like plan/<name>).
 */
export async function discoverMaterializedWorktrees(
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string = jarvisHome(),
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<DiscoveredWorktree[]> {
  const candidates: DiscoveredWorktree[] = [];
  const worktreesRoot = join(jarvisRoot, "worktrees");

  if (!existsSync(worktreesRoot)) {
    return candidates;
  }

  for (const projectName of Object.keys(registry)) {
    const projectWorktreesDir = join(worktreesRoot, projectName);
    if (!existsSync(projectWorktreesDir)) {
      continue;
    }

    const discovered = await discoverWorktreesInProject(projectWorktreesDir, runner);
    candidates.push(...discovered);
  }

  return candidates;
}

/**
 * Walk the entire tree under <projectWorktreesDir> and find all valid
 * git worktrees, including slash-nested ones like plan/<name>.
 */
async function discoverWorktreesInProject(
  projectWorktreesDir: string,
  runner: AsyncSubprocessRunner,
): Promise<DiscoveredWorktree[]> {
  const candidates: DiscoveredWorktree[] = [];

  const entries = readdirSync(projectWorktreesDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(projectWorktreesDir, entry.name);
    if (entry.isDirectory()) {
      // Check if this directory is a valid worktree
      if (await isValidGitWorktree(fullPath, runner)) {
        const branch = await resolveWorktreeBranch(fullPath, runner);
        candidates.push({ path: fullPath, branch });
      } else {
        // Recurse into subdirectories (for slash-nested paths like plan/<name>)
        const nested = await discoverWorktreesRecursive(fullPath, runner);
        candidates.push(...nested);
      }
    }
  }

  return candidates;
}

/**
 * Recursively walk a directory tree to find nested worktrees.
 */
async function discoverWorktreesRecursive(dir: string, runner: AsyncSubprocessRunner): Promise<DiscoveredWorktree[]> {
  const candidates: DiscoveredWorktree[] = [];

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Ignore errors reading directories (e.g., permission denied)
    return candidates;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await isValidGitWorktree(fullPath, runner)) {
        const branch = await resolveWorktreeBranch(fullPath, runner);
        candidates.push({ path: fullPath, branch });
      } else {
        const nested = await discoverWorktreesRecursive(fullPath, runner);
        candidates.push(...nested);
      }
    }
  }

  return candidates;
}

async function resolveWorktreeBranch(worktreePath: string, runner: AsyncSubprocessRunner): Promise<string | undefined> {
  const branch = await getCurrentBranchAsync(worktreePath, runner);
  return branch === "HEAD" ? undefined : branch;
}

/**
 * Check if a directory is a valid git worktree by running
 * `git rev-parse --is-inside-work-tree` and checking for "true".
 * Must NOT use stdio: "ignore" to capture stdout properly.
 */
async function isValidGitWorktree(worktreePath: string, runner: AsyncSubprocessRunner): Promise<boolean> {
  if (!existsSync(worktreePath)) return false;
  try {
    const result = await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], worktreePath);
    return result.trim() === "true";
  } catch {
    return false;
  }
}

export type EligibilityResult = { status: "eligible" } | { status: "ineligible"; reason: string };

export type DaemonClient = (project: string, branch: string) => Promise<{ isLive: boolean }[]>;

/**
 * Determine whether a discovered worktree is eligible for retirement.
 * A worktree is eligible iff:
 * 1. Its PR is merged
 * 2. No non-terminal durable run references it (via project+branch)
 * 3. The daemon reports no live run for it
 *
 * Fail closed: any error (gh failure, daemon unreachable, store error) → ineligible.
 */
export async function checkEligibility(
  candidate: DiscoveredWorktree,
  project: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
): Promise<EligibilityResult> {
  if (candidate.branch === undefined) return { status: "ineligible", reason: "Could not determine branch" };
  const branch = candidate.branch;
  // Check if PR is merged
  const mergedResult = await isMerged(branch, runner);
  if (!mergedResult.merged) {
    return { status: "ineligible", reason: `PR not merged: ${mergedResult.reason}` };
  }

  // Check durable run store for non-terminal runs
  const run = store.findRunByProjectBranch({ project, branch });
  if (run && !isBoundaryTerminalRunStatus(run.status)) {
    return {
      status: "ineligible",
      reason: `Non-terminal run exists: status=${run.status}`,
    };
  }

  // Check daemon for live runs
  try {
    const daemonRuns = await daemonClient(project, branch);
    const hasLiveRun = daemonRuns.some((r) => r.isLive);
    if (hasLiveRun) {
      return { status: "ineligible", reason: "Daemon reports live run" };
    }
  } catch (err) {
    return {
      status: "ineligible",
      reason: `Daemon unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { status: "eligible" };
}

type MergedCheckResult = { merged: true } | { merged: false; reason: string };

/**
 * Check if a branch's PR is merged using `gh pr view <branch> --json state,mergedAt`.
 * This command includes merged PRs (unlike `gh pr list --head` which defaults to open).
 */
async function isMerged(branch: string, runner: AsyncSubprocessRunner): Promise<MergedCheckResult> {
  try {
    const output = await runner.runAsync("gh", ["pr", "view", branch, "--json", "state,mergedAt"], ".");
    const parsed = JSON.parse(output);
    if (parsed.state === "MERGED" && parsed.mergedAt) {
      return { merged: true };
    }
    return { merged: false, reason: `PR state is ${parsed.state}` };
  } catch (err) {
    if (err instanceof AsyncSubprocessError) {
      return { merged: false, reason: `gh failed: ${err.message}` };
    }
    return { merged: false, reason: `Unexpected error: ${String(err)}` };
  }
}

export type CleanupCandidate = {
  worktree: DiscoveredWorktree & { branch: string };
  project: string;
};

function artifactForRetiredWorktree(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
): ArtifactSpec | undefined {
  const run = store.findRunByProjectBranch({ project: candidate.project, branch: candidate.worktree.branch });
  if (run === null || run === undefined) return undefined;
  const source = sourceForRun(run, candidate.worktree.path, projectRoot);
  if (source === undefined) return undefined;
  return {
    home: dirname(source),
    source,
    name: basename(source, ".md"),
    branch: candidate.worktree.branch,
  };
}

function sourceForRun(run: Run, worktreePath: string, projectRoot: string): string | undefined {
  const identity = isAbsolute(run.specPath) ? relative(worktreePath, run.specPath) : run.specPath;
  if (identity === "" || identity === ".." || identity.startsWith("../") || isAbsolute(identity)) return undefined;

  const durablePath = resolve(projectRoot, identity);
  return basename(durablePath) === "index.md" ? dirname(durablePath) : durablePath;
}

function provenIntentPrune(spec: ArtifactSpec): boolean {
  if (spec.source.endsWith(".md")) return false;
  try {
    const ready = join(spec.home, "ready-intents", `${spec.name}.md`);
    return (
      existsSync(ready) &&
      existsSync(join(spec.source, "intent.md")) &&
      readFileSync(ready).equals(readFileSync(join(spec.source, "intent.md")))
    );
  } catch {
    return false;
  }
}

type OpenPr = { number: number; isDraft: boolean };

/** List open PRs whose head is <branch> via `gh pr list`. Throws on gh failure or malformed output. */
async function listOpenPrsForBranch(branch: string, cwd: string, runner: AsyncSubprocessRunner): Promise<OpenPr[]> {
  const output = await runner.runAsync(
    "gh",
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number,isDraft"],
    cwd,
  );
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error("unexpected gh response");
  return parsed.map((item: unknown) => {
    const pr = item as { number?: number; isDraft?: boolean };
    return { number: pr.number ?? 0, isDraft: pr.isDraft ?? false };
  });
}

async function archiveRetiredArtifact(
  candidate: CleanupCandidate,
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  store: StateStore,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<void> {
  const projectRoot = registry[candidate.project]?.root;
  if (projectRoot === undefined) return;
  const spec = artifactForRetiredWorktree(candidate, projectRoot, store);
  if (spec === undefined) {
    io.stdout(`Skipped artifact: ${candidate.worktree.path} — no durable spec identity\n`);
    return;
  }

  const eligibility = await checkArtifactEligibility(spec, {
    findOpenPrs: async (branch) => (await listOpenPrsForBranch(branch, projectRoot, runner)).length,
    hasMaterializedOwner: async () =>
      allWorktrees.some(
        (worktree) =>
          worktree.path !== candidate.worktree.path &&
          existsSync(join(worktree.path, relative(projectRoot, spec.source))),
      ),
  });
  if (eligibility.status === "ineligible") {
    io.stdout(`Skipped artifact: ${spec.source} — ${eligibility.reason}\n`);
    return;
  }

  reportArchive(spec, archiveCompletedSpec(spec), "artifact", io);
}

function previewArtifact(spec: ArtifactSpec, io: { stdout: (s: string) => void }): void {
  io.stdout(
    `  archive: ${spec.source} -> ${join(spec.home, "completed", basename(spec.source))}${provenIntentPrune(spec) ? " (prune consumed ready-intent)" : ""}\n`,
  );
}

type DiscoveredStrandedArtifact = Omit<ArtifactSpec, "branch"> & { project: string };
type StrandedArtifact = DiscoveredStrandedArtifact & { branch: string };

function discoverStrandedArtifacts(registry: Record<string, ProjectRegistryEntry>): DiscoveredStrandedArtifact[] {
  const artifacts: DiscoveredStrandedArtifact[] = [];
  for (const [project, entry] of Object.entries(registry)) {
    const home = join(entry.root, "v2", "spec");
    if (!existsSync(home)) continue;
    try {
      for (const child of readdirSync(home, { withFileTypes: true })) {
        if (!child.isDirectory() || ["completed", "seeds", "ready-intents"].includes(child.name)) continue;
        artifacts.push({ home, source: join(home, child.name), name: child.name, project });
      }
    } catch {
      // A home that cannot be read has no safely inspectable candidates.
    }
  }
  return artifacts;
}

function recordedStrandedBranch(
  artifact: DiscoveredStrandedArtifact,
  projectRoot: string,
  store: StateStore,
): string | undefined {
  for (const run of store.listRuns?.() ?? []) {
    if (run.project !== artifact.project) continue;
    const source = sourceForRun(run, run.worktreePath, projectRoot);
    if (source === undefined) continue;
    if (resolve(source) === resolve(artifact.source)) return run.branch;
  }
  return undefined;
}

function hasStrandedOwner(
  artifact: StrandedArtifact,
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  jarvisRoot: string,
): boolean {
  return allWorktrees.some((worktree) => {
    if (projectForWorktree(worktree, registry, jarvisRoot) !== artifact.project) return false;
    return worktree.branch === undefined || worktree.branch === artifact.branch;
  });
}

async function inspectStrandedArtifacts(
  artifacts: readonly DiscoveredStrandedArtifact[],
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  jarvisRoot: string,
  store: StateStore,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
): Promise<StrandedArtifact[]> {
  const eligible: StrandedArtifact[] = [];
  for (const artifact of artifacts) {
    const projectRoot = registry[artifact.project]?.root;
    if (projectRoot === undefined) continue;
    const branch = recordedStrandedBranch(artifact, projectRoot, store);
    if (branch === undefined) {
      io.stdout(`Skipped stranded artifact: ${artifact.source} — no durable implementation branch\n`);
      continue;
    }
    const identified = { ...artifact, branch };
    if (hasStrandedOwner(identified, registry, allWorktrees, jarvisRoot)) {
      io.stdout(`Skipped stranded artifact: ${artifact.source} — another materialized worktree owns this spec\n`);
      continue;
    }
    const inspection = await checkArtifactEligibility(identified, {
      findOpenPrs: async (branch) => (await listOpenPrsForBranch(branch, projectRoot, runner)).length,
      hasMaterializedOwner: async () => false,
    });
    if (inspection.status === "eligible") {
      eligible.push(identified);
    } else {
      io.stdout(`Skipped stranded artifact: ${artifact.source} — ${inspection.reason}\n`);
    }
  }
  return eligible;
}

function reportArchive(
  spec: ArtifactSpec,
  result: ReturnType<typeof archiveCompletedSpec>,
  prefix: string,
  io: { stdout: (s: string) => void },
): void {
  if (result.status === "archived") {
    io.stdout(
      `Archived: ${spec.source} -> ${result.destination}${result.intentPruned ? " (pruned consumed ready-intent)" : ""}\n`,
    );
  } else {
    io.stdout(`Skipped ${prefix}: ${spec.source} — ${result.reason}\n`);
  }
}

function projectForWorktree(
  worktree: DiscoveredWorktree,
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
): string | undefined {
  return Object.keys(registry).find((project) =>
    worktree.path.startsWith(`${join(jarvisRoot, "worktrees", project)}/`),
  );
}

async function findEligibleWorktreeCandidates(
  discovered: readonly DiscoveredWorktree[],
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
): Promise<CleanupCandidate[]> {
  const candidates: CleanupCandidate[] = [];
  for (const worktree of discovered) {
    const project = projectForWorktree(worktree, registry, jarvisRoot);
    if (project === undefined || worktree.branch === undefined) continue;

    const eligibility = await checkEligibility(worktree, project, runner, daemonClient, store);
    if (eligibility.status === "eligible") candidates.push({ worktree: { ...worktree, branch: worktree.branch }, project });
  }
  return candidates;
}

function previewWorktreeCandidates(
  candidates: readonly CleanupCandidate[],
  registry: Record<string, ProjectRegistryEntry>,
  store: StateStore,
  io: { stdout: (s: string) => void },
): void {
  if (candidates.length === 0) return;

  io.stdout(`Found ${candidates.length} eligible worktree(s) for cleanup:\n`);
  for (const candidate of candidates) {
    io.stdout(`  ${candidate.worktree.path} (branch: ${candidate.worktree.branch})\n`);
    const projectRoot = registry[candidate.project]?.root;
    if (projectRoot === undefined) continue;
    const spec = artifactForRetiredWorktree(candidate, projectRoot, store);
    if (spec !== undefined) previewArtifact(spec, io);
  }
}

async function recheckEligibleWorktrees(
  candidates: readonly CleanupCandidate[],
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void },
): Promise<CleanupCandidate[]> {
  const stillEligible: CleanupCandidate[] = [];
  for (const candidate of candidates) {
    const recheck = await checkEligibility(candidate.worktree, candidate.project, runner, daemonClient, store);
    if (recheck.status === "eligible") {
      stillEligible.push(candidate);
    } else {
      io.stdout(`Skipped (became ineligible): ${candidate.worktree.path} — ${recheck.reason}\n`);
    }
  }
  return stillEligible;
}

async function retireEligibleWorktrees(
  candidates: readonly CleanupCandidate[],
  registry: Record<string, ProjectRegistryEntry>,
  discovered: readonly DiscoveredWorktree[],
  store: StateStore,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  if (candidates.length === 0) return 0;
  return performWorktreeRemovals(
    [...candidates],
    runner,
    io,
    async (candidate) => {
      await archiveRetiredArtifact(candidate, registry, discovered, store, runner, io);
    },
    (candidate) => registry[candidate.project]?.root ?? ".",
  );
}

/**
 * Run the cleanup command: discover merged-PR worktrees, filter by eligibility,
 * optionally preview (--dry-run) or prompt for confirmation, then retire them.
 *
 * Injected parameters allow the command to be tested with temp directories and
 * mock daemon clients. Production path constructs real daemon client (fail-closed).
 */
export async function runCleanupCommand(
  options: {
    dryRun?: boolean;
    promptConfirm?: (message: string) => Promise<boolean>;
  },
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
  const candidates = await findEligibleWorktreeCandidates(
    discovered,
    registry,
    jarvisRoot,
    runner,
    daemonClient,
    store,
  );
  const stranded = await inspectStrandedArtifacts(
    discoverStrandedArtifacts(registry),
    registry,
    discovered,
    jarvisRoot,
    store,
    runner,
    io,
  );

  if (candidates.length === 0 && stranded.length === 0) {
    io.stdout("No eligible worktrees or stranded artifacts to clean up.\n");
    return 0;
  }

  previewWorktreeCandidates(candidates, registry, store, io);
  if (stranded.length > 0) {
    io.stdout(`Found ${stranded.length} eligible stranded artifact(s) for cleanup:\n`);
    for (const spec of stranded) previewArtifact(spec, io);
  }

  if (options.dryRun) {
    io.stdout("(dry-run: no changes made)\n");
    return 0;
  }

  const confirmed = options.promptConfirm !== undefined ? await options.promptConfirm("Apply cleanup? [y/N] ") : false;

  if (!confirmed) {
    io.stdout("Cancelled.\n");
    return 0;
  }

  const stillEligible = await recheckEligibleWorktrees(candidates, runner, daemonClient, store, io);
  const result = await retireEligibleWorktrees(stillEligible, registry, discovered, store, runner, io);

  for (const spec of stranded) {
    const current = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
    if (hasStrandedOwner(spec, registry, current, jarvisRoot)) {
      io.stdout(`Skipped stranded artifact: ${spec.source} — another materialized worktree owns this spec\n`);
      continue;
    }
    reportArchive(spec, archiveCompletedSpec(spec), "stranded artifact", io);
  }
  if (stillEligible.length === 0 && candidates.length > 0) io.stdout("No worktrees remain eligible after re-check.\n");
  return result;
}

/**
 * Shared retirement sequence: `git worktree remove` (throws on failure) →
 * `worktree prune` (best-effort) → `branch -D` (best-effort) → optionally
 * `push origin --delete` (best-effort).
 */
async function removeWorktreeAndBranch(
  branch: string,
  worktreePath: string,
  projectRoot: string,
  options: { force?: boolean; deleteRemoteBranch?: boolean },
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
): Promise<void> {
  await runner.runAsync(
    "git",
    ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreePath],
    projectRoot,
  );
  io.stdout(`Removed worktree: ${worktreePath}\n`);

  try {
    await runner.runAsync("git", ["worktree", "prune"], projectRoot);
  } catch {
    // Prune may fail but shouldn't block the operation
  }

  try {
    await runner.runAsync("git", ["branch", "-D", branch], projectRoot);
    io.stdout(`Deleted local branch: ${branch}\n`);
  } catch (err) {
    io.stdout(
      `Warning: Could not delete local branch ${branch}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  if (options.deleteRemoteBranch === true) {
    try {
      await runner.runAsync("git", ["push", "origin", "--delete", branch], projectRoot);
      io.stdout(`Deleted remote branch: ${branch}\n`);
    } catch (err) {
      io.stdout(
        `Warning: Could not delete remote branch ${branch}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

/**
 * Retire eligible worktrees via `git worktree remove` + `prune` + `git branch -D`.
 * Exit nonzero if any removal fails, leaving other candidates intact.
 */
export async function performWorktreeRemovals(
  candidates: CleanupCandidate[],
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  afterRetirement?: (candidate: CleanupCandidate) => Promise<void>,
  projectRootForCandidate: (candidate: CleanupCandidate) => string = () => ".",
): Promise<number> {
  let failed = false;

  for (const candidate of candidates) {
    const worktree = candidate.worktree;
    try {
      // cwd doesn't matter for absolute worktree paths
      await removeWorktreeAndBranch(worktree.branch, worktree.path, projectRootForCandidate(candidate), {}, runner, io);
      io.stdout(`Retired: ${worktree.path}\n`);
      await afterRetirement?.(candidate);
    } catch (err) {
      failed = true;
      io.stderr(`Failed to retire ${worktree.path}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  return failed ? 1 : 0;
}

type AbandonResolution = {
  project: string;
  branch: string;
  worktreePath: string;
};

type LiveRunCheck = { live: false } | { live: true; reason: string };

export async function resetStaleWorkspace(
  project: string,
  branch: string,
  projectRoot: string,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<{ status: "reset" | "no-op" } | { status: "refused"; reason: string }> {
  const worktreePath = join(jarvisRoot, "worktrees", project, branch);
  if (!existsSync(worktreePath)) return { status: "no-op" };

  const liveCheck = await isWorktreeLiveHeld(project, branch, jarvisRoot, daemonClient);
  if (liveCheck.live) return { status: "refused", reason: liveCheck.reason };

  const prGate = await gateOnOpenPrs(branch, runner);
  if (prGate.status === "refused") return { status: "refused", reason: prGate.reason };

  const abandonResult = await performAbandonmentSteps(branch, worktreePath, projectRoot, prGate.pr?.number, runner, io);
  return abandonResult === 0 ? { status: "reset" } : { status: "refused", reason: "abandonment failed" };
}

async function isWorktreeLiveHeld(
  project: string,
  branch: string,
  jarvisRoot: string,
  daemonClient: DaemonClient,
): Promise<LiveRunCheck> {
  // Check daemon for live runs
  try {
    const daemonRuns = await daemonClient(project, branch);
    if (daemonRuns.some((r) => r.isLive)) {
      return { live: true, reason: "daemon reports live run" };
    }
  } catch {
    // Daemon unreachable doesn't prove it's not live, but we can't gate on that
  }

  // Check lock file
  const lockPath = join(jarvisRoot, "worktree-locks", project, branch, ".jarvis.lock");
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as WorktreeLock;
      if (isProcessAlive(lock.pid)) {
        return { live: true, reason: `process ${lock.pid} holds worktree lock` };
      }
    } catch {
      // Lock read error; be conservative
    }
  }

  return { live: false };
}

/**
 * Refuse retirement when open-PR state is ambiguous or protects the branch:
 * multiple open PRs, or a single ready (non-draft) PR. gh failures are treated
 * as "no open PRs".
 */
async function gateOnOpenPrs(
  branch: string,
  runner: AsyncSubprocessRunner,
): Promise<{ status: "ok"; pr: OpenPr | undefined } | { status: "refused"; reason: string }> {
  let openPrs: OpenPr[];
  try {
    openPrs = await listOpenPrsForBranch(branch, ".", runner);
  } catch {
    openPrs = [];
  }
  if (openPrs.length > 1) return { status: "refused", reason: "multiple open PRs match branch" };
  const pr = openPrs.at(0);
  if (pr !== undefined && !pr.isDraft) return { status: "refused", reason: "matching PR is ready (non-draft)" };
  return { status: "ok", pr };
}

async function resolveName(
  name: string,
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<AbandonResolution | { error: string }> {
  // Try to match the name against discovered worktrees
  const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
  for (const worktree of discovered) {
    const project = projectForWorktree(worktree, registry, jarvisRoot);
    if (project && worktree.branch !== undefined && (worktree.branch === name || worktree.path.endsWith(name))) {
      return { project, branch: worktree.branch, worktreePath: worktree.path };
    }
  }

  return { error: `No worktree found matching name "${name}"` };
}

async function performAbandonmentSteps(
  branch: string,
  worktreePath: string,
  projectRoot: string | undefined,
  prNumber: number | undefined,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  // Best-effort: close the PR
  if (prNumber !== undefined) {
    try {
      await runner.runAsync("gh", ["pr", "close", String(prNumber)], projectRoot ?? ".");
      io.stdout(`Closed PR #${prNumber}\n`);
    } catch (err) {
      io.stdout(`Warning: Could not close PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  try {
    await removeWorktreeAndBranch(
      branch,
      worktreePath,
      projectRoot ?? ".",
      { force: true, deleteRemoteBranch: true },
      runner,
      io,
    );
  } catch (err) {
    io.stderr(`Failed to remove worktree: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  return 0;
}

export async function runAbandonCommand(
  workspaceName: string,
  options: {
    dryRun?: boolean;
    promptConfirm?: (message: string) => Promise<boolean>;
  },
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  // Resolve the workspace name
  const resolution = await resolveName(workspaceName, registry, jarvisRoot, runner);
  if ("error" in resolution) {
    io.stderr(`Error: ${resolution.error}\n`);
    return 1;
  }

  const { project, branch, worktreePath } = resolution;
  const projectRoot = registry[project]?.root;

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    io.stderr(`Error: Worktree not found at ${worktreePath}\n`);
    return 1;
  }

  // PR-ownership gates: refuse ready PRs and ambiguous PR ownership
  const prGate = await gateOnOpenPrs(branch, runner);
  if (prGate.status === "refused") {
    io.stderr(`Error: Cannot abandon: ${prGate.reason}\n`);
    return 1;
  }
  const prNumber = prGate.pr?.number;

  // Check if worktree is held by a live run
  const liveCheck = await isWorktreeLiveHeld(project, branch, jarvisRoot, daemonClient);
  if (liveCheck.live) {
    io.stderr(`Error: Cannot abandon: ${liveCheck.reason}\n`);
    return 1;
  }

  // Preview actions
  io.stdout(`Preview abandon of workspace:\n`);
  io.stdout(`  Project: ${project}\n`);
  io.stdout(`  Branch: ${branch}\n`);
  io.stdout(`  Worktree: ${worktreePath}\n`);
  if (prNumber !== undefined) {
    io.stdout(`  close: PR #${prNumber}\n`);
  }
  io.stdout(`  remove: worktree at ${worktreePath}\n`);
  io.stdout(`  delete: local branch ${branch}\n`);
  io.stdout(`  delete: remote branch ${branch}\n`);

  if (options.dryRun) {
    io.stdout("(dry-run: no changes made)\n");
    return 0;
  }

  const confirmed =
    options.promptConfirm !== undefined ? await options.promptConfirm("Abandon workspace? [y/N] ") : false;

  if (!confirmed) {
    io.stdout("Cancelled.\n");
    return 0;
  }

  // Execute abandonment
  const result = await performAbandonmentSteps(branch, worktreePath, projectRoot, prNumber, runner, io);
  if (result !== 0) return result;

  io.stdout(`Abandoned workspace: ${workspaceName}\n`);
  return 0;
}
