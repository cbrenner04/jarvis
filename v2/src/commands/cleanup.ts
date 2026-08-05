import { type Dirent, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  getBaseBranch,
  getCurrentBranchAsync,
  isGitRepoAsync,
  originTrackingRefResolvesAsync,
} from "../../../shared/git.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { isProcessAlive, type WorktreeLock } from "../../../shared/worktree-lock.ts";
import { request } from "../cli/ipc.ts";
import { parseListRuns } from "../daemon/daemon-wire.ts";
import { mergeRunLists } from "../daemon/merge-run-lists.ts";
import { type QueryDaemonListsDeps, queryDaemonListsFromSockets } from "../daemon/query-daemon-lists-from-sockets.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { jarvisHome } from "../paths.ts";
import { isTerminalRunStatus, type Run, type StateStore } from "../persistence/state-store.ts";
import { type ArtifactSpec, archiveCompletedSpec, checkArtifactEligibility } from "./cleanup-artifacts.ts";
import { reapDeadDaemonSockets } from "./daemon.ts";

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

export type DaemonClient = ((project: string, branch: string) => Promise<{ isLive: boolean }[]>) & {
  checkWorkflowStartClaim?: (
    project: string,
    branch: string,
  ) => Promise<{ status: "free" } | { status: "claimed"; message: string }>;
};

export const DAEMON_UNREACHABLE_REASON = "Daemon unreachable; run `jarvis daemon start`";

export function createAbsentDaemonClient(): DaemonClient {
  const unreachable = async (): Promise<never> => {
    throw new Error(DAEMON_UNREACHABLE_REASON);
  };
  const daemonClient = unreachable as DaemonClient;
  daemonClient.checkWorkflowStartClaim = unreachable;
  return daemonClient;
}

export function createStaleResetDaemonClient(client: IpcClient): DaemonClient {
  const listRuns = async (project: string, branch: string) => {
    const result = await request(client, "list");
    const list = parseListRuns(result);
    if (list === undefined) throw new Error(DAEMON_UNREACHABLE_REASON);
    return list.runs.filter((r) => r.project === project && r.branch === branch).map((r) => ({ isLive: r.isLive }));
  };
  const daemonClient = listRuns as DaemonClient;
  daemonClient.checkWorkflowStartClaim = async (project, branch) => {
    try {
      await request(client, "check_workflow_start_claim", { project, branch });
      return { status: "free" };
    } catch (error) {
      if (error instanceof RpcError && error.code === "worktree_claimed") {
        return { status: "claimed", message: error.message };
      }
      throw error;
    }
  };
  return daemonClient;
}

export async function createBulkCleanupDaemonClient(deps: QueryDaemonListsDeps): Promise<{
  client: DaemonClient;
  hasAnsweringDaemon: boolean;
  firstError: unknown;
}> {
  const queryLists = async () => queryDaemonListsFromSockets(deps, undefined, { skipOnFailure: true });

  const initial = await queryLists();
  const hasAnsweringDaemon = initial.listResults.some(([, result]) => result !== undefined);

  const client: DaemonClient = async (project, branch) => {
    const { listResults } = await queryLists();
    if (!listResults.some(([, result]) => result !== undefined)) {
      throw new Error(DAEMON_UNREACHABLE_REASON);
    }
    const { rows } = mergeRunLists(listResults);
    return rows
      .filter((row) => row.project === project && row.branch === branch)
      .map((row) => ({ isLive: row.isLive }));
  };

  return { client, hasAnsweringDaemon, firstError: initial.firstError };
}

/**
 * Determine whether a discovered worktree is eligible for retirement.
 * A worktree is eligible iff:
 * 1. Its PR is merged
 * 2. No non-terminal durable run references it (via project+branch)
 * 3. The daemon reports no live run for it
 *
 * Fail closed: `gh` failure or daemon unreachable → ineligible. `listRuns()` errors propagate
 * (cleanup aborts rather than marking the worktree ineligible).
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
  const run = store
    .listRuns()
    .find(
      (candidate) =>
        candidate.project === project && candidate.branch === branch && !isTerminalRunStatus(candidate.status),
    );
  if (run !== undefined) {
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
  } catch {
    return { status: "ineligible", reason: DAEMON_UNREACHABLE_REASON };
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

export type MergedBranchRefCandidate = {
  project: string;
  branch: string;
  headOid: string;
  trackingRefOid?: string;
  repositoryRoot: string;
};

export type MergedBranchRefSnapshot = {
  headOid: string;
  trackingRefOid?: string;
};

export type UnusableRegisteredProject = {
  project: string;
  root: string;
  reason: string;
};

export type DiscoverMergedBranchRefCandidatesResult = {
  candidates: MergedBranchRefCandidate[];
  unusableProjects: UnusableRegisteredProject[];
};

export type DiscoverMergedBranchRefCandidatesOptions = {
  runner?: AsyncSubprocessRunner;
  /** Branch names retired successfully earlier in this cleanup invocation. */
  retiredBranches?: ReadonlySet<string>;
};

type LocalHead = {
  branch: string;
  oid: string;
};

type GhPrHeadRecord = {
  number?: number;
  state?: string;
  mergedAt?: string | null;
  headRefOid?: string;
};

/** Parse `git worktree list --porcelain` for checked-out branch short names. */
export function parseCheckedOutBranchesFromWorktreePorcelain(porcelain: string): Set<string> {
  const checkedOut = new Set<string>();
  for (const line of porcelain.split("\n")) {
    if (!line.startsWith("branch ")) continue;
    const ref = line.slice("branch ".length).trim();
    if (!ref.startsWith("refs/heads/")) continue;
    checkedOut.add(ref.slice("refs/heads/".length));
  }
  return checkedOut;
}

async function resolveGitCommonDir(repoRoot: string, runner: AsyncSubprocessRunner): Promise<string> {
  return resolve(
    (await runner.runAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], repoRoot)).trim(),
  );
}

async function listLocalHeads(repoRoot: string, runner: AsyncSubprocessRunner): Promise<LocalHead[]> {
  const output = await runner.runAsync(
    "git",
    ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/"],
    repoRoot,
  );
  const heads: LocalHead[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.lastIndexOf(" ");
    if (space <= 0) continue;
    heads.push({ branch: trimmed.slice(0, space), oid: trimmed.slice(space + 1) });
  }
  return heads;
}

