import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getCurrentBranchAsync } from "../../../shared/git.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { jarvisHome } from "../paths.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { isBoundaryTerminalRunStatus } from "../persistence/state-store.ts";
import { type ArtifactSpec, archiveCompletedSpec, checkArtifactEligibility } from "./cleanup-artifacts.ts";

export type DiscoveredWorktree = {
  path: string;
  branch: string;
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
        const branch = await getCurrentBranchAsync(fullPath, runner);
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

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await isValidGitWorktree(fullPath, runner)) {
          const branch = await getCurrentBranchAsync(fullPath, runner);
          candidates.push({ path: fullPath, branch });
        } else {
          const nested = await discoverWorktreesRecursive(fullPath, runner);
          candidates.push(...nested);
        }
      }
    }
  } catch {
    // Ignore errors reading directories (e.g., permission denied)
  }

  return candidates;
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
  // Check if PR is merged
  const mergedResult = await isMerged(candidate.branch, runner);
  if (!mergedResult.merged) {
    return { status: "ineligible", reason: `PR not merged: ${mergedResult.reason}` };
  }

  // Check durable run store for non-terminal runs
  const run = store.findRunByProjectBranch({ project, branch: candidate.branch });
  if (run && !isBoundaryTerminalRunStatus(run.status)) {
    return {
      status: "ineligible",
      reason: `Non-terminal run exists: status=${run.status}`,
    };
  }

  // Check daemon for live runs
  try {
    const daemonRuns = await daemonClient(project, candidate.branch);
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
  worktree: DiscoveredWorktree;
  project: string;
};

function artifactForRetiredWorktree(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
): ArtifactSpec | undefined {
  const run = store.findRunByProjectBranch({ project: candidate.project, branch: candidate.worktree.branch });
  if (run === null || run === undefined || !isAbsolute(run.specPath)) return undefined;

  const identity = relative(candidate.worktree.path, run.specPath);
  if (identity === "" || identity === ".." || identity.startsWith("../") || isAbsolute(identity)) return undefined;

  const durablePath = resolve(projectRoot, identity);
  const source = basename(durablePath) === "index.md" ? dirname(durablePath) : durablePath;
  return {
    home: dirname(source),
    source,
    name: basename(source, ".md"),
    branch: candidate.worktree.branch,
  };
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
    findOpenPrs: async (branch) => {
      const output = await runner.runAsync(
        "gh",
        ["pr", "list", "--head", branch, "--state", "open", "--json", "number"],
        projectRoot,
      );
      const parsed: unknown = JSON.parse(output);
      if (!Array.isArray(parsed)) throw new Error("unexpected gh response");
      return parsed.length;
    },
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

type StrandedArtifact = ArtifactSpec & { project: string };

function discoverStrandedArtifacts(registry: Record<string, ProjectRegistryEntry>): StrandedArtifact[] {
  const artifacts: StrandedArtifact[] = [];
  for (const [project, entry] of Object.entries(registry)) {
    const home = join(entry.root, "v2", "spec");
    if (!existsSync(home)) continue;
    try {
      for (const child of readdirSync(home, { withFileTypes: true })) {
        if (!child.isDirectory() || ["completed", "seeds", "ready-intents"].includes(child.name)) continue;
        artifacts.push({ home, source: join(home, child.name), name: child.name, branch: child.name, project });
      }
    } catch {
      // A home that cannot be read has no safely inspectable candidates.
    }
  }
  return artifacts;
}

async function inspectStrandedArtifacts(
  artifacts: readonly StrandedArtifact[],
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
): Promise<StrandedArtifact[]> {
  const eligible: StrandedArtifact[] = [];
  for (const artifact of artifacts) {
    const projectRoot = registry[artifact.project]?.root;
    if (projectRoot === undefined) continue;
    const hasOwner = allWorktrees.some((worktree) =>
      existsSync(join(worktree.path, relative(projectRoot, artifact.source))),
    );
    if (hasOwner) {
      io.stdout(`Skipped stranded artifact: ${artifact.source} — another materialized worktree owns this spec\n`);
      continue;
    }
    const inspection = await checkArtifactEligibility(artifact, {
      findOpenPrs: async (branch) => {
        const output = await runner.runAsync(
          "gh",
          ["pr", "list", "--head", branch, "--state", "open", "--json", "number"],
          projectRoot,
        );
        const parsed: unknown = JSON.parse(output);
        if (!Array.isArray(parsed)) throw new Error("unexpected gh response");
        return parsed.length;
      },
      hasMaterializedOwner: async () => false,
    });
    if (inspection.status === "eligible") {
      eligible.push(artifact);
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
    if (project === undefined) continue;

    const eligibility = await checkEligibility(worktree, project, runner, daemonClient, store);
    if (eligibility.status === "eligible") candidates.push({ worktree, project });
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
    reportArchive(spec, archiveCompletedSpec(spec), "stranded artifact", io);
  }
  if (stillEligible.length === 0 && candidates.length > 0) io.stdout("No worktrees remain eligible after re-check.\n");
  return result;
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
      // Remove worktree via git (cwd doesn't matter for absolute paths)
      const projectRoot = projectRootForCandidate(candidate);
      await runner.runAsync("git", ["worktree", "remove", worktree.path], projectRoot);

      // Prune to clean up stale registrations
      await runner.runAsync("git", ["worktree", "prune"], projectRoot);

      // Delete local branch
      try {
        await runner.runAsync("git", ["branch", "-D", worktree.branch], projectRoot);
      } catch (err) {
        // Branch delete may fail if already deleted; log but don't fail the whole operation
        io.stdout(
          `Warning: could not delete local branch ${worktree.branch}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }

      io.stdout(`Retired: ${worktree.path}\n`);
      await afterRetirement?.(candidate);
    } catch (err) {
      failed = true;
      io.stderr(`Failed to retire ${worktree.path}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  return failed ? 1 : 0;
}