/** True when one merged PR in `repoRoot` matches `localHeadOid` and no open PR owns the branch. */
export async function mergedPrHeadAuthorityMatches(
  branch: string,
  localHeadOid: string,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  try {
    const output = await runner.runAsync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "all", "--json", "number,state,mergedAt,headRefOid"],
      repoRoot,
    );
    const parsed = JSON.parse(output) as GhPrHeadRecord[];
    if (!Array.isArray(parsed)) return false;
    if (parsed.some((pr) => pr.state === "OPEN")) return false;
    const mergedMatches = parsed.filter((pr) => pr.state === "MERGED" && pr.mergedAt && pr.headRefOid === localHeadOid);
    return mergedMatches.length === 1;
  } catch {
    return false;
  }
}

function shouldSkipLocalHeadForRefPrune(
  head: LocalHead,
  baseBranch: string,
  currentBranch: string,
  checkedOut: ReadonlySet<string>,
  retiredBranches: ReadonlySet<string>,
): boolean {
  if (head.branch === baseBranch) return true;
  if (currentBranch !== "HEAD" && head.branch === currentBranch) return true;
  return checkedOut.has(head.branch) && !retiredBranches.has(head.branch);
}

async function mapRegisteredProjectsToDistinctRepos(
  registry: Record<string, ProjectRegistryEntry>,
  runner: AsyncSubprocessRunner,
): Promise<{
  repoProjects: Map<string, { root: string; project: string }>;
  unusableProjects: UnusableRegisteredProject[];
}> {
  const unusableProjects: UnusableRegisteredProject[] = [];
  const repoProjects = new Map<string, { root: string; project: string }>();

  for (const [project, entry] of Object.entries(registry)) {
    const root = entry.root;
    if (!existsSync(root)) {
      unusableProjects.push({ project, root, reason: "project root does not exist" });
      continue;
    }
    if (!(await isGitRepoAsync(root, runner))) {
      unusableProjects.push({ project, root, reason: "project root is not a git repository" });
      continue;
    }
    let commonDir: string;
    try {
      commonDir = await resolveGitCommonDir(root, runner);
    } catch (err) {
      unusableProjects.push({
        project,
        root,
        reason: `project root is inaccessible: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!repoProjects.has(commonDir)) {
      repoProjects.set(commonDir, { root, project });
    }
  }

  return { repoProjects, unusableProjects };
}

async function discoverMergedBranchRefCandidatesForRepo(
  root: string,
  project: string,
  retiredBranches: ReadonlySet<string>,
  runner: AsyncSubprocessRunner,
): Promise<MergedBranchRefCandidate[]> {
  const [baseBranch, currentBranch, worktreePorcelain, localHeads] = await Promise.all([
    getBaseBranch(root, runner),
    getCurrentBranchAsync(root, runner),
    runner.runAsync("git", ["worktree", "list", "--porcelain"], root),
    listLocalHeads(root, runner),
  ]);
  const checkedOut = parseCheckedOutBranchesFromWorktreePorcelain(worktreePorcelain);
  const candidates: MergedBranchRefCandidate[] = [];

  for (const head of localHeads) {
    if (shouldSkipLocalHeadForRefPrune(head, baseBranch, currentBranch, checkedOut, retiredBranches)) continue;
    if (!(await mergedPrHeadAuthorityMatches(head.branch, head.oid, root, runner))) continue;
    const trackingRefOid = await exactOriginTrackingRefOid(root, head.branch, runner);
    const candidate: MergedBranchRefCandidate = {
      project,
      branch: head.branch,
      headOid: head.oid,
      repositoryRoot: root,
    };
    if (trackingRefOid !== undefined) candidate.trackingRefOid = trackingRefOid;
    candidates.push(candidate);
  }

  return candidates;
}

/**
 * Discover local merged-PR heads eligible for ref pruning, scoped per distinct registered
 * Git repository. Missing or non-Git roots are reported in `unusableProjects`; remaining
 * projects continue.
 */
export async function discoverMergedBranchRefCandidates(
  registry: Record<string, ProjectRegistryEntry>,
  options: DiscoverMergedBranchRefCandidatesOptions = {},
): Promise<DiscoverMergedBranchRefCandidatesResult> {
  const runner = options.runner ?? realAsyncSubprocessRunner;
  const retiredBranches = options.retiredBranches ?? new Set<string>();
  const { repoProjects, unusableProjects } = await mapRegisteredProjectsToDistinctRepos(registry, runner);
  const candidates: MergedBranchRefCandidate[] = [];

  for (const { root, project } of repoProjects.values()) {
    candidates.push(...(await discoverMergedBranchRefCandidatesForRepo(root, project, retiredBranches, runner)));
  }

  return { candidates, unusableProjects };
}

/** Resolve an exact fully qualified ref to its OID, or undefined when absent. */
export async function resolveExactRefOid(
  repoRoot: string,
  ref: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  try {
    const output = await runner.runAsync("git", ["rev-parse", "--verify", ref], repoRoot);
    return output.trim();
  } catch {
    return undefined;
  }
}

/** OID for exact `refs/remotes/origin/<branch>` when present; tags do not count. */
export async function exactOriginTrackingRefOid(
  repoRoot: string,
  branch: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  return resolveExactRefOid(repoRoot, `refs/remotes/origin/${branch}`, runner);
}

export async function snapshotMergedBranchRefs(
  repositoryRoot: string,
  branch: string,
  runner: AsyncSubprocessRunner,
): Promise<MergedBranchRefSnapshot | undefined> {
  const headOid = await resolveExactRefOid(repositoryRoot, `refs/heads/${branch}`, runner);
  if (headOid === undefined) return undefined;
  const trackingRefOid = await exactOriginTrackingRefOid(repositoryRoot, branch, runner);
  const snapshot: MergedBranchRefSnapshot = { headOid };
  if (trackingRefOid !== undefined) snapshot.trackingRefOid = trackingRefOid;
  return snapshot;
}

/** Apply-time guards for a previewed merged-branch ref prune candidate. */
export async function revalidateMergedBranchRefCandidate(
  candidate: MergedBranchRefCandidate,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  retiredBranches: ReadonlySet<string>,
): Promise<EligibilityResult> {
  const root = candidate.repositoryRoot;
  const branch = candidate.branch;
  const project = candidate.project;

  const currentHeadOid = await resolveExactRefOid(root, `refs/heads/${branch}`, runner);
  if (currentHeadOid === undefined) {
    return { status: "ineligible", reason: "local head no longer exists" };
  }
  if (currentHeadOid !== candidate.headOid) {
    return { status: "ineligible", reason: "local head OID changed since preview" };
  }

  const currentTrackingOid = await exactOriginTrackingRefOid(root, branch, runner);
  if (candidate.trackingRefOid !== undefined) {
    if (currentTrackingOid === undefined) {
      return { status: "ineligible", reason: "tracking ref no longer exists" };
    }
    if (currentTrackingOid !== candidate.trackingRefOid) {
      return { status: "ineligible", reason: "tracking ref OID changed since preview" };
    }
  } else if (currentTrackingOid !== undefined) {
    return { status: "ineligible", reason: "tracking ref appeared since preview" };
  }

  if (!(await mergedPrHeadAuthorityMatches(branch, currentHeadOid, root, runner))) {
    return { status: "ineligible", reason: "merged PR authority no longer matches" };
  }

  const [baseBranch, currentBranch, checkedOut] = await Promise.all([
    getBaseBranch(root, runner),
    getCurrentBranchAsync(root, runner),
    runner
      .runAsync("git", ["worktree", "list", "--porcelain"], root)
      .then(parseCheckedOutBranchesFromWorktreePorcelain),
  ]);
  if (branch === baseBranch) return { status: "ineligible", reason: "base branch" };
  if (currentBranch !== "HEAD" && branch === currentBranch) {
    return { status: "ineligible", reason: "current branch" };
  }
  if (checkedOut.has(branch) && !retiredBranches.has(branch)) {
    return { status: "ineligible", reason: "branch is checked out" };
  }

  const run = store
    .listRuns()
    .find((entry) => entry.project === project && entry.branch === branch && !isTerminalRunStatus(entry.status));
  if (run !== undefined) {
    return { status: "ineligible", reason: `non-terminal run exists: status=${run.status}` };
  }

  try {
    const daemonRuns = await daemonClient(project, branch);
    if (daemonRuns.some((entry) => entry.isLive)) {
      return { status: "ineligible", reason: "daemon reports live run" };
    }
  } catch {
    return { status: "ineligible", reason: DAEMON_UNREACHABLE_REASON };
  }

  return { status: "eligible" };
}

async function deleteExactRef(
  ref: string,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await runner.runAsync("git", ["update-ref", "-d", ref], repoRoot);
    if ((await resolveExactRefOid(repoRoot, ref, runner)) !== undefined) {
      return { ok: false, message: "ref still resolves after deletion" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Delete previewed exact local head and optional tracking refs for one candidate. */
export async function pruneVerifiedMergedBranchRef(
  candidate: MergedBranchRefCandidate,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  options: { dryRun?: boolean } = {},
): Promise<number> {
  const refsToDelete = [`refs/heads/${candidate.branch}`];
  if (candidate.trackingRefOid !== undefined) {
    refsToDelete.push(`refs/remotes/origin/${candidate.branch}`);
  }

  if (options.dryRun) {
    for (const ref of refsToDelete) {
      io.stdout(`  prune ref: ${candidate.project} ${ref}\n`);
    }
    return 0;
  }

  let failed = false;
  for (const ref of refsToDelete) {
    const result = await deleteExactRef(ref, candidate.repositoryRoot, runner);
    if (result.ok) {
      io.stdout(`Pruned ref: ${candidate.project} ${ref}\n`);
    } else {
      failed = true;
      io.stderr(`Failed to prune ref ${ref} (${candidate.project}): ${result.message}\n`);
    }
  }
  return failed ? 1 : 0;
}

async function hasHeadOnlyDaemonUnreachableSkip(
  candidates: readonly MergedBranchRefCandidate[],
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  retiredBranches: ReadonlySet<string>,
): Promise<boolean> {
  for (const candidate of candidates) {
    const eligibility = await revalidateMergedBranchRefCandidate(
      candidate,
      runner,
      daemonClient,
      store,
      retiredBranches,
    );
    if (eligibility.status === "ineligible" && eligibility.reason === DAEMON_UNREACHABLE_REASON) {
      return true;
    }
  }
  return false;
}

async function applyMergedBranchRefPrunes(
  candidates: readonly MergedBranchRefCandidate[],
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  retiredBranches: ReadonlySet<string>,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  let exit = 0;
  for (const candidate of candidates) {
    const eligibility = await revalidateMergedBranchRefCandidate(
      candidate,
      runner,
      daemonClient,
      store,
      retiredBranches,
    );
    if (eligibility.status === "ineligible") {
      io.stdout(`Skipped ref prune: ${candidate.project} refs/heads/${candidate.branch} — ${eligibility.reason}\n`);
      if (eligibility.reason === DAEMON_UNREACHABLE_REASON) exit = 1;
      continue;
    }
    const result = await pruneVerifiedMergedBranchRef(candidate, runner, io);
    if (result !== 0) exit = 1;
  }
  return exit;
}

function artifactForRetiredWorktree(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
): ArtifactSpec | undefined {
  const sources = store
    .listRuns()
    .filter((run) => run.project === candidate.project && run.branch === candidate.worktree.branch)
    .map((run) => sourceForRun(run, candidate.worktree.path, projectRoot))
    .filter((path): path is string => path !== undefined);
  const source = sources.find((path) => existsSync(join(path, "index.md"))) ?? sources[0];
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
  for (const run of store.listRuns()) {
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

export async function inspectStrandedArtifacts(
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
): Promise<{ candidates: CleanupCandidate[]; daemonUnreachable: DiscoveredWorktree[] }> {
  const candidates: CleanupCandidate[] = [];
  const daemonUnreachable: DiscoveredWorktree[] = [];
  for (const worktree of discovered) {
    const project = projectForWorktree(worktree, registry, jarvisRoot);
    if (project === undefined || worktree.branch === undefined) continue;

    const eligibility = await checkEligibility(worktree, project, runner, daemonClient, store);
    if (eligibility.status === "eligible") {
      candidates.push({ worktree: { ...worktree, branch: worktree.branch }, project });
    } else if (eligibility.reason === DAEMON_UNREACHABLE_REASON) {
      daemonUnreachable.push(worktree);
    }
  }
  return { candidates, daemonUnreachable };
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
): Promise<{ candidates: CleanupCandidate[]; daemonUnreachable: boolean }> {
  const stillEligible: CleanupCandidate[] = [];
  let daemonUnreachable = false;
  for (const candidate of candidates) {
    const recheck = await checkEligibility(candidate.worktree, candidate.project, runner, daemonClient, store);
    if (recheck.status === "eligible") {
      stillEligible.push(candidate);
    } else {
      daemonUnreachable ||= recheck.reason === DAEMON_UNREACHABLE_REASON;
      io.stdout(`Skipped (became ineligible): ${candidate.worktree.path} — ${recheck.reason}\n`);
    }
  }
  return { candidates: stillEligible, daemonUnreachable };
}

async function retireEligibleWorktrees(
  candidates: readonly CleanupCandidate[],
  registry: Record<string, ProjectRegistryEntry>,
  discovered: readonly DiscoveredWorktree[],
  store: StateStore,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  refPruneSnapshots: ReadonlyMap<string, MergedBranchRefSnapshot>,
  daemonClient: DaemonClient,
  retiredBranches: Set<string>,
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
    {
      refPruneSnapshotForCandidate: (candidate) => refPruneSnapshots.get(candidate.worktree.path),
      revalidateRefPrune: async (candidate, snapshot) => {
        const projectRoot = registry[candidate.project]?.root ?? ".";
        const refCandidate: MergedBranchRefCandidate = {
          project: candidate.project,
          branch: candidate.worktree.branch,
          headOid: snapshot.headOid,
          repositoryRoot: projectRoot,
        };
        if (snapshot.trackingRefOid !== undefined) refCandidate.trackingRefOid = snapshot.trackingRefOid;
        return revalidateMergedBranchRefCandidate(refCandidate, runner, daemonClient, store, retiredBranches);
      },
      retiredBranches,
    },
  );
}

type ReaperResult = Awaited<ReturnType<typeof reapDeadDaemonSockets>>;

function hasNothingToClean(
  candidates: readonly CleanupCandidate[],
  stranded: readonly StrandedArtifact[],
  reaperResult: ReaperResult,
  branchRefCandidates: readonly MergedBranchRefCandidate[],
): boolean {
  return (
    candidates.length === 0 &&
    stranded.length === 0 &&
    reaperResult.dead.length === 0 &&
    reaperResult.preserved.length === 0 &&
    branchRefCandidates.length === 0
  );
}

function previewReaperResult(reaperResult: ReaperResult, io: { stdout: (s: string) => void }): void {
  if (reaperResult.dead.length > 0) {
    io.stdout(`Found ${reaperResult.dead.length} dead daemon socket(s) for cleanup:\n`);
    for (const path of reaperResult.dead) {
      io.stdout(`  remove: ${path}\n`);
    }
  }
  if (reaperResult.preserved.length > 0) {
    io.stdout(`Preserved ${reaperResult.preserved.length} daemon socket(s):\n`);
    for (const item of reaperResult.preserved) {
      io.stdout(`  ${item.path} — ${item.reason}\n`);
    }
  }
}

function removeDeadDaemonSockets(
  paths: readonly string[],
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): number {
  for (const path of paths) {
    try {
      rmSync(path, { force: true });
      io.stdout(`Removed daemon socket: ${path}\n`);
    } catch (err) {
      io.stderr(`Failed to remove daemon socket ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }
  return 0;
}

async function retireStrandedArtifacts(
  stranded: readonly StrandedArtifact[],
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
): Promise<void> {
  for (const spec of stranded) {
    const current = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
    if (hasStrandedOwner(spec, registry, current, jarvisRoot)) {
      io.stdout(`Skipped stranded artifact: ${spec.source} — another materialized worktree owns this spec\n`);
      continue;
    }
    reportArchive(spec, archiveCompletedSpec(spec), "stranded artifact", io);
  }
}

function reportUnusableProjects(
  unusableProjects: readonly UnusableRegisteredProject[],
  io: { stderr: (s: string) => void },
): number {
  for (const unusable of unusableProjects) {
    io.stderr(`Skipped project ${unusable.project}: ${unusable.reason} (${unusable.root})\n`);
  }
  return unusableProjects.length > 0 ? 1 : 0;
}

function resolveDiscoveryOrDaemonExit(discoveryExit: number, daemonExit: number): number {
  return discoveryExit !== 0 ? discoveryExit : daemonExit;
}

async function collectWorktreeRefSnapshots(
  candidates: readonly CleanupCandidate[],
  registry: Record<string, ProjectRegistryEntry>,
  runner: AsyncSubprocessRunner,
): Promise<Map<string, MergedBranchRefSnapshot>> {
  const worktreeRefSnapshots = new Map<string, MergedBranchRefSnapshot>();
  for (const candidate of candidates) {
    const projectRoot = registry[candidate.project]?.root;
    if (projectRoot === undefined) continue;
    const snapshot = await snapshotMergedBranchRefs(projectRoot, candidate.worktree.branch, runner);
    if (snapshot !== undefined) worktreeRefSnapshots.set(candidate.worktree.path, snapshot);
  }
  return worktreeRefSnapshots;
}

type CleanupDiscoveryContext = {
  branchRefDiscovery: DiscoverMergedBranchRefCandidatesResult;
  discoveryExit: number;
  discovered: DiscoveredWorktree[];
  candidates: CleanupCandidate[];
  worktreeRefSnapshots: Map<string, MergedBranchRefSnapshot>;
  daemonUnreachableExit: number;
  strandedArtifacts: DiscoveredStrandedArtifact[];
  stranded: StrandedArtifact[];
  reaperResult: ReaperResult;
  daemonUnreachable: DiscoveredWorktree[];
};

async function gatherCleanupDiscoveryContext(
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<CleanupDiscoveryContext> {
  const branchRefDiscovery = await discoverMergedBranchRefCandidates(registry, { runner });
  const discoveryExit = reportUnusableProjects(branchRefDiscovery.unusableProjects, io);
  const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
  const { candidates, daemonUnreachable } = await findEligibleWorktreeCandidates(
    discovered,
    registry,
    jarvisRoot,
    runner,
    daemonClient,
    store,
  );
  const worktreeRefSnapshots = await collectWorktreeRefSnapshots(candidates, registry, runner);
  const daemonUnreachableExit = daemonUnreachable.length > 0 ? 1 : 0;
  const strandedArtifacts = discoverStrandedArtifacts(registry);
  const retiringPaths = new Set(candidates.map((candidate) => candidate.worktree.path));
  const stranded = await inspectStrandedArtifacts(
    strandedArtifacts,
    registry,
    discovered.filter((worktree) => !retiringPaths.has(worktree.path)),
    jarvisRoot,
    store,
    runner,
    io,
  );
  const reaperResult = await reapDeadDaemonSockets(jarvisRoot);

  return {
    branchRefDiscovery,
    discoveryExit,
    discovered,
    candidates,
    worktreeRefSnapshots,
    daemonUnreachableExit,
    strandedArtifacts,
    stranded,
    reaperResult,
    daemonUnreachable,
  };
}

function mergedBranchRefCandidateFromWorktree(
  candidate: CleanupCandidate,
  snapshot: MergedBranchRefSnapshot,
  projectRoot: string,
): MergedBranchRefCandidate {
  const refCandidate: MergedBranchRefCandidate = {
    project: candidate.project,
    branch: candidate.worktree.branch,
    headOid: snapshot.headOid,
    repositoryRoot: projectRoot,
  };
  if (snapshot.trackingRefOid !== undefined) refCandidate.trackingRefOid = snapshot.trackingRefOid;
  return refCandidate;
}

async function previewAllCleanupTargets(
  ctx: CleanupDiscoveryContext,
  registry: Record<string, ProjectRegistryEntry>,
  store: StateStore,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<void> {
  previewWorktreeCandidates(ctx.candidates, registry, store, io);
  for (const candidate of ctx.candidates) {
    const snapshot = ctx.worktreeRefSnapshots.get(candidate.worktree.path);
    if (snapshot === undefined) continue;
    const projectRoot = registry[candidate.project]?.root;
    if (projectRoot === undefined) continue;
    await pruneVerifiedMergedBranchRef(
      mergedBranchRefCandidateFromWorktree(candidate, snapshot, projectRoot),
      runner,
      io,
      { dryRun: true },
    );
  }
  if (ctx.branchRefDiscovery.candidates.length > 0) {
    io.stdout(`Found ${ctx.branchRefDiscovery.candidates.length} eligible merged branch ref(s) for cleanup:\n`);
    for (const candidate of ctx.branchRefDiscovery.candidates) {
      await pruneVerifiedMergedBranchRef(candidate, runner, io, { dryRun: true });
    }
  }
  if (ctx.stranded.length > 0) {
    io.stdout(`Found ${ctx.stranded.length} eligible stranded artifact(s) for cleanup:\n`);
    for (const spec of ctx.stranded) previewArtifact(spec, io);
  }
  previewReaperResult(ctx.reaperResult, io);
}

async function executeConfirmedCleanup(
  ctx: CleanupDiscoveryContext,
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  daemonBlockedExit: number,
): Promise<number> {
  const recheck = await recheckEligibleWorktrees(ctx.candidates, runner, daemonClient, store, io);
  const stillEligible = recheck.candidates;
  const retiredBranches = new Set<string>();
  const result = await retireEligibleWorktrees(
    stillEligible,
    registry,
    ctx.discovered,
    store,
    runner,
    io,
    ctx.worktreeRefSnapshots,
    daemonClient,
    retiredBranches,
  );
  const branchRefExit = await applyMergedBranchRefPrunes(
    ctx.branchRefDiscovery.candidates,
    runner,
    daemonClient,
    store,
    retiredBranches,
    io,
  );
  const socketRemoval = removeDeadDaemonSockets(ctx.reaperResult.dead, io);
  if (socketRemoval !== 0) return socketRemoval;

  const strandedAfterRetirement = await inspectStrandedArtifacts(
    ctx.strandedArtifacts,
    registry,
    await discoverMaterializedWorktrees(registry, jarvisRoot, runner),
    jarvisRoot,
    store,
    runner,
    io,
  );
  await retireStrandedArtifacts(strandedAfterRetirement, registry, jarvisRoot, runner, io);
  if (stillEligible.length === 0 && ctx.candidates.length > 0) {
    io.stdout("No worktrees remain eligible after re-check.\n");
  }
  if (result !== 0 || branchRefExit !== 0) return 1;
  if (recheck.daemonUnreachable || ctx.discoveryExit !== 0) return 1;
  return daemonBlockedExit;
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
  const ctx = await gatherCleanupDiscoveryContext(registry, jarvisRoot, runner, daemonClient, store, io);

  for (const worktree of ctx.daemonUnreachable) {
    io.stdout(`Skipped merged worktree: ${worktree.path} — ${DAEMON_UNREACHABLE_REASON}\n`);
  }

  if (hasNothingToClean(ctx.candidates, ctx.stranded, ctx.reaperResult, ctx.branchRefDiscovery.candidates)) {
    io.stdout("No eligible worktrees or stranded artifacts to clean up.\n");
    return resolveDiscoveryOrDaemonExit(ctx.discoveryExit, ctx.daemonUnreachableExit);
  }

  await previewAllCleanupTargets(ctx, registry, store, runner, io);

  const headOnlyDaemonUnreachableExit = (await hasHeadOnlyDaemonUnreachableSkip(
    ctx.branchRefDiscovery.candidates,
    runner,
    daemonClient,
    store,
    new Set<string>(),
  ))
    ? 1
    : 0;
  const daemonBlockedExit = ctx.daemonUnreachableExit !== 0 || headOnlyDaemonUnreachableExit !== 0 ? 1 : 0;

  if (options.dryRun) {
    io.stdout("(dry-run: no changes made)\n");
    return resolveDiscoveryOrDaemonExit(ctx.discoveryExit, daemonBlockedExit);
  }

  const confirmed = options.promptConfirm !== undefined ? await options.promptConfirm("Apply cleanup? [y/N] ") : false;
  if (!confirmed) {
    io.stdout("Cancelled.\n");
    return resolveDiscoveryOrDaemonExit(ctx.discoveryExit, daemonBlockedExit);
  }

  return executeConfirmedCleanup(ctx, registry, jarvisRoot, runner, daemonClient, store, io, daemonBlockedExit);
}

type WorktreeRefPruneOptions = {
  refPruneSnapshotForCandidate?: (candidate: CleanupCandidate) => MergedBranchRefSnapshot | undefined;
  revalidateRefPrune?: (candidate: CleanupCandidate, snapshot: MergedBranchRefSnapshot) => Promise<EligibilityResult>;
  retiredBranches?: Set<string>;
};

/**
 * Shared retirement sequence: `git worktree remove` (throws on failure) →
 * `worktree prune` (best-effort) → exact local ref prune for head and tracking refs.
 */
async function removeWorktreeAndPruneRefs(
  candidate: CleanupCandidate,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  refPruneOptions?: WorktreeRefPruneOptions,
): Promise<void> {
  const { worktree, project } = candidate;
  await runner.runAsync("git", ["worktree", "remove", worktree.path], projectRoot);
  io.stdout(`Removed worktree: ${worktree.path}\n`);

  try {
    await runner.runAsync("git", ["worktree", "prune"], projectRoot);
  } catch {
    // Prune may fail but shouldn't block the operation
  }

  refPruneOptions?.retiredBranches?.add(worktree.branch);

  const snapshot =
    refPruneOptions?.refPruneSnapshotForCandidate?.(candidate) ??
    (await snapshotMergedBranchRefs(projectRoot, worktree.branch, runner));
  if (snapshot === undefined) {
    throw new Error("local head missing after worktree removal");
  }

  if (refPruneOptions?.revalidateRefPrune !== undefined) {
    const eligibility = await refPruneOptions.revalidateRefPrune(candidate, snapshot);
    if (eligibility.status === "ineligible") {
      throw new Error(eligibility.reason);
    }
  }

  const refCandidate: MergedBranchRefCandidate = {
    project,
    branch: worktree.branch,
    headOid: snapshot.headOid,
    repositoryRoot: projectRoot,
  };
  if (snapshot.trackingRefOid !== undefined) refCandidate.trackingRefOid = snapshot.trackingRefOid;
  const pruneResult = await pruneVerifiedMergedBranchRef(refCandidate, runner, io);
  if (pruneResult !== 0) {
    throw new Error("ref prune failed");
  }
}

/**
 * Retire eligible worktrees via `git worktree remove` + `prune` + exact local ref prune.
 * Exit nonzero if any removal fails, leaving other candidates intact.
 */
export async function performWorktreeRemovals(
  candidates: CleanupCandidate[],
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  afterRetirement?: (candidate: CleanupCandidate) => Promise<void>,
  projectRootForCandidate: (candidate: CleanupCandidate) => string = () => ".",
  refPruneOptions?: WorktreeRefPruneOptions,
): Promise<number> {
  let failed = false;

  for (const candidate of candidates) {
    const worktree = candidate.worktree;
    try {
      await removeWorktreeAndPruneRefs(candidate, projectRootForCandidate(candidate), runner, io, refPruneOptions);
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

export type DirtyWorktreeListResult =
  | { status: "clean" }
  | { status: "dirty"; paths: string[] }
  | { status: "not-git-repository" }
  | { status: "error"; message: string };

export const STALE_RESET_OVERRIDE_CLI_FLAG = "--reset-despite-dirty";
export const STALE_RESET_LANDED_CRITERIA_OVERRIDE_CLI_FLAG = "--reset-despite-landed-criteria";

const staleResetDirtyRecovery = `commit, discard local changes, pass ${STALE_RESET_OVERRIDE_CLI_FLAG} on re-run, or run \`jarvis cleanup --abandon <branch>\``;
const staleResetLandedCriteriaRecovery = `pass ${STALE_RESET_LANDED_CRITERIA_OVERRIDE_CLI_FLAG} on re-run, or run \`jarvis cleanup --abandon <branch>\``;
const staleResetListingErrorRecovery = `commit, discard local changes, or run \`jarvis cleanup --abandon <branch>\``;

export async function isDescendantOfBase(
  worktreeHead: string,
  baseRef: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["merge-base", "--is-ancestor", baseRef, worktreeHead], projectRoot, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function specTreeRelPaths(projectRoot: string, specPath: string, readFile: (absPath: string) => string): string[] {
  const absoluteSpecPath = isAbsolute(specPath) ? specPath : resolve(projectRoot, specPath);
  const specContent = readFile(absoluteSpecPath);
  const linkedSubspecs = parseSpec(specContent).linkedSubspecs;
  if (basename(absoluteSpecPath) !== "index.md" || linkedSubspecs.length === 0) {
    return [relative(projectRoot, absoluteSpecPath)];
  }
  return linkedSubspecs.map((link) => {
    const subspecPath = isAbsolute(link.path) ? link.path : resolve(dirname(absoluteSpecPath), link.path);
    return relative(projectRoot, subspecPath);
  });
}

function hasLandedCriteriaTicksAbsentFromBase(worktreeContent: string, baseContent: string): boolean {
  const worktreeCriteria = parseSpec(worktreeContent).acceptanceCriteria.filter((criterion) => !criterion.humanOnly);
  const baseCriteria = parseSpec(baseContent).acceptanceCriteria.filter((criterion) => !criterion.humanOnly);
  for (let index = 0; index < worktreeCriteria.length; index += 1) {
    const worktreeCriterion = worktreeCriteria[index];
    if (worktreeCriterion === undefined || !worktreeCriterion.checked) continue;
    const baseCriterion = baseCriteria[index];
    if (baseCriterion === undefined || !baseCriterion.checked) return true;
  }
  return false;
}

type LandedCriteriaSpecTree = {
  projectRoot: string;
  worktreePath: string;
  baseRef: string;
  specPath: string;
  runner: AsyncSubprocessRunner;
};

async function collectLandedCriteriaDrift(specTree: LandedCriteriaSpecTree): Promise<string[]> {
  const { projectRoot, worktreePath, baseRef, specPath, runner } = specTree;
  const relPaths = specTreeRelPaths(projectRoot, specPath, (absPath) => {
    const worktreeAbsPath = join(worktreePath, relative(projectRoot, absPath));
    if (!existsSync(worktreeAbsPath)) throw new Error(`worktree spec unreadable: ${relative(projectRoot, absPath)}`);
    return readFileSync(worktreeAbsPath, "utf8");
  });
  const drifted: string[] = [];
  for (const relPath of relPaths) {
    const worktreeAbsPath = join(worktreePath, relPath);
    if (!existsSync(worktreeAbsPath)) continue;
    const worktreeContent = readFileSync(worktreeAbsPath, "utf8");
    const baseContent = await readGitFileAtRef(projectRoot, baseRef, relPath, runner);
    if (baseContent === undefined) {
      if (
        parseSpec(worktreeContent).acceptanceCriteria.some((criterion) => !criterion.humanOnly && criterion.checked)
      ) {
        drifted.push(relPath);
      }
      continue;
    }
    if (hasLandedCriteriaTicksAbsentFromBase(worktreeContent, baseContent)) drifted.push(relPath);
  }
  return drifted;
}

export async function landedCriteriaAbsentFromBase(specTree: LandedCriteriaSpecTree): Promise<string[]> {
  return collectLandedCriteriaDrift(specTree);
}

async function readGitFileAtRef(
  projectRoot: string,
  baseRef: string,
  relPath: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  try {
    return await runner.runAsync("git", ["show", `${baseRef}:${relPath}`], projectRoot);
  } catch {
    return undefined;
  }
}

async function resolveStaleResetRef(
  projectRoot: string,
  gitRef: string,
  runner: AsyncSubprocessRunner,
): Promise<string> {
  return (await runner.runAsync("git", ["rev-parse", gitRef], projectRoot)).trim();
}

function staleResetDescendantGateReason(baseRef: string, baseHead: string, worktreeHead: string): string {
  return `worktree HEAD ${worktreeHead} is not a descendant of base ${baseRef} (${baseHead}); stale reuse refused`;
}

function staleResetLandedCriteriaGateReason(driftedSubspecPaths: string[]): string {
  const pathDetail = driftedSubspecPaths.join(", ");
  return `worktree spec has acceptance criteria ticked that are unticked on base (${pathDetail}); ${staleResetLandedCriteriaRecovery} to retire the workspace, then re-run`;
}

function combineStaleResetRefusalReasons(parts: string[]): string {
  return parts.join("; ");
}

export async function listDirtyWorktreePathsForStaleReset(
  worktreePath: string,
  runner: AsyncSubprocessRunner,
): Promise<DirtyWorktreeListResult> {
  try {
    const output = await runner.runAsync("git", ["status", "--porcelain", "--untracked-files=all"], worktreePath);
    const lines = output.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) return { status: "clean" };
    const paths: string[] = [];
    for (const line of lines) {
      let path = line.slice(3).trim();
      const arrow = path.lastIndexOf(" -> ");
      if (arrow >= 0) path = path.slice(arrow + 4).trim();
      if (path) paths.push(path);
    }
    return { status: "dirty", paths };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return hasNotGitRepositoryDiagnostic(err) ? { status: "not-git-repository" } : { status: "error", message };
  }
}

function hasNotGitRepositoryDiagnostic(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const stderr =
    typeof error === "object" && error !== null && typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr
      : "";
  return `${message}\n${stderr}`.includes("not a git repository");
}

export function staleResetDirtyWorktreeGateReason(
  listResult: DirtyWorktreeListResult,
  skipDirtyWorktreeGate = false,
): string | undefined {
  if (listResult.status === "dirty") {
    if (skipDirtyWorktreeGate) return undefined;
    const pathDetail = listResult.paths.length > 0 ? listResult.paths.join(", ") : "unparseable git status output";
    return `worktree has uncommitted changes (${pathDetail}); ${staleResetDirtyRecovery} to retire the workspace, then re-run`;
  }
  if (listResult.status === "error") {
    return `could not list worktree changes (${listResult.message}); ${staleResetListingErrorRecovery} before re-running`;
  }
  return undefined;
}

export type ResetStaleWorkspaceOptions = {
  skipDirtyWorktreeGate?: boolean;
  skipLandedCriteriaGate?: boolean;
  baseRef?: string;
  specPath?: string;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the ordered preflight gate sequence (descendant → preserve-landed-criteria → dirty → retirement) is one boundary
export async function resetStaleWorkspace(
  project: string,
  branch: string,
  projectRoot: string,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  options: ResetStaleWorkspaceOptions = {},
): Promise<
  | { status: "reset" | "no-op"; destroyed?: DestroyedArtifacts }
  | { status: "refused"; code: "worktree_claimed"; message: string }
  | { status: "refused"; reason: string; destroyed?: DestroyedArtifacts }
> {
  const worktreePath = join(jarvisRoot, "worktrees", project, branch);
  if (!existsSync(worktreePath)) return { status: "no-op" };

  const liveCheck = await isWorktreeLiveHeld(project, branch, jarvisRoot, daemonClient);
  if (liveCheck.live) return { status: "refused", reason: liveCheck.reason };

  const prGate = await gateOnOpenPrs(branch, runner);
  if (prGate.status === "refused") return { status: "refused", reason: prGate.reason };

  const claimProbe = daemonClient.checkWorkflowStartClaim;
  if (claimProbe === undefined) {
    return { status: "refused", reason: "daemon client missing workflow start claim probe" };
  }
  try {
    const claimResult = await claimProbe(project, branch);
    if (claimResult.status === "claimed") {
      return { status: "refused", code: "worktree_claimed", message: claimResult.message };
    }
  } catch (error) {
    return {
      status: "refused",
      reason: `daemon claim check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const dirtyList = await listDirtyWorktreePathsForStaleReset(worktreePath, runner);
  if (dirtyList.status === "not-git-repository") return { status: "no-op" };

  const refusalParts: string[] = [];
  const skipDirtyWorktreeGate = options.skipDirtyWorktreeGate === true;
  const skipLandedCriteriaGate = options.skipLandedCriteriaGate === true;
  const baseRef = options.baseRef;
  const specPath = options.specPath;

  if (baseRef !== undefined) {
    const [worktreeHead, baseHead] = await Promise.all([
      resolveStaleResetRef(worktreePath, "HEAD", runner),
      resolveStaleResetRef(projectRoot, baseRef, runner),
    ]);
    if (!(await isDescendantOfBase(worktreeHead, baseRef, projectRoot, runner))) {
      refusalParts.push(staleResetDescendantGateReason(baseRef, baseHead, worktreeHead));
    }
    if (specPath !== undefined) {
      const specTree = { projectRoot, worktreePath, baseRef, specPath, runner };
      const driftedSubspecPaths = await landedCriteriaAbsentFromBase(specTree);
      if (driftedSubspecPaths.length > 0 && !skipLandedCriteriaGate) {
        refusalParts.push(staleResetLandedCriteriaGateReason(driftedSubspecPaths));
      }
    }
  }

  if (dirtyList.status === "error") {
    const listingReason = staleResetDirtyWorktreeGateReason(dirtyList, false);
    if (listingReason !== undefined) refusalParts.push(listingReason);
  } else if (dirtyList.status === "dirty") {
    if (!skipDirtyWorktreeGate) {
      const dirtyReason = staleResetDirtyWorktreeGateReason(dirtyList, false);
      if (dirtyReason !== undefined) refusalParts.push(dirtyReason);
    } else if (refusalParts.length > 0) {
      const pathDetail = dirtyList.paths.length > 0 ? dirtyList.paths.join(", ") : "unparseable git status output";
      refusalParts.push(`worktree has uncommitted changes (${pathDetail})`);
    }
  }

  if (refusalParts.length > 0) {
    return { status: "refused", reason: combineStaleResetRefusalReasons(refusalParts) };
  }

  const abandonResult = await performAbandonmentSteps(branch, worktreePath, projectRoot, prGate.pr?.number, runner, io);
  if (abandonResult.ok) return { status: "reset", destroyed: abandonResult.destroyed };
  return {
    status: "refused",
    reason: `retirement failed at ${abandonResult.step}; ${remainingArtifactsAfter(abandonResult.step)}`,
    destroyed: abandonResult.destroyed,
  };
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

/** Retirement steps, in execution order. */
type RetirementStep =
  | "worktree removal"
  | "local branch deletion"
  | "remote branch deletion"
  | "remote tracking ref deletion"
  | "PR closure";

export type DestroyedArtifacts = {
  closedPrNumber?: number;
  worktreePath?: string;
  localBranch?: string;
  remoteBranch?: string;
  remoteTrackingRef?: string;
};

type AbandonOutcome =
  | { ok: true; destroyed: DestroyedArtifacts }
  | { ok: false; step: RetirementStep; destroyed: DestroyedArtifacts };

/** Artifacts a caller still owns after retirement aborted at `step`. */
function remainingArtifactsAfter(step: RetirementStep): string {
  switch (step) {
    case "worktree removal":
      return "worktree, local branch, remote branch, and PR remain";
    case "local branch deletion":
      return "local branch, remote branch, and PR remain (worktree removed)";
    case "remote branch deletion":
      return "remote branch and PR remain (worktree and local branch removed)";
    case "remote tracking ref deletion":
      return "remote-tracking ref and PR remain (worktree, local branch, and remote branch removed)";
    case "PR closure":
      return "PR remains open (worktree, local branch, remote branch, and remote-tracking ref removed)";
  }
}

async function pruneStaleOriginRemoteTrackingRef(
  branch: string,
  cwd: string,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
): Promise<{ ok: true; pruned?: string } | { ok: false; message: string }> {
  if (!(await originTrackingRefResolvesAsync(cwd, branch, runner))) {
    return { ok: true };
  }
  try {
    await runner.runAsync("git", ["update-ref", "-d", `refs/remotes/origin/${branch}`], cwd);
    if (await originTrackingRefResolvesAsync(cwd, branch, runner)) {
      return { ok: false, message: "remote-tracking ref still resolves after prune" };
    }
    const label = `origin/${branch}`;
    io.stdout(`Pruned stale remote-tracking ref: ${label}\n`);
    return { ok: true, pruned: label };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * True when `git push origin --delete` failed because the remote branch is
 * already gone — the goal state, not a failure.
 */
function isRemoteRefAlreadyAbsent(err: unknown): boolean {
  const text =
    err instanceof AsyncSubprocessError
      ? `${err.message}\n${err.stderr}`
      : err instanceof Error
        ? err.message
        : String(err);
  return /remote ref does not exist/i.test(text);
}

/**
 * Deletes the remote branch, treating "already absent" as success: a workspace
 * whose run died before its first push, or a repo with no `origin`, has no
 * remote ref to delete. Genuine failures (auth, network, protected ref) fail.
 */
async function deleteRemoteBranch(
  branch: string,
  cwd: string,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await runner.runAsync("git", ["remote", "get-url", "origin"], cwd);
  } catch {
    io.stdout(`No origin remote; remote branch ${branch} already absent\n`);
    return { ok: true };
  }

  try {
    await runner.runAsync("git", ["push", "origin", "--delete", branch], cwd);
    io.stdout(`Deleted remote branch: ${branch}\n`);
    return { ok: true };
  } catch (err) {
    if (isRemoteRefAlreadyAbsent(err)) {
      io.stdout(`Remote branch ${branch} already absent\n`);
      return { ok: true };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function performAbandonmentSteps(
  branch: string,
  worktreePath: string,
  projectRoot: string | undefined,
  prNumber: number | undefined,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<AbandonOutcome> {
  const cwd = projectRoot ?? ".";
  const destroyed: DestroyedArtifacts = {};

  try {
    await runner.runAsync("git", ["worktree", "remove", "--force", worktreePath], cwd);
    io.stdout(`Removed worktree: ${worktreePath}\n`);
    destroyed.worktreePath = worktreePath;
  } catch (err) {
    io.stderr(`Failed to remove worktree: ${err instanceof Error ? err.message : String(err)}\n`);
    return { ok: false, step: "worktree removal", destroyed };
  }

  try {
    await runner.runAsync("git", ["worktree", "prune"], cwd);
  } catch {
    // Prune may fail but shouldn't block the operation
  }

  try {
    await runner.runAsync("git", ["branch", "-D", branch], cwd);
    io.stdout(`Deleted local branch: ${branch}\n`);
    destroyed.localBranch = branch;
  } catch (err) {
    io.stderr(`Failed to delete local branch ${branch}: ${err instanceof Error ? err.message : String(err)}\n`);
    return { ok: false, step: "local branch deletion", destroyed };
  }

  const remote = await deleteRemoteBranch(branch, cwd, runner, io);
  if (!remote.ok) {
    io.stderr(`Failed to delete remote branch ${branch}: ${remote.message}\n`);
    return { ok: false, step: "remote branch deletion", destroyed };
  }
  destroyed.remoteBranch = branch;

  const pruneTracking = await pruneStaleOriginRemoteTrackingRef(branch, cwd, runner, io);
  if (!pruneTracking.ok) {
    io.stderr(`Failed to prune remote-tracking ref origin/${branch}: ${pruneTracking.message}\n`);
    return { ok: false, step: "remote tracking ref deletion", destroyed };
  }
  if (pruneTracking.pruned !== undefined) {
    destroyed.remoteTrackingRef = pruneTracking.pruned;
  }

  if (prNumber !== undefined) {
    try {
      await runner.runAsync("gh", ["pr", "close", String(prNumber)], cwd);
      io.stdout(`Closed PR #${prNumber}\n`);
      destroyed.closedPrNumber = prNumber;
    } catch (err) {
      io.stderr(`Failed to close PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}\n`);
      return { ok: false, step: "PR closure", destroyed };
    }
  }

  return { ok: true, destroyed };
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
  io.stdout(`  remove: worktree at ${worktreePath}\n`);
  io.stdout(`  delete: local branch ${branch}\n`);
  io.stdout(`  delete: remote branch ${branch}\n`);
  if (projectRoot !== undefined && (await originTrackingRefResolvesAsync(projectRoot, branch, runner))) {
    io.stdout(`  prune: stale remote-tracking ref origin/${branch}\n`);
  }
  if (prNumber !== undefined) {
    io.stdout(`  close: PR #${prNumber}\n`);
  }

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
  if (!result.ok) {
    io.stderr(`Retirement stopped at ${result.step}: ${remainingArtifactsAfter(result.step)}\n`);
    return 1;
  }

  io.stdout(`Abandoned workspace: ${workspaceName}\n`);
  return 0;
}
