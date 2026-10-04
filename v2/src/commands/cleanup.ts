import {
  type Dir,
  type Dirent,
  existsSync,
  opendirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { errorMessage } from "../../../shared/error-message.ts";
import {
  abortableWorktreeMergeNoEdit,
  abortableWorktreeRebase,
  deleteBranch,
  diffNameOnly,
  diffNameOnlyRevision,
  countCommitsBetween,
  deleteRef,
  getBaseBranch,
  getCurrentBranchAsync,
  getCurrentHeadAsync,
  getGitStatusInventory,
  gitCommonDir,
  GitOperationError,
  isGitRepoAsync,
  isInsideWorkTree,
  isNotGitRepositoryDiagnostic,
  isAncestor,
  type LocalBranchHead,
  listLocalBranchHeads,
  listRecursivePathsAtRef,
  listTreeChildrenAtRef,
  listWorktrees,
  logPatchForPathInRange,
  lsRemoteRef,
  mergeBase,
  mergeTreeWriteTree,
  originTrackingRefResolvesAsync,
  pruneWorktrees,
  pushBranch,
  readBlobAtRef,
  remoteUrl,
  removeWorktree,
  resolveRef,
} from "../../../shared/git.ts";
import { isRecord } from "../../../shared/is-record.ts";
import { resolvePlanTargetDir } from "../../../shared/plan-target-dir.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { projectSafeId } from "../../../shared/project-safe-id.ts";
import { type AcceptanceCriterion, parseSpec } from "../../../shared/spec-parser.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { isProcessAlive, type WorktreeLock } from "../../../shared/worktree-lock.ts";
import type { CliDeps } from "../cli/deps.ts";
import { request } from "../cli/ipc.ts";
import {
  readMachineConfigDocument,
  readProjectConfigRecord,
  readRetentionSessions,
} from "../config/machine-config-loader.ts";
import { type DaemonListResult, parseListRuns } from "../daemon/daemon-wire.ts";
import { publishArchiveReady } from "../execution/completion-publisher.ts";
import { isMaterializedNodeModulesPath } from "../execution/external-worktree.ts";
import {
  closePr,
  GitHubOperationError,
  listPrs,
  viewPrReviewActivity,
  viewPrState,
} from "../execution/github-operations.ts";
import {
  planSourcePublishesExternally,
  resolveExternalPlanSpecIdentity,
} from "../execution/implement-workflow-steps.ts";
import { parseTerminalSupersedeSettlementSuccessorPrNumber } from "../execution/terminal-supersede-settlement.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { jarvisHome, managedWorktreePath, specsHome, worktreesRoot as worktreesRootPath } from "../paths.ts";
import { isTerminalRunStatus, type Run, type StateStore } from "../persistence/state-store.ts";
import {
  type ArchivePublicationResult,
  type ArchivePublicationSession,
  type ArchivePublicationTarget,
  cleanupBranchCarryingArchive,
  committedBlobIdsAtRef,
  createArchivePublicationSession,
} from "./cleanup-archive-publication.ts";
import {
  type ArchiveResult,
  type ArtifactEligibility,
  type ArtifactFs,
  type ArtifactSpec,
  archiveCompletedSpec,
  checkArtifactEligibility,
  completedSpecEligibility,
  consumedExternalReadyIntentPlan,
  isExternalPlanArtifact,
  pruneConsumedQueueEntry,
  resolveConsumedReadyIntent,
} from "./cleanup-artifacts.ts";
import { daemonUnitKeysFromNames, type LegacyDaemonArtifactDeps, reapLegacyDaemonArtifacts } from "./daemon.ts";

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
  const worktreesRoot = worktreesRootPath(jarvisRoot);

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
    return await isInsideWorkTree(worktreePath, runner);
  } catch {
    return false;
  }
}

export type EligibilityResult =
  | { status: "eligible"; skipSpecArchival?: boolean }
  | { status: "ineligible"; reason: string };

export type CheckEligibilityContext = {
  projectRoot: string;
  registry: Record<string, ProjectRegistryEntry>;
  configPath?: string;
};

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
    const result = await request(client, "list", { includeDismissed: true });
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

export type QueryDaemonListsDeps = Pick<CliDeps, "connectIpcClient" | "socketPath">;

/** Query the stable daemon socket only; no discovery, no cross-socket merge. */
async function queryStableDaemonList(
  deps: QueryDaemonListsDeps,
): Promise<{ list: DaemonListResult | undefined; error: unknown }> {
  try {
    const client = await deps.connectIpcClient(deps.socketPath);
    try {
      const result = await request(client, "list", { includeDismissed: true });
      const list = parseListRuns(result);
      return { list, error: list === undefined ? new Error("invalid daemon response") : undefined };
    } finally {
      client.close();
    }
  } catch (error) {
    return { list: undefined, error };
  }
}

export async function createBulkCleanupDaemonClient(deps: QueryDaemonListsDeps): Promise<{
  client: DaemonClient;
  hasAnsweringDaemon: boolean;
  firstError: unknown;
}> {
  const initial = await queryStableDaemonList(deps);
  const hasAnsweringDaemon = initial.list !== undefined;

  const client: DaemonClient = async (project, branch) => {
    const { list } = await queryStableDaemonList(deps);
    if (list === undefined) throw new Error(DAEMON_UNREACHABLE_REASON);
    return list.runs
      .filter((row) => row.project === project && row.branch === branch)
      .map((row) => ({ isLive: row.isLive }));
  };

  return { client, hasAnsweringDaemon, firstError: initial.error };
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
async function worktreeRetirementGuardEligibility(
  project: string,
  branch: string,
  daemonClient: DaemonClient,
  store: StateStore,
): Promise<EligibilityResult> {
  const run = store
    .listRuns()
    .find((entry) => entry.project === project && entry.branch === branch && !isTerminalRunStatus(entry.status));
  if (run !== undefined) {
    return {
      status: "ineligible",
      reason: `Non-terminal run exists: status=${run.status}`,
    };
  }

  try {
    const daemonRuns = await daemonClient(project, branch);
    if (daemonRuns.some((r) => r.isLive)) {
      return { status: "ineligible", reason: "Daemon reports live run" };
    }
  } catch {
    return { status: "ineligible", reason: DAEMON_UNREACHABLE_REASON };
  }

  return { status: "eligible" };
}

export async function checkEligibility(
  candidate: DiscoveredWorktree,
  project: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  context?: CheckEligibilityContext,
): Promise<EligibilityResult> {
  if (candidate.branch === undefined) return { status: "ineligible", reason: "Could not determine branch" };
  const branch = candidate.branch;
  const ghCwd = context?.projectRoot ?? ".";
  const mergedResult = await isMerged(branch, runner, ghCwd);
  if (mergedResult.merged) {
    return worktreeRetirementGuardEligibility(project, branch, daemonClient, store);
  }

  if (context !== undefined && branch.startsWith("plan/")) {
    const configPath = context.configPath ?? join(jarvisHome(), "config.json");
    const subsumed = await evaluatePlanLaneSubsumedEligibility(
      { worktree: { ...candidate, branch }, project },
      context.projectRoot,
      runner,
      store,
      context.registry,
      configPath,
    );
    if (subsumed.status === "eligible") {
      const guards = await worktreeRetirementGuardEligibility(project, branch, daemonClient, store);
      if (guards.status === "ineligible") return guards;
      return { status: "eligible", skipSpecArchival: true };
    }
  }

  const localHeadOid = await resolveExactRefOid(ghCwd, `refs/heads/${branch}`, runner);
  if (
    localHeadOid !== undefined &&
    (await supersededPipelinePrHeadAuthorityMatches(branch, localHeadOid, ghCwd, runner))
  ) {
    return worktreeRetirementGuardEligibility(project, branch, daemonClient, store);
  }

  return { status: "ineligible", reason: `PR not merged: ${mergedResult.reason}` };
}

async function implementSpecTreeOnCompletedAtDefaultBranch(
  projectRoot: string,
  specIndexRel: string,
  targetDir: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  const baseBranch = await getBaseBranch(projectRoot, runner);
  const completedAbs = join(projectRoot, targetDir, "completed", basename(dirname(specIndexRel)));
  return (await specTreeFsAtRef(projectRoot, completedAbs, baseBranch, runner)) !== undefined;
}

/** Report line when an implement lane's spec already lives under `completed/` on the default branch. */
export async function evaluateImplementLandedElsewhereReport(
  worktree: DiscoveredWorktree,
  project: string,
  branch: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
): Promise<string | undefined> {
  if (branch.startsWith("plan/")) return undefined;
  const mergedResult = await isMerged(branch, runner, projectRoot);
  if (mergedResult.merged) return undefined;
  if (!(await planSubsumedPrGateAllows(branch, projectRoot, runner))) return undefined;
  const candidate: CleanupCandidate = { worktree: { ...worktree, branch }, project };
  const specIndexPath = resolveMergedWorktreeSpecIndexPath(candidate, projectRoot, store, registry, {
    acceptWorktreeReadableIndex: true,
  });
  if (specIndexPath === undefined) return undefined;
  const targetDir = planTargetDirForProject(project, configPath);
  if (!(await implementSpecTreeOnCompletedAtDefaultBranch(projectRoot, specIndexPath, targetDir, runner))) {
    return undefined;
  }
  return `PR not merged: ${mergedResult.reason}`;
}

type MergedCheckResult = { merged: true } | { merged: false; reason: string };

/**
 * Check if a branch's PR is merged using `gh pr view <branch> --json state,mergedAt`.
 * This command includes merged PRs (unlike `gh pr list --head` which defaults to open).
 */
async function isMerged(branch: string, runner: AsyncSubprocessRunner, cwd = "."): Promise<MergedCheckResult> {
  try {
    const view = await viewPrState(runner, cwd, branch, networkSubprocessOptions());
    if (view.state === "MERGED" && view.mergedAt) {
      return { merged: true };
    }
    return { merged: false, reason: `PR state is ${view.state}` };
  } catch (err) {
    if (err instanceof GitHubOperationError || err instanceof AsyncSubprocessError) {
      return { merged: false, reason: `gh failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { merged: false, reason: `Unexpected error: ${String(err)}` };
  }
}

export type CleanupCandidate = {
  worktree: DiscoveredWorktree & { branch: string };
  project: string;
  skipSpecArchival?: boolean;
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
  ownerProjectsByRepositoryRoot: ReadonlyMap<string, readonly string[]>;
  unusableProjects: UnusableRegisteredProject[];
};

export type DiscoverMergedBranchRefCandidatesOptions = {
  /** Registered projects used to find every key sharing a Git common directory. */
  ownershipRegistry?: Record<string, ProjectRegistryEntry>;
  runner?: AsyncSubprocessRunner;
  /** Branch names retired successfully earlier in this cleanup invocation. */
  retiredBranches?: ReadonlySet<string>;
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

function checkedOutBranchSet(entries: ReadonlyArray<{ branch?: string }>): Set<string> {
  return new Set(entries.map((entry) => entry.branch).filter((branch): branch is string => branch !== undefined));
}

async function ghPrHeadRecordsForBranch(branch: string, repoRoot: string, runner: AsyncSubprocessRunner) {
  try {
    return await listPrs(runner, repoRoot, { branch, state: "all" }, networkSubprocessOptions());
  } catch {
    return undefined;
  }
}

/** True when one merged PR in `repoRoot` matches `localHeadOid` and no open PR owns the branch. */
export async function mergedPrHeadAuthorityMatches(
  branch: string,
  localHeadOid: string,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  const parsed = await ghPrHeadRecordsForBranch(branch, repoRoot, runner);
  if (parsed === undefined) return false;
  if (parsed.some((pr) => pr.state === "OPEN")) return false;
  const mergedMatches = parsed.filter((pr) => pr.state === "MERGED" && pr.mergedAt && pr.headRefOid === localHeadOid);
  return mergedMatches.length === 1;
}

async function listGhPrCommentBodies(
  prNumber: number,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<string[] | undefined> {
  try {
    const activity = await viewPrReviewActivity(runner, repoRoot, prNumber, networkSubprocessOptions());
    if (!Array.isArray(activity.comments)) return undefined;
    return activity.comments.flatMap((comment) => (typeof comment.body === "string" ? [comment.body] : []));
  } catch {
    return undefined;
  }
}

async function ghSuccessorPrMergedInRepo(
  successorPrNumber: number,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  try {
    const view = await viewPrState(runner, repoRoot, successorPrNumber, networkSubprocessOptions());
    if (view.isCrossRepository === true) return false;
    return view.state === "MERGED" && Boolean(view.mergedAt);
  } catch {
    return false;
  }
}

/** True when a closed head-owning PR bears terminal supersede settlement and its successor PR merged. */
export async function supersededPipelinePrHeadAuthorityMatches(
  branch: string,
  localHeadOid: string,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  const parsed = await ghPrHeadRecordsForBranch(branch, repoRoot, runner);
  if (parsed === undefined) return false;
  if (parsed.some((pr) => pr.state === "OPEN")) return false;
  const closedHeadMatches = parsed.filter(
    (pr) => pr.state === "CLOSED" && pr.headRefOid === localHeadOid && typeof pr.number === "number",
  );
  if (closedHeadMatches.length !== 1) return false;
  const closedPrNumber = closedHeadMatches[0]?.number;
  if (closedPrNumber === undefined) return false;

  const commentBodies = await listGhPrCommentBodies(closedPrNumber, repoRoot, runner);
  if (commentBodies === undefined) return false;

  for (const body of commentBodies) {
    const successorPrNumber = parseTerminalSupersedeSettlementSuccessorPrNumber(body);
    if (successorPrNumber === undefined) continue;
    if (await ghSuccessorPrMergedInRepo(successorPrNumber, repoRoot, runner)) return true;
  }
  return false;
}

/** True when no OPEN PR owns the branch; absent or CLOSED PRs are allowed. Fails closed on probe errors. */
export async function planSubsumedPrGateAllows(
  branch: string,
  repoRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  try {
    const rows = await listPrs(runner, repoRoot, { branch, state: "all" }, networkSubprocessOptions());
    return !rows.some((pr) => pr.state === "OPEN");
  } catch {
    return false;
  }
}

function planTargetDirForProject(project: string, configPath: string): string {
  const projectRecord = readProjectConfigRecord(project, configPath);
  const plan = projectRecord?.plan;
  const projectTargetDir = isRecord(plan) && typeof plan.targetDir === "string" ? plan.targetDir : undefined;
  const modes = readMachineConfigDocument(configPath)?.modes;
  const modePlan = isRecord(modes) ? modes.plan : undefined;
  const modeTargetDir = isRecord(modePlan) && typeof modePlan.targetDir === "string" ? modePlan.targetDir : undefined;
  return resolvePlanTargetDir({ projectTargetDir, modeTargetDir });
}

function isRepoRelativePath(projectRoot: string, absPath: string): string | undefined {
  const rel = relative(projectRoot, absPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel;
}

function planLaneSpecDirFromRuns(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
): string | undefined {
  const artifact = artifactForRetiredWorktree(candidate, projectRoot, store, registry);
  if (artifact !== undefined) {
    if (isExternalPlanArtifact(artifact)) return undefined;
    const rel = isRepoRelativePath(projectRoot, artifact.source);
    if (rel !== undefined) {
      if (existsSync(join(artifact.source, "index.md"))) return rel;
      if (artifact.source.endsWith(".md")) return dirname(rel);
    }
  }
  const indexPath = resolveMergedWorktreeSpecIndexPath(candidate, projectRoot, store, registry, {
    acceptWorktreeReadableIndex: true,
  });
  if (indexPath !== undefined) return dirname(indexPath);
  return undefined;
}

async function inferShallowestPlanSpecDirFromDiff(
  projectRoot: string,
  branch: string,
  baseRef: string,
  targetDir: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  const paths = await diffNameOnlyRevision(projectRoot, `${baseRef}...${branch}`, runner);
  const prefix = targetDir.endsWith("/") ? targetDir : `${targetDir}/`;
  let best: string | undefined;
  let bestDepth = Number.POSITIVE_INFINITY;
  for (const line of paths) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix) || !trimmed.endsWith("index.md")) continue;
    const specDir = dirname(trimmed);
    const depth = specDir.split("/").length;
    if (depth < bestDepth) {
      bestDepth = depth;
      best = specDir;
    }
  }
  return best;
}

async function resolvePlanLaneSpecDirRel(
  candidate: CleanupCandidate,
  projectRoot: string,
  branch: string,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  const fromRuns = planLaneSpecDirFromRuns(candidate, projectRoot, store, registry);
  if (fromRuns !== undefined) return fromRuns;
  const baseBranch = await getBaseBranch(projectRoot, runner);
  const baseRef = await resolveStaleResetRef(projectRoot, baseBranch, runner);
  const targetDir = planTargetDirForProject(candidate.project, configPath);
  return inferShallowestPlanSpecDirFromDiff(projectRoot, branch, baseRef, targetDir, runner);
}

function planLaneAllowedPathPrefixes(
  projectRoot: string,
  specDirRel: string,
  candidate: CleanupCandidate,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
): string[] {
  const prefixes = [specDirRel];
  const artifact = artifactForRetiredWorktree(candidate, projectRoot, store, registry);
  if (artifact !== undefined && !isExternalPlanArtifact(artifact)) {
    const readyIntent = resolveConsumedReadyIntent(artifact);
    if (readyIntent !== undefined) {
      const rel = isRepoRelativePath(projectRoot, readyIntent);
      if (rel !== undefined) prefixes.push(rel);
    }
  }
  return prefixes;
}

async function planLaneSpecPresentOnDefaultBranch(
  projectRoot: string,
  specDirRel: string,
  targetDir: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  const baseBranch = await getBaseBranch(projectRoot, runner);
  const specAbs = join(projectRoot, specDirRel);
  if ((await specTreeFsAtRef(projectRoot, specAbs, baseBranch, runner)) !== undefined) return true;
  const completedAbs = join(projectRoot, targetDir, "completed", basename(specDirRel));
  return (await specTreeFsAtRef(projectRoot, completedAbs, baseBranch, runner)) !== undefined;
}

async function evaluatePlanLaneSubsumedEligibility(
  candidate: CleanupCandidate,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
): Promise<EligibilityResult> {
  const branch = candidate.worktree.branch;
  if (!branch.startsWith("plan/")) {
    return { status: "ineligible", reason: "not a plan lane" };
  }
  if (!(await planSubsumedPrGateAllows(branch, projectRoot, runner))) {
    return { status: "ineligible", reason: "plan-lane PR gate failed" };
  }
  const specDirRel = await resolvePlanLaneSpecDirRel(
    candidate,
    projectRoot,
    branch,
    store,
    registry,
    configPath,
    runner,
  );
  if (specDirRel === undefined) {
    return { status: "ineligible", reason: "plan-lane spec directory unresolved" };
  }
  const targetDir = planTargetDirForProject(candidate.project, configPath);
  const baseBranch = await getBaseBranch(projectRoot, runner);
  const baseRef = await resolveStaleResetRef(projectRoot, baseBranch, runner);
  const allowedPrefixes = planLaneAllowedPathPrefixes(projectRoot, specDirRel, candidate, store, registry);
  const nonStagingPaths = await unlandedNonStagingPaths(projectRoot, branch, baseRef, runner, allowedPrefixes, {
    mergeBase: true,
  });
  if (nonStagingPaths.length > 0) {
    return { status: "ineligible", reason: "plan-lane has unlanded paths outside allowed scope" };
  }
  if (!(await planLaneSpecPresentOnDefaultBranch(projectRoot, specDirRel, targetDir, runner))) {
    return { status: "ineligible", reason: "plan-lane spec absent from default branch" };
  }
  return { status: "eligible", skipSpecArchival: true };
}

function shouldSkipLocalHeadForRefPrune(
  head: LocalBranchHead,
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
  repoProjects: Map<string, { roots: Map<string, string> }>;
  unusableProjects: UnusableRegisteredProject[];
}> {
  const unusableProjects: UnusableRegisteredProject[] = [];
  const repoProjects = new Map<string, { roots: Map<string, string> }>();

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
      commonDir = await gitCommonDir(root, runner);
    } catch (err) {
      unusableProjects.push({
        project,
        root,
        reason: `project root is inaccessible: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const repo = repoProjects.get(commonDir) ?? { roots: new Map<string, string>() };
    repo.roots.set(project, root);
    repoProjects.set(commonDir, repo);
  }

  return { repoProjects, unusableProjects };
}

async function discoverMergedBranchRefCandidatesForRepo(
  root: string,
  project: string,
  retiredBranches: ReadonlySet<string>,
  runner: AsyncSubprocessRunner,
): Promise<MergedBranchRefCandidate[]> {
  const [baseBranch, currentBranch, worktrees, localHeads] = await Promise.all([
    getBaseBranch(root, runner),
    getCurrentBranchAsync(root, runner),
    listWorktrees(root, runner),
    listLocalBranchHeads(root, runner),
  ]);
  const checkedOut = checkedOutBranchSet(worktrees);
  const candidates: MergedBranchRefCandidate[] = [];

  for (const head of localHeads) {
    if (shouldSkipLocalHeadForRefPrune(head, baseBranch, currentBranch, checkedOut, retiredBranches)) continue;
    if (
      !(await mergedPrHeadAuthorityMatches(head.branch, head.oid, root, runner)) &&
      !(await supersededPipelinePrHeadAuthorityMatches(head.branch, head.oid, root, runner))
    )
      continue;
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
  const ownershipRegistry = options.ownershipRegistry ?? registry;
  const { repoProjects, unusableProjects } = await mapRegisteredProjectsToDistinctRepos(ownershipRegistry, runner);
  const candidates: MergedBranchRefCandidate[] = [];
  const ownerProjectsByRepositoryRoot = new Map<string, readonly string[]>();

  for (const { roots } of repoProjects.values()) {
    const scopedProject = [...roots.keys()].find((project) => Object.hasOwn(registry, project));
    if (scopedProject === undefined) continue;
    const root = roots.get(scopedProject);
    if (root === undefined) continue;
    const ownerProjects = [...roots.keys()];
    for (const projectRoot of roots.values()) {
      ownerProjectsByRepositoryRoot.set(projectRoot, ownerProjects);
    }
    candidates.push(...(await discoverMergedBranchRefCandidatesForRepo(root, scopedProject, retiredBranches, runner)));
  }

  return {
    candidates,
    ownerProjectsByRepositoryRoot,
    unusableProjects: unusableProjects.filter((entry) => Object.hasOwn(registry, entry.project)),
  };
}

/** Resolve an exact fully qualified ref to its OID, or undefined when absent. */
export async function resolveExactRefOid(
  repoRoot: string,
  ref: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  try {
    const resolved = await resolveRef(repoRoot, ref, runner);
    return resolved.status === "resolved" ? resolved.oid : undefined;
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
  ownerProjects: readonly string[] = [candidate.project],
  options?: { skipMergedPrAuthority?: boolean },
): Promise<EligibilityResult> {
  const root = candidate.repositoryRoot;
  const branch = candidate.branch;

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

  if (
    options?.skipMergedPrAuthority !== true &&
    !(
      (await mergedPrHeadAuthorityMatches(branch, currentHeadOid, root, runner)) ||
      (await supersededPipelinePrHeadAuthorityMatches(branch, currentHeadOid, root, runner))
    )
  ) {
    return { status: "ineligible", reason: "merged PR authority no longer matches" };
  }

  const [baseBranch, currentBranch, checkedOut] = await Promise.all([
    getBaseBranch(root, runner),
    getCurrentBranchAsync(root, runner),
    listWorktrees(root, runner).then(checkedOutBranchSet),
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
    .find(
      (entry) => ownerProjects.includes(entry.project) && entry.branch === branch && !isTerminalRunStatus(entry.status),
    );
  if (run !== undefined) {
    return { status: "ineligible", reason: `non-terminal run exists: status=${run.status}` };
  }

  try {
    for (const ownerProject of ownerProjects) {
      const daemonRuns = await daemonClient(ownerProject, branch);
      if (daemonRuns.some((entry) => entry.isLive)) {
        return { status: "ineligible", reason: "daemon reports live run" };
      }
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
    await deleteRef(repoRoot, ref, runner);
    if ((await resolveRef(repoRoot, ref, runner)).status === "resolved") {
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
      io.stderr(`Failed to prune ref ${ref} (${candidate.project}): ${cleanupOperationErrorMessage(result.message)}\n`);
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
  ownerProjectsByRepositoryRoot: ReadonlyMap<string, readonly string[]>,
): Promise<boolean> {
  for (const candidate of candidates) {
    const eligibility = await revalidateMergedBranchRefCandidate(
      candidate,
      runner,
      daemonClient,
      store,
      retiredBranches,
      ownerProjectsByRepositoryRoot.get(candidate.repositoryRoot),
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
  ownerProjectsByRepositoryRoot: ReadonlyMap<string, readonly string[]>,
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
      ownerProjectsByRepositoryRoot.get(candidate.repositoryRoot),
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

/** Queue homes (in-repo and external) whose entries cleanup never archives: seeds and ready-intents. */
const QUEUE_DIR_NAMES: readonly string[] = ["seeds", "ready-intents"];

function isQueueEntrySource(path: string): boolean {
  return QUEUE_DIR_NAMES.includes(basename(dirname(path)));
}

function artifactForRetiredWorktree(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string = join(jarvisHome(), "config.json"),
): ArtifactSpec | undefined {
  const sources = store
    .listRuns()
    .filter((run) => run.project === candidate.project && run.branch === candidate.worktree.branch)
    .map((run) => sourceForRun(run, candidate.worktree.path, projectRoot, registry, configPath))
    .filter((path): path is string => path !== undefined && !isQueueEntrySource(path));
  // A spec-tree directory wins over a bare `.md` outright, as it did before this proof was added.
  // Folding both into one `find` let the newest row decide instead: `listRuns` is newest-first, and
  // an intent branch's newest row is its review row, so the older write row's landed
  // `ready-intents/<slug>.md` would be selected and offered for archival into a fabricated
  // `ready-intents/completed/`. Queue entries (seeds, ready-intents) are rejected above: ready-intents
  // are pruned by byte-proof, never archived.
  // Both arms must also prove the source exists: `endsWith(".md")` is lexical, so a vanished file
  // would otherwise resolve as a "proven" artifact and be suppressed only later, at preview.
  const source =
    sources.find((path) => existsSync(join(path, "index.md"))) ??
    sources.find((path) => path.endsWith(".md") && existsSync(path));
  if (source === undefined) return undefined;
  return {
    home: dirname(source),
    source,
    name: basename(source, ".md"),
    branch: candidate.worktree.branch,
  };
}

/** Subsumed lanes may have only a `completed/` tree on the default branch while runs still name the open spec dir. */
function artifactForSubsumedRetirementHygiene(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
): ArtifactSpec | undefined {
  const targetDir = planTargetDirForProject(candidate.project, configPath);
  for (const run of store.listRuns()) {
    if (run.project !== candidate.project || run.branch !== candidate.worktree.branch) continue;
    const source = sourceForRun(run, candidate.worktree.path, projectRoot, registry, configPath);
    if (source === undefined || isQueueEntrySource(source)) continue;
    const name = basename(source);
    const openSource = join(projectRoot, targetDir, name);
    if (existsSync(join(openSource, "index.md"))) {
      return { home: join(projectRoot, targetDir), source: openSource, name, branch: candidate.worktree.branch };
    }
    const completedSource = join(projectRoot, targetDir, "completed", name);
    if (existsSync(join(completedSource, "index.md"))) {
      return { home: join(projectRoot, targetDir), source: completedSource, name, branch: candidate.worktree.branch };
    }
    if (existsSync(join(source, "index.md"))) {
      return { home: dirname(source), source, name, branch: candidate.worktree.branch };
    }
  }
  return undefined;
}

function externalPlanSourceForRun(
  resolvedSpecPath: string,
  run: Run,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
): string | undefined {
  const indexPath =
    basename(resolvedSpecPath) === "index.md" ? resolvedSpecPath : join(dirname(resolvedSpecPath), "index.md");
  const identity = resolveExternalPlanSpecIdentity(indexPath, registry, configPath);
  if (identity === undefined || "error" in identity || identity.project !== run.project) return undefined;
  return identity.specReadRoot;
}

function sourceForRun(
  run: Run,
  worktreePath: string,
  projectRoot: string,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string = join(jarvisHome(), "config.json"),
): string | undefined {
  if (isAbsolute(run.specPath)) {
    let resolvedSpecPath = run.specPath;
    try {
      resolvedSpecPath = realpathSync(run.specPath);
    } catch {
      // keep lexical path when the run row points at a missing file
    }
    const externalSource = externalPlanSourceForRun(resolvedSpecPath, run, registry, configPath);
    if (externalSource !== undefined) return externalSource;
  }

  const identity = isAbsolute(run.specPath) ? relative(worktreePath, run.specPath) : run.specPath;
  if (identity === "" || identity === ".." || identity.startsWith("../") || isAbsolute(identity)) return undefined;
  if (isJarvisHarnessSidecarPath(identity)) return undefined;

  const durablePath = resolve(projectRoot, identity);
  return basename(durablePath) === "index.md" ? dirname(durablePath) : durablePath;
}

function provenIntentPrune(spec: ArtifactSpec): boolean {
  if (isExternalPlanArtifact(spec) || spec.source.endsWith(".md")) return false;
  try {
    return resolveConsumedReadyIntent(spec) !== undefined;
  } catch {
    return false;
  }
}

type OpenPr = { number: number; isDraft: boolean };

/** List open PRs whose head is <branch> via `gh pr list`. Throws on gh failure or malformed output. */
async function listOpenPrsForBranch(branch: string, cwd: string, runner: AsyncSubprocessRunner): Promise<OpenPr[]> {
  const rows = await listPrs(runner, cwd, { branch, state: "open" }, networkSubprocessOptions());
  return rows.map((row) => ({ number: row.number, isDraft: row.isDraft ?? false }));
}

function hasInRepoArtifactOwner(
  spec: ArtifactSpec,
  projectRoot: string,
  excludeWorktreePath: string,
  allWorktrees: readonly DiscoveredWorktree[],
): boolean {
  return allWorktrees.some(
    (worktree) =>
      worktree.path !== excludeWorktreePath && existsSync(join(worktree.path, relative(projectRoot, spec.source))),
  );
}

/** Durable-row lookup that lets a detached or unresolved managed worktree prove which artifact it owns. */
export type ArtifactOwnerIdentity = {
  store: StateStore;
  projectRoot: string;
  configPath?: string;
};

function canonicalArtifactPath(path: string): string {
  try {
    return resolve(realpathSync(path));
  } catch {
    return resolve(path);
  }
}

/**
 * A worktree with no resolvable branch (detached or unresolved `HEAD`) owns an artifact only when
 * one of its own durable run rows resolves to that artifact's source; without identity it owns nothing.
 */
function detachedWorktreeOwnsArtifact(
  worktree: DiscoveredWorktree,
  spec: ArtifactSpec,
  project: string,
  registry: Record<string, ProjectRegistryEntry>,
  identity: ArtifactOwnerIdentity,
): boolean {
  const specSource = canonicalArtifactPath(spec.source);
  return identity.store.listRuns().some((run) => {
    if (run.project !== project || run.worktreePath !== worktree.path) return false;
    const source = sourceForRun(run, worktree.path, identity.projectRoot, registry, identity.configPath);
    return source !== undefined && canonicalArtifactPath(source) === specSource;
  });
}

export function hasBranchKeyedArtifactOwner(
  spec: ArtifactSpec,
  project: string,
  excludeWorktreePath: string,
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  jarvisRoot: string,
  identity?: ArtifactOwnerIdentity,
): boolean {
  return allWorktrees.some((worktree) => {
    if (worktree.path === excludeWorktreePath) return false;
    if (projectForWorktree(worktree, registry, jarvisRoot) !== project) return false;
    if (worktree.branch !== undefined) return worktree.branch === spec.branch;
    return identity !== undefined && detachedWorktreeOwnsArtifact(worktree, spec, project, registry, identity);
  });
}

/** Refusal ranking for one artifact skipped by several passes: ownership beats eligibility, concrete paths beat bare messages. */
function skipReasonRank(reason: string): number {
  if (reason.includes("owns this spec")) return 3;
  return reason.includes("/") ? 2 : 1;
}

/** Collapses every artifact refusal in one cleanup invocation to one `Skipped artifact:` line per canonical identity. */
export type ArtifactSkipLedger = {
  skip: (source: string, reason: string) => void;
  flush: () => void;
};

export function createArtifactSkipLedger(io: { stdout: (s: string) => void }): ArtifactSkipLedger {
  const entries = new Map<string, { source: string; reason: string; rank: number }>();
  return {
    skip: (source, reason) => {
      const key = canonicalArtifactPath(source);
      const rank = skipReasonRank(reason);
      const existing = entries.get(key);
      if (existing === undefined || rank > existing.rank) entries.set(key, { source, reason, rank });
    },
    flush: () => {
      for (const entry of entries.values()) {
        io.stdout(`Skipped artifact: ${entry.source} — ${entry.reason}\n`);
      }
      entries.clear();
    },
  };
}

export type ArchivePublicationTargetEntry = ArchivePublicationTarget & {
  project: string;
  projectRoot: string;
};

/** One cleanup archive branch per project per invocation; in-repo archives commit there, never on the operator checkout. */
export type ArchivePublicationSessions = {
  for(project: string, projectRoot: string): ArchivePublicationSession;
  all(): ReadonlyArray<[string, ArchivePublicationSession]>;
  recordStagedArchiveBranch(project: string, branch: string, projectRoot: string): void;
  publicationTargets(): ReadonlyArray<ArchivePublicationTargetEntry>;
  publicationTargetSession(project: string, projectRoot: string): ArchivePublicationSession | undefined;
};

function stagedArchiveWorktreePath(jarvisRoot: string, project: string, branch: string): string {
  return managedWorktreePath(jarvisRoot, project, branch);
}

export function createArchivePublicationSessions(
  runner: AsyncSubprocessRunner,
  jarvisRoot: string,
  stamp?: string,
): ArchivePublicationSessions {
  const sessions = new Map<string, ArchivePublicationSession>();
  const projectRoots = new Map<string, string>();
  const stagedBranches = new Map<string, { branch: string; projectRoot: string }>();

  const recordStagedArchiveBranch = (project: string, branch: string, projectRoot: string): void => {
    stagedBranches.set(project, { branch, projectRoot });
  };

  const publicationTargets = (): ArchivePublicationTargetEntry[] => {
    const targets = new Map<string, ArchivePublicationTargetEntry>();
    for (const [project, session] of sessions) {
      const projectRoot = projectRoots.get(project);
      if (projectRoot === undefined || session.commits() === 0) continue;
      const key = `${project}\0${session.branch}`;
      targets.set(key, {
        project,
        projectRoot,
        branch: session.branch,
        worktreePath: session.worktreePath,
      });
    }
    for (const [project, staged] of stagedBranches) {
      const key = `${project}\0${staged.branch}`;
      if (targets.has(key)) continue;
      targets.set(key, {
        project,
        projectRoot: staged.projectRoot,
        branch: staged.branch,
        worktreePath: stagedArchiveWorktreePath(jarvisRoot, project, staged.branch),
      });
    }
    return [...targets.values()];
  };

  const createSession = (
    project: string,
    projectRoot: string,
    adopted?: { branch: string; worktreePath: string },
  ): ArchivePublicationSession =>
    createArchivePublicationSession({
      runner,
      projectRoot,
      jarvisRoot,
      project,
      ...(stamp !== undefined ? { stamp } : {}),
      ...(adopted !== undefined ? { adoptedBranch: adopted.branch, adoptedWorktreePath: adopted.worktreePath } : {}),
      onStagedArchiveBranch: (branch) => recordStagedArchiveBranch(project, branch, projectRoot),
    });

  return {
    for: (project, projectRoot) => {
      projectRoots.set(project, projectRoot);
      let session = sessions.get(project);
      if (session === undefined) {
        session = createSession(project, projectRoot);
        sessions.set(project, session);
      }
      return session;
    },
    all: () => [...sessions.entries()],
    recordStagedArchiveBranch,
    publicationTargets,
    publicationTargetSession: (project, projectRoot) => {
      projectRoots.set(project, projectRoot);
      const targets = publicationTargets().filter((target) => target.project === project);
      if (targets.length === 0) return undefined;
      const existing = sessions.get(project);
      if (existing !== undefined && existing.commits() > 0) return existing;
      const staged = stagedBranches.get(project);
      if (staged === undefined) return existing;
      const adopted = {
        branch: staged.branch,
        worktreePath: stagedArchiveWorktreePath(jarvisRoot, project, staged.branch),
      };
      const session = createSession(project, projectRoot, adopted);
      sessions.set(project, session);
      return session;
    },
  };
}

/** In-repo specs publish on the cleanup branch; external plans and queue entries move in place. */
async function archiveArtifactSpec(
  spec: ArtifactSpec,
  project: string,
  projectRoot: string,
  sessions: ArchivePublicationSessions,
): Promise<ArchiveResult | ArchivePublicationResult> {
  if (spec.queue !== undefined) return pruneConsumedQueueEntry(spec);
  if (isExternalPlanArtifact(spec)) return archiveCompletedSpec(spec);
  return sessions.for(project, projectRoot).publish(spec);
}

function cleanupArchiveBranchStamp(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function archivePublicationTitle(project: string): string {
  return `Archive completed specs for ${project}`;
}

function reportArchivePublicationManualFallback(
  target: ArchivePublicationTargetEntry,
  commitCount: number,
  io: { stdout: (s: string) => void },
): void {
  io.stdout(
    `Archive branch for ${target.project}: ${target.branch} (${commitCount} commit(s)) at ${target.worktreePath} — push it and open one archive PR.\n`,
  );
}

async function archivePublicationCommitCount(
  target: ArchivePublicationTargetEntry,
  sessions: ArchivePublicationSessions,
  runner: AsyncSubprocessRunner,
): Promise<number> {
  for (const [project, session] of sessions.all()) {
    if (project === target.project && session.branch === target.branch && session.commits() > 0) {
      return session.commits();
    }
  }
  const baseRef = await getBaseBranch(target.projectRoot, runner);
  try {
    const parsed = await countCommitsBetween(target.projectRoot, baseRef, target.branch, runner);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } catch {
    return 1;
  }
}

type ArchivePublicationStepFailure = { step: "push" | "pr"; error: unknown };

async function runArchivePublicationGit(
  cwd: string,
  args: readonly string[],
  runner: AsyncSubprocessRunner,
): Promise<string> {
  const command = args[0];
  if (command === "rev-parse" && args[1] === "HEAD") {
    return await getCurrentHeadAsync(cwd, runner);
  }
  if (command === "merge-base" && args[1] === "--is-ancestor") {
    const ancestor = args[2];
    const descendant = args[3];
    if (ancestor === undefined || descendant === undefined) {
      throw new Error(`invalid merge-base --is-ancestor argv: ${args.join(" ")}`);
    }
    if (!(await isAncestor(cwd, ancestor, descendant, runner))) {
      throw new AsyncSubprocessError("not an ancestor", 1, "", "", undefined);
    }
    return "";
  }
  if (command === "ls-remote" && args[1] === "origin") {
    const ref = args[2];
    if (ref === undefined) {
      throw new Error(`invalid ls-remote argv: ${args.join(" ")}`);
    }
    const tip = await lsRemoteRef(cwd, "origin", ref, runner);
    return tip === undefined ? "" : `${tip}\t${ref}\n`;
  }
  if (command === "push") {
    if (args.length === 3 && args[1] === "origin" && args[2]?.startsWith("HEAD:")) {
      await pushBranch(cwd, { remote: "origin", branch: args[2] }, runner, {});
      return "";
    }
    if (args.length === 4 && args[1]?.startsWith("--force-with-lease=") && args[2] === "origin") {
      const refspec = args[3];
      const lease = args[1]?.slice("--force-with-lease=".length);
      if (refspec === undefined || lease === undefined || lease.length === 0) {
        throw new Error(`invalid push argv: ${args.join(" ")}`);
      }
      await pushBranch(cwd, { remote: "origin", branch: refspec, forceWithLease: lease }, runner, {});
      return "";
    }
  }
  throw new Error(`unsupported archive publication git argv: ${args.join(" ")}`);
}

async function applyEndArchivePublication(
  sessions: ArchivePublicationSessions,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  const targets = sessions.publicationTargets();
  if (targets.length === 0) return 0;
  let exit = 0;
  for (const target of targets) {
    const baseRef = await getBaseBranch(target.projectRoot, runner);
    const title = archivePublicationTitle(target.project);
    const body = `Branch ${target.branch} at ${target.worktreePath}.`;
    let pastPush = false;
    const git = async (cwd: string, args: readonly string[]) => {
      try {
        const out = await runArchivePublicationGit(cwd, args, runner);
        if (args[0] === "push") pastPush = true;
        return out;
      } catch (error) {
        throw { step: pastPush ? "pr" : "push", error } satisfies ArchivePublicationStepFailure;
      }
    };
    try {
      const result = await publishArchiveReady(
        { worktreePath: target.worktreePath, branch: target.branch, baseRef, title, body },
        {
          git,
          gh: (cwd, args, options) =>
            runner.runAsync("gh", [...args], cwd, { ...networkSubprocessOptions(), ...options }),
        },
      );
      io.stdout(`${result.prUrl}\n`);
    } catch (failure: unknown) {
      exit = 1;
      const stepFailure = failure as Partial<ArchivePublicationStepFailure>;
      const step = failure instanceof GitHubOperationError || stepFailure.step === "pr" ? "pr" : "push";
      io.stderr(
        `Archive publication failed at ${step}: ${cleanupOperationErrorMessage(stepFailure.error ?? failure)}\n`,
      );
      const commitCount = await archivePublicationCommitCount(target, sessions, runner);
      reportArchivePublicationManualFallback(target, commitCount, io);
    }
  }
  return exit;
}

async function registerDryRunInRepoArchiveTarget(
  spec: ArtifactSpec,
  project: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
  jarvisRoot: string,
  stamp: string,
  targets: Map<string, ArchivePublicationTargetEntry>,
): Promise<void> {
  if (spec.queue !== undefined || isExternalPlanArtifact(spec)) return;
  if (!existsSync(spec.source)) return;
  const relDest = relative(projectRoot, join(spec.home, "completed", basename(spec.source))).replace(/\\/g, "/");
  if (relDest.startsWith("..") || isAbsolute(relDest)) return;
  const staged = await cleanupBranchCarryingArchive(runner, projectRoot, relDest);
  const branch = staged ?? `cleanup/archive-${stamp}`;
  targets.set(`${project}\0${branch}`, {
    project,
    projectRoot,
    branch,
    worktreePath: stagedArchiveWorktreePath(jarvisRoot, project, branch),
  });
}

async function previewArchivePublicationTargets(
  ctx: CleanupDiscoveryContext,
  registry: Record<string, ProjectRegistryEntry>,
  store: StateStore,
  runner: AsyncSubprocessRunner,
  jarvisRoot: string,
  clock: () => Date,
  io: { stdout: (s: string) => void },
): Promise<void> {
  const stamp = cleanupArchiveBranchStamp(clock());
  const targets = new Map<string, ArchivePublicationTargetEntry>();
  for (const candidate of ctx.candidates) {
    if (candidate.skipSpecArchival === true) continue;
    const projectRoot = registry[candidate.project]?.root;
    if (projectRoot === undefined) continue;
    const spec = artifactForRetiredWorktree(candidate, projectRoot, store, registry);
    if (spec !== undefined) {
      await registerDryRunInRepoArchiveTarget(spec, candidate.project, projectRoot, runner, jarvisRoot, stamp, targets);
    }
  }
  for (const spec of ctx.stranded) {
    const projectRoot = registry[spec.project]?.root;
    if (projectRoot === undefined) continue;
    await registerDryRunInRepoArchiveTarget(spec, spec.project, projectRoot, runner, jarvisRoot, stamp, targets);
  }
  for (const target of targets.values()) {
    io.stdout(`push: ${target.branch}\n`);
    io.stdout(`open PR: ${archivePublicationTitle(target.project)}\n`);
  }
}

/** When the open spec dir is gone but the tree already lives under `completed/`, still resolve intent bytes for prune. */
function hygieneSpecForSubsumedRetirement(spec: ArtifactSpec, projectRoot: string, targetDir: string): ArtifactSpec {
  if (existsSync(join(spec.source, "intent.md"))) return spec;
  const name = basename(spec.source);
  const completedSource = join(projectRoot, targetDir, "completed", name);
  if (!existsSync(join(completedSource, "intent.md"))) return spec;
  return { ...spec, source: completedSource, home: join(projectRoot, targetDir) };
}

async function archiveRetiredArtifact(
  candidate: CleanupCandidate,
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  store: StateStore,
  runner: AsyncSubprocessRunner,
  jarvisRoot: string,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  skips: ArtifactSkipLedger,
  sessions: ArchivePublicationSessions,
  configPath: string = join(jarvisHome(), "config.json"),
): Promise<void> {
  const projectRoot = registry[candidate.project]?.root;
  if (projectRoot === undefined) return;
  const spec =
    candidate.skipSpecArchival === true
      ? artifactForSubsumedRetirementHygiene(candidate, projectRoot, store, registry, configPath)
      : artifactForRetiredWorktree(candidate, projectRoot, store, registry, configPath);
  if (spec === undefined) {
    skips.skip(candidate.worktree.path, "no durable spec identity");
    return;
  }

  if (candidate.skipSpecArchival === true) {
    if (isExternalPlanArtifact(spec)) return;
    const targetDir = planTargetDirForProject(candidate.project, configPath);
    const hygieneSpec = hygieneSpecForSubsumedRetirement(spec, projectRoot, targetDir);
    if (hasInRepoArtifactOwner(hygieneSpec, projectRoot, candidate.worktree.path, allWorktrees)) {
      skips.skip(hygieneSpec.source, "another materialized worktree owns this spec");
      return;
    }
    const result = await sessions.for(candidate.project, projectRoot).publishConsumedReadyIntentOnly(hygieneSpec);
    if (result.status === "skipped") return;
    reportArchive(hygieneSpec, result, "artifact", io);
    return;
  }

  const eligibility = await checkArtifactEligibility(spec, {
    findOpenPrs: async (branch) => (await listOpenPrsForBranch(branch, projectRoot, runner)).length,
    hasMaterializedOwner: async () =>
      isExternalPlanArtifact(spec)
        ? hasBranchKeyedArtifactOwner(
            spec,
            candidate.project,
            candidate.worktree.path,
            registry,
            allWorktrees,
            jarvisRoot,
            { store, projectRoot },
          )
        : hasInRepoArtifactOwner(spec, projectRoot, candidate.worktree.path, allWorktrees),
  });
  if (eligibility.status === "ineligible") {
    skips.skip(spec.source, eligibility.reason);
    return;
  }

  reportArchive(spec, await archiveArtifactSpec(spec, candidate.project, projectRoot, sessions), "artifact", io);
}

type DiscoveredStrandedArtifact = Omit<ArtifactSpec, "branch"> & {
  project: string;
  /** In-repo ready-intent queue entries only: the open spec proven (on the default branch) to consume it. */
  inRepoReadyIntentConsumer?: Pick<ArtifactSpec, "home" | "source" | "name">;
};
type StrandedArtifact = DiscoveredStrandedArtifact & { branch: string };

function previewArtifact(spec: StrandedArtifact | ArtifactSpec, io: { stdout: (s: string) => void }): void {
  if (spec.queue !== undefined) {
    const inRepoConsumer = "project" in spec ? spec.inRepoReadyIntentConsumer : undefined;
    if (inRepoConsumer !== undefined) {
      io.stdout(`  prune: ready-intents/${basename(spec.source)} (consumed by open spec ${inRepoConsumer.name})\n`);
      return;
    }
    const consumer = consumedExternalReadyIntentPlan(spec);
    const consumedBy = consumer === undefined ? "" : ` (consumed by plans/completed/${basename(consumer.planDir)})`;
    io.stdout(`  prune: ${spec.queue === "seed" ? "seeds" : "ready-intents"}/${basename(spec.source)}${consumedBy}\n`);
    return;
  }
  const target = isExternalPlanArtifact(spec)
    ? `plans/${basename(spec.source)} -> plans/completed/${basename(spec.source)}`
    : `${spec.source} -> ${join(spec.home, "completed", basename(spec.source))}`;
  io.stdout(`  archive: ${target}${provenIntentPrune(spec) ? " (prune consumed ready-intent)" : ""}\n`);
}

/** One-time stdout note when several registered projects collapse to the same `projectSafeId`. */
function reportSafeIdCollision(
  safeId: string,
  owners: readonly string[],
  reported: Set<string>,
  io?: { stdout: (s: string) => void },
): void {
  if (owners.length <= 1 || reported.has(safeId)) return;
  reported.add(safeId);
  io?.stdout(
    `Skipped external plans discovery: ${safeId} — multiple registered projects share one projectSafeId (${owners.join(", ")})\n`,
  );
}

/** Resolve one `plans/<name>/` directory to a stranded artifact, or undefined when it is not an admitted external tree. */
function externalPlanArtifactForDirectory(
  plansHome: string,
  name: string,
  project: string,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
): DiscoveredStrandedArtifact | undefined {
  const indexPath = join(plansHome, name, "index.md");
  if (!existsSync(indexPath)) return undefined;
  let resolvedIndexPath: string;
  try {
    resolvedIndexPath = realpathSync(indexPath);
  } catch {
    return undefined;
  }
  const identity = resolveExternalPlanSpecIdentity(resolvedIndexPath, registry, configPath);
  if (identity === undefined || "error" in identity || identity.project !== project) return undefined;
  const source = identity.specReadRoot;
  return source === undefined ? undefined : { home: plansHome, source, name, project };
}

function discoverExternalPlanStrandedArtifacts(
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
  safeIdOwners: Map<string, string[]>,
  io?: { stdout: (s: string) => void },
): DiscoveredStrandedArtifact[] {
  const artifacts: DiscoveredStrandedArtifact[] = [];
  const reportedCollisionSafeIds = new Set<string>();
  for (const [project] of Object.entries(registry)) {
    const safeId = projectSafeId(project);
    const owners = safeIdOwners.get(safeId) ?? [];
    if (owners.length !== 1) {
      reportSafeIdCollision(safeId, owners, reportedCollisionSafeIds, io);
      continue;
    }
    const projectConfig = readProjectConfigRecord(project, configPath);
    if (projectConfig === undefined || !planSourcePublishesExternally(projectConfig)) continue;

    const plansHome = join(specsHome(project), "plans");
    if (!existsSync(plansHome)) continue;
    try {
      for (const child of readdirSync(plansHome, { withFileTypes: true })) {
        if (!child.isDirectory() || child.name === "completed") continue;
        if (child.name.startsWith(".") || isHarnessWorkflowStagingPath(child.name)) continue;
        const artifact = externalPlanArtifactForDirectory(plansHome, child.name, project, registry, configPath);
        if (artifact !== undefined) artifacts.push(artifact);
      }
    } catch {
      // A plans home that cannot be read has no safely inspectable candidates.
    }
  }
  return artifacts;
}

const EXTERNAL_QUEUES = [
  ["seeds", "seed"],
  ["ready-intents", "ready-intent"],
] as const;

/**
 * Queue entries (`seeds/<name>.md`, `ready-intents/<name>.md`) in every opted-in project's external
 * home: same skip rules as in-repo queue siblings — Markdown files only, dot-entries and
 * directories ignored. They surface consumed or stale queue files that cleanup could not see.
 */
function discoverExternalQueueStrandedArtifacts(
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
  safeIdOwners: Map<string, string[]>,
): DiscoveredStrandedArtifact[] {
  const artifacts: DiscoveredStrandedArtifact[] = [];
  for (const [project] of Object.entries(registry)) {
    const safeId = projectSafeId(project);
    if ((safeIdOwners.get(safeId) ?? []).length !== 1) continue;
    const projectConfig = readProjectConfigRecord(project, configPath);
    if (projectConfig === undefined || !planSourcePublishesExternally(projectConfig)) continue;
    for (const [dirName, queue] of EXTERNAL_QUEUES) {
      const home = join(specsHome(project), dirName);
      if (!existsSync(home)) continue;
      try {
        for (const child of readdirSync(home, { withFileTypes: true })) {
          if (!child.isFile() || child.name.startsWith(".") || !child.name.endsWith(".md")) continue;
          artifacts.push({ home, source: join(home, child.name), name: child.name.slice(0, -3), project, queue });
        }
      } catch {
        // A queue home that cannot be read has no safely inspectable candidates.
      }
    }
  }
  return artifacts;
}

/** Open spec directory names under `relHome` as committed on `ref` (trees only; not `completed/` or queues). */
async function openInRepoSpecDirNamesOnRef(
  projectRoot: string,
  relHome: string,
  ref: string,
  runner: AsyncSubprocessRunner,
): Promise<string[]> {
  let listing;
  try {
    listing = await listTreeChildrenAtRef(projectRoot, ref, relHome, runner);
  } catch {
    return [];
  }
  if (listing === undefined) return [];
  const names: string[] = [];
  for (const entry of listing) {
    if (entry.type !== "tree") continue;
    const name = entry.name;
    if (QUEUE_DIR_NAMES.includes(name) || name === "completed" || name.startsWith(".")) continue;
    if (isHarnessWorkflowStagingPath(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * In-repo ready-intents committed on each project's default branch, each paired with the open spec
 * whose `intent.md` carries its bytes there. Constant git calls per project: one default-branch
 * lookup, one home listing, one blob-id listing (byte equality is blob-id equality; no blob is read).
 */
async function discoverInRepoReadyIntentQueueArtifacts(
  registry: Record<string, ProjectRegistryEntry>,
  runner: AsyncSubprocessRunner,
): Promise<DiscoveredStrandedArtifact[]> {
  const artifacts: DiscoveredStrandedArtifact[] = [];
  for (const [project, entry] of Object.entries(registry)) {
    const home = join(entry.root, "v2", "spec");
    const relHome = relative(entry.root, home);
    const baseBranch = await getBaseBranch(entry.root, runner);
    const openSpecs = await openInRepoSpecDirNamesOnRef(entry.root, relHome, baseBranch, runner);
    const queueDir = join(home, "ready-intents");
    const committed = await committedBlobIdsAtRef(runner, entry.root, entry.root, baseBranch, [
      join(relHome, "ready-intents"),
      ...openSpecs.map((name) => join(relHome, name, "intent.md")),
    ]);
    if (committed === undefined) continue;

    const consumers = new Map<string, NonNullable<DiscoveredStrandedArtifact["inRepoReadyIntentConsumer"]>>();
    for (const name of openSpecs) {
      const source = join(home, name);
      const readyIntent = resolveConsumedReadyIntent({ home, source, name, branch: "" }, committed.fs);
      if (readyIntent !== undefined && !consumers.has(resolve(readyIntent))) {
        consumers.set(resolve(readyIntent), { home, source, name });
      }
    }
    for (const source of committed.paths) {
      const name = basename(source);
      if (dirname(source) !== resolve(queueDir) || name.startsWith(".") || !name.endsWith(".md")) continue;
      const consumer = consumers.get(source);
      artifacts.push({
        home,
        source,
        name: name.slice(0, -3),
        project,
        queue: "ready-intent",
        ...(consumer === undefined ? {} : { inRepoReadyIntentConsumer: consumer }),
      });
    }
  }
  return artifacts;
}

/** Queue entries are never spec trees: decide them here so no completeness or branch check runs. */
async function inspectQueueEntry(
  artifact: DiscoveredStrandedArtifact,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
  skips: ArtifactSkipLedger,
  sessions?: ArchivePublicationSessions,
): Promise<StrandedArtifact | undefined> {
  if (artifact.queue === "seed") {
    skips.skip(artifact.source, "pending seed: consumed by intent admission, not cleanup");
    return undefined;
  }
  if (!QUEUE_DIR_NAMES.includes(basename(artifact.home))) {
    const consumer = artifact.inRepoReadyIntentConsumer;
    if (consumer === undefined) {
      skips.skip(artifact.source, "unconsumed ready-intent: no open spec tree carries its bytes on the default branch");
      return undefined;
    }
    // A consumer archive staged on an unmerged cleanup branch already pruned this entry there.
    const relDest = relative(projectRoot, join(consumer.home, "completed", basename(consumer.source)));
    const staged = await cleanupBranchCarryingArchive(runner, projectRoot, relDest);
    if (staged !== undefined) {
      sessions?.recordStagedArchiveBranch(artifact.project, staged, projectRoot);
      skips.skip(
        artifact.source,
        `consuming spec already staged on cleanup branch ${staged}; push it and open the archive PR`,
      );
      return undefined;
    }
    return { ...artifact, branch: "" };
  }
  const consumer = consumedExternalReadyIntentPlan({ ...artifact, branch: "" });
  if (consumer === undefined) {
    skips.skip(artifact.source, "unconsumed ready-intent: no plan tree carries its bytes");
    return undefined;
  }
  if (!consumer.archived) {
    skips.skip(artifact.source, `consumed by open plan plans/${basename(consumer.planDir)}; prune after it archives`);
    return undefined;
  }
  return { ...artifact, branch: "" };
}

export function discoverStrandedArtifacts(
  registry: Record<string, ProjectRegistryEntry>,
  io?: { stdout: (s: string) => void },
): DiscoveredStrandedArtifact[] {
  const artifacts: DiscoveredStrandedArtifact[] = [];
  for (const [project, entry] of Object.entries(registry)) {
    const home = join(entry.root, "v2", "spec");
    if (!existsSync(home)) continue;
    try {
      for (const child of readdirSync(home, { withFileTypes: true })) {
        if (!child.isDirectory() || child.name === "completed" || QUEUE_DIR_NAMES.includes(child.name)) continue;
        if (child.name.startsWith(".") || isHarnessWorkflowStagingPath(child.name)) continue;
        artifacts.push({ home, source: join(home, child.name), name: child.name, project });
      }
    } catch {
      // A home that cannot be read has no safely inspectable candidates.
    }
  }
  const configPath = join(jarvisHome(), "config.json");
  const safeIdOwners = new Map<string, string[]>();
  for (const project of Object.keys(registry)) {
    const safeId = projectSafeId(project);
    const owners = safeIdOwners.get(safeId) ?? [];
    owners.push(project);
    safeIdOwners.set(safeId, owners);
  }
  return [
    ...artifacts,
    ...discoverExternalPlanStrandedArtifacts(registry, configPath, safeIdOwners, io),
    ...discoverExternalQueueStrandedArtifacts(registry, configPath, safeIdOwners),
  ];
}

function recordedStrandedRun(
  artifact: DiscoveredStrandedArtifact,
  projectRoot: string,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string = join(jarvisHome(), "config.json"),
): Run | undefined {
  for (const run of store.listRuns()) {
    if (run.project !== artifact.project) continue;
    const source = sourceForRun(run, run.worktreePath, projectRoot, registry, configPath);
    if (source === undefined) continue;
    let resolvedSource = source;
    let resolvedArtifactSource = artifact.source;
    try {
      resolvedSource = realpathSync(source);
      resolvedArtifactSource = realpathSync(artifact.source);
    } catch {
      // compare lexical paths when realpath is unavailable
    }
    if (resolve(resolvedSource) === resolve(resolvedArtifactSource)) return run;
  }
  return undefined;
}

/** Reason carried when an artifact is not a hand-landed archival candidate at all. */
const NO_DURABLE_BRANCH_REASON = "no durable implementation branch";

/**
 * A read-only `ArtifactFs` over one spec tree as committed on `ref`, or undefined when that tree is
 * absent or unreadable there. Directory entries are synthesized from the listed blob paths.
 */
async function specTreeFsAtRef(
  projectRoot: string,
  source: string,
  ref: string,
  runner: AsyncSubprocessRunner,
): Promise<ArtifactFs | undefined> {
  const relSource = relative(projectRoot, source);
  let relPaths;
  try {
    relPaths = await listRecursivePathsAtRef(projectRoot, ref, relSource, runner);
  } catch {
    return undefined;
  }
  if (relPaths === undefined || relPaths.length === 0) return undefined;

  const root = resolve(projectRoot);
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  for (const relPath of relPaths) {
    const content = await readBlobAtRef(projectRoot, ref, relPath, runner);
    if (content === undefined) return undefined;
    const absPath = resolve(root, relPath);
    files.set(absPath, Buffer.from(content, "utf8"));
    for (let dir = dirname(absPath); dir.startsWith(root); dir = dirname(dir)) dirs.add(dir);
  }
  const readOnly = (): never => {
    throw new Error("a spec tree read at a git ref is read-only");
  };
  return {
    exists: (path) => files.has(resolve(path)) || dirs.has(resolve(path)),
    read: (path) => {
      const content = files.get(resolve(path));
      if (content === undefined) throw new Error(`not committed on ${ref}: ${path}`);
      return content;
    },
    mkdir: readOnly,
    rename: readOnly,
    unlink: readOnly,
  };
}

/**
 * An in-repo spec no run row ever named (authored and landed by hand) is archivable when its linked
 * subspecs are complete **as committed on the repository default branch** — ticks reach that branch
 * only through a merged PR, so a locally edited checkbox is never evidence of completion — and no
 * materialized worktree carries its source. Absent, unreadable, or inconclusive evidence declines.
 */
export async function handLandedArtifactArchivability(
  artifact: DiscoveredStrandedArtifact,
  projectRoot: string,
  allWorktrees: readonly DiscoveredWorktree[],
  runner: AsyncSubprocessRunner,
): Promise<ArtifactEligibility> {
  const declined = { status: "ineligible", reason: NO_DURABLE_BRANCH_REASON } as const;
  if (artifact.queue !== undefined) return declined;
  const spec: ArtifactSpec = { ...artifact, branch: "" };
  if (isExternalPlanArtifact(spec)) return declined;
  const inCheckout = relative(projectRoot, artifact.source);
  if (inCheckout === "" || inCheckout.startsWith("..") || isAbsolute(inCheckout)) return declined;
  try {
    const baseBranch = await getBaseBranch(projectRoot, runner);
    const committed = await specTreeFsAtRef(projectRoot, artifact.source, baseBranch, runner);
    if (committed === undefined) return { status: "ineligible", reason: `spec is not committed on ${baseBranch}` };
    const completion = completedSpecEligibility(spec, committed);
    if (completion.status === "ineligible") return completion;
    if (hasInRepoArtifactOwner(spec, projectRoot, "", allWorktrees)) return declined;
    return { status: "eligible" };
  } catch {
    return declined;
  }
}

async function inspectSpecArtifact(
  artifact: DiscoveredStrandedArtifact,
  projectRoot: string,
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  jarvisRoot: string,
  store: StateStore,
  runner: AsyncSubprocessRunner,
  skips: ArtifactSkipLedger,
  sessions?: ArchivePublicationSessions,
): Promise<StrandedArtifact | undefined> {
  const run = recordedStrandedRun(artifact, projectRoot, store, registry);
  let handLanded = false;
  if (run === undefined) {
    const archivability = await handLandedArtifactArchivability(artifact, projectRoot, allWorktrees, runner);
    if (archivability.status === "ineligible") {
      skips.skip(artifact.source, archivability.reason);
      return undefined;
    }
    handLanded = true;
  } else if (run.branch === "") {
    skips.skip(artifact.source, NO_DURABLE_BRANCH_REASON);
    return undefined;
  }
  const identified = { ...artifact, branch: run?.branch ?? "" };
  if (!isExternalPlanArtifact(identified)) {
    const relDest = relative(projectRoot, join(artifact.home, "completed", basename(artifact.source)));
    const staged = await cleanupBranchCarryingArchive(runner, projectRoot, relDest);
    if (staged !== undefined) {
      sessions?.recordStagedArchiveBranch(artifact.project, staged, projectRoot);
      skips.skip(artifact.source, `already staged on cleanup branch ${staged}; push it and open the archive PR`);
      return undefined;
    }
  }
  const identity: ArtifactOwnerIdentity = { store, projectRoot };
  if (hasBranchKeyedArtifactOwner(identified, artifact.project, "", registry, allWorktrees, jarvisRoot, identity)) {
    skips.skip(artifact.source, "another materialized worktree owns this spec");
    return undefined;
  }
  if (handLanded) return identified;
  const inspection = await checkArtifactEligibility(identified, {
    findOpenPrs: async (branch) => (await listOpenPrsForBranch(branch, projectRoot, runner)).length,
    hasMaterializedOwner: async () => false,
  });
  if (inspection.status === "eligible") return identified;
  skips.skip(artifact.source, inspection.reason);
  return undefined;
}

export async function inspectStrandedArtifacts(
  artifacts: readonly DiscoveredStrandedArtifact[],
  registry: Record<string, ProjectRegistryEntry>,
  allWorktrees: readonly DiscoveredWorktree[],
  jarvisRoot: string,
  store: StateStore,
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void },
  sharedSkips?: ArtifactSkipLedger,
  sessions?: ArchivePublicationSessions,
): Promise<StrandedArtifact[]> {
  const skips = sharedSkips ?? createArtifactSkipLedger(io);
  const eligible: StrandedArtifact[] = [];
  for (const artifact of artifacts) {
    if (!existsSync(artifact.source)) continue;
    const projectRoot = registry[artifact.project]?.root;
    if (projectRoot === undefined) continue;
    const inspected =
      artifact.queue !== undefined
        ? await inspectQueueEntry(artifact, projectRoot, runner, skips, sessions)
        : await inspectSpecArtifact(
            artifact,
            projectRoot,
            registry,
            allWorktrees,
            jarvisRoot,
            store,
            runner,
            skips,
            sessions,
          );
    if (inspected !== undefined) eligible.push(inspected);
  }
  if (sharedSkips === undefined) skips.flush();
  return withoutPrunesOfArchivingSpecs(eligible);
}

/** A ready-intent whose consuming open spec archives this run is pruned by that archive; drop the separate prune. */
function withoutPrunesOfArchivingSpecs(eligible: StrandedArtifact[]): StrandedArtifact[] {
  const archiving = new Set(eligible.filter((a) => a.queue === undefined).map((a) => resolve(a.source)));
  return eligible.filter((a) => {
    const consumer = a.inRepoReadyIntentConsumer;
    return consumer === undefined || !archiving.has(resolve(consumer.source));
  });
}

function reportArchive(
  spec: ArtifactSpec,
  result: ArchiveResult | ArchivePublicationResult,
  prefix: string,
  io: { stdout: (s: string) => void },
): void {
  if (result.status === "pruned") {
    io.stdout(`Pruned consumed ready-intent: ${spec.source} (consumed by ${result.consumedBy})\n`);
  } else if (result.status === "intentPruned") {
    const where = ` (committed on ${result.branch}; the operator checkout is unchanged)`;
    io.stdout(`Pruned consumed ready-intent: ${result.readyIntent}${where}\n`);
  } else if (result.status === "archived") {
    const where = "branch" in result ? ` (committed on ${result.branch}; the operator checkout is unchanged)` : "";
    io.stdout(
      `Archived: ${spec.source} -> ${result.destination}${result.intentPruned ? " (pruned consumed ready-intent)" : ""}${where}\n`,
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
    worktree.path.startsWith(`${join(worktreesRootPath(jarvisRoot), project)}/`),
  );
}

async function findEligibleWorktreeCandidates(
  discovered: readonly DiscoveredWorktree[],
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  configPath: string,
  io: { stdout: (s: string) => void },
): Promise<{ candidates: CleanupCandidate[]; daemonUnreachable: DiscoveredWorktree[] }> {
  const candidates: CleanupCandidate[] = [];
  const daemonUnreachable: DiscoveredWorktree[] = [];
  for (const worktree of discovered) {
    const project = projectForWorktree(worktree, registry, jarvisRoot);
    if (project === undefined || worktree.branch === undefined) continue;

    const projectRoot = registry[project]?.root;
    const eligibility = await checkEligibility(
      worktree,
      project,
      runner,
      daemonClient,
      store,
      projectRoot !== undefined ? { projectRoot, registry, configPath } : undefined,
    );
    if (eligibility.status === "eligible") {
      const entry: CleanupCandidate = { worktree: { ...worktree, branch: worktree.branch }, project };
      if (eligibility.skipSpecArchival === true) entry.skipSpecArchival = true;
      candidates.push(entry);
    } else if (eligibility.reason === DAEMON_UNREACHABLE_REASON) {
      daemonUnreachable.push(worktree);
    } else if (projectRoot !== undefined) {
      const landedReason = await evaluateImplementLandedElsewhereReport(
        worktree,
        project,
        worktree.branch,
        projectRoot,
        runner,
        store,
        registry,
        configPath,
      );
      if (landedReason !== undefined) {
        io.stdout(
          `Landed elsewhere: ${worktree.path} — ${landedReason}; run jarvis cleanup --abandon ${worktree.branch} --discard-unlanded after verifying\n`,
        );
      }
    }
  }
  return { candidates, daemonUnreachable };
}

function skipSpecArchivalSourceKeys(
  candidates: readonly CleanupCandidate[],
  registry: Record<string, ProjectRegistryEntry>,
  store: StateStore,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.skipSpecArchival !== true) continue;
    const projectRoot = registry[candidate.project]?.root;
    if (projectRoot === undefined) continue;
    const spec = artifactForRetiredWorktree(candidate, projectRoot, store, registry);
    if (spec !== undefined) keys.add(canonicalArtifactPath(spec.source));
  }
  return keys;
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
    if (candidate.skipSpecArchival === true) continue;
    const projectRoot = registry[candidate.project]?.root;
    if (projectRoot === undefined) continue;
    const spec = artifactForRetiredWorktree(candidate, projectRoot, store, registry);
    if (spec !== undefined && existsSync(spec.source)) previewArtifact(spec, io);
  }
}

async function recheckEligibleWorktrees(
  candidates: readonly CleanupCandidate[],
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void },
): Promise<{ candidates: CleanupCandidate[]; daemonUnreachable: boolean }> {
  const stillEligible: CleanupCandidate[] = [];
  let daemonUnreachable = false;
  for (const candidate of candidates) {
    const projectRoot = registry[candidate.project]?.root;
    const recheck = await checkEligibility(
      candidate.worktree,
      candidate.project,
      runner,
      daemonClient,
      store,
      projectRoot !== undefined ? { projectRoot, registry, configPath } : undefined,
    );
    if (recheck.status === "eligible") {
      const entry: CleanupCandidate = { ...candidate };
      if (recheck.skipSpecArchival === true) entry.skipSpecArchival = true;
      else delete entry.skipSpecArchival;
      stillEligible.push(entry);
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
  jarvisRoot: string,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  refPruneSnapshots: ReadonlyMap<string, MergedBranchRefSnapshot>,
  daemonClient: DaemonClient,
  retiredBranches: Set<string>,
  ownerProjectsByRepositoryRoot: ReadonlyMap<string, readonly string[]>,
  skips: ArtifactSkipLedger,
  sessions: ArchivePublicationSessions,
  configPath: string,
): Promise<number> {
  if (candidates.length === 0) return 0;
  return performWorktreeRemovals(
    [...candidates],
    runner,
    io,
    async (candidate) => {
      await archiveRetiredArtifact(
        candidate,
        registry,
        discovered,
        store,
        runner,
        jarvisRoot,
        io,
        skips,
        sessions,
        configPath,
      );
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
        return revalidateMergedBranchRefCandidate(
          refCandidate,
          runner,
          daemonClient,
          store,
          retiredBranches,
          ownerProjectsByRepositoryRoot.get(projectRoot),
          { skipMergedPrAuthority: candidate.skipSpecArchival === true },
        );
      },
      retiredBranches,
      retirementPreflight: { store, registry },
    },
  );
}

type ReaperResult = Awaited<ReturnType<typeof reapLegacyDaemonArtifacts>>;

type SessionLogHotToCold = { path: string; plainBytes: number; orphan: boolean };
type SessionLogColdToGone = { path: string; gzipBytes: number; orphan: boolean };

type SessionLogReapPlan = {
  hotToCold: SessionLogHotToCold[];
  coldToGone: SessionLogColdToGone[];
  tmpToRemove: string[];
} | null;

const SESSION_LOG_NAME_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.log$/i;
const SESSION_LOG_MONTH_SHARD_PATTERN = /^\d{4}-\d{2}$/;

function collectSessionLogScanDirs(sessionsDir: string): string[] {
  const dirs = [sessionsDir];
  if (!existsSync(sessionsDir)) return dirs;
  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return dirs;
  }
  for (const name of entries) {
    if (!SESSION_LOG_MONTH_SHARD_PATTERN.test(name)) continue;
    const path = join(sessionsDir, name);
    try {
      if (statSync(path).isDirectory()) dirs.push(path);
    } catch {
      // Directory may disappear between listing and stat.
    }
  }
  return dirs;
}

function planSessionLogGzEntry(
  dir: string,
  path: string,
  gzName: string,
  gzipBytes: number,
  mtimeMs: number,
  coldCutoffMs: number,
  runsById: ReadonlyMap<string, Run>,
  plan: NonNullable<SessionLogReapPlan>,
): void {
  const plainName = gzName.slice(0, -".gz".length);
  if (existsSync(join(dir, plainName))) return;
  const tier = classifySessionLog(plainName, mtimeMs, coldCutoffMs, runsById);
  if (tier === null) return;
  plan.coldToGone.push({ path, gzipBytes, orphan: tier });
}

function planSessionLogPlainEntry(
  path: string,
  name: string,
  stat: { size: number; mtimeMs: number },
  hotCutoffMs: number,
  coldCutoffMs: number,
  runsById: ReadonlyMap<string, Run>,
  plan: NonNullable<SessionLogReapPlan>,
): void {
  const hotTier = classifySessionLog(name, stat.mtimeMs, hotCutoffMs, runsById);
  if (hotTier === null) return;
  plan.hotToCold.push({ path, plainBytes: stat.size, orphan: hotTier });
  const coldTier = classifySessionLog(name, stat.mtimeMs, coldCutoffMs, runsById);
  if (coldTier === null || existsSync(`${path}.gz`)) return;
  plan.coldToGone.push({
    path: `${path}.gz`,
    gzipBytes: gzipSync(readFileSync(path)).length,
    orphan: coldTier,
  });
}

function scanSessionLogDir(
  dir: string,
  hotCutoffMs: number,
  coldCutoffMs: number,
  runsById: ReadonlyMap<string, Run>,
  plan: NonNullable<SessionLogReapPlan>,
): void {
  if (!existsSync(dir)) return;
  let handle: Dir;
  try {
    handle = opendirSync(dir);
  } catch {
    return;
  }
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      if (!entry.isFile()) continue;
      const path = join(dir, entry.name);
      if (entry.name.endsWith(".log.gz.tmp")) {
        plan.tmpToRemove.push(path);
        continue;
      }
      if (entry.name.endsWith(".log.gz")) {
        try {
          const stat = statSync(path);
          planSessionLogGzEntry(dir, path, entry.name, stat.size, stat.mtimeMs, coldCutoffMs, runsById, plan);
        } catch {
          // A file that disappears during discovery is no longer reclaimable.
        }
        continue;
      }
      if (!entry.name.endsWith(".log")) continue;
      try {
        planSessionLogPlainEntry(path, entry.name, statSync(path), hotCutoffMs, coldCutoffMs, runsById, plan);
      } catch {
        // A file that disappears during discovery is no longer reclaimable.
      }
    }
  } finally {
    handle.closeSync();
  }
}

function discoverExpiredSessionLogs(
  sessionsDir: string,
  configPath: string,
  clock: () => Date,
  store: StateStore,
  io: { stderr: (s: string) => void },
): SessionLogReapPlan {
  let retention: ReturnType<typeof readRetentionSessions>;
  try {
    retention = readRetentionSessions(configPath);
  } catch (error) {
    io.stderr(
      `Failed to load machine config; skipped session-log reaping: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return null;
  }
  if (!retention.ok) {
    io.stderr(`${retention.error}; skipped session-log reaping.\n`);
    return null;
  }

  const nowMs = clock().getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const hotCutoffMs = nowMs - retention.hotDays * dayMs;
  const coldCutoffMs = nowMs - retention.coldDays * dayMs;
  const plan: NonNullable<SessionLogReapPlan> = { hotToCold: [], coldToGone: [], tmpToRemove: [] };
  const runsById = new Map(store.listRuns().map((run) => [run.id, run]));
  for (const dir of collectSessionLogScanDirs(sessionsDir)) {
    scanSessionLogDir(dir, hotCutoffMs, coldCutoffMs, runsById, plan);
  }
  return plan;
}

function gzipSessionLogPlainToCold(plainPath: string): void {
  const gzPath = `${plainPath}.gz`;
  const tmpPath = `${gzPath}.tmp`;
  const compressed = gzipSync(readFileSync(plainPath));
  writeFileSync(tmpPath, compressed);
  renameSync(tmpPath, gzPath);
  rmSync(plainPath, { force: true });
}

/** Returns null to keep the log, else whether it is reaped as an orphan (by mtime). */
function classifySessionLog(
  name: string,
  mtimeMs: number,
  cutoffMs: number,
  runsById: ReadonlyMap<string, Run>,
): boolean | null {
  const run = runsById.get(SESSION_LOG_NAME_PATTERN.exec(name)?.[1] ?? "");
  if (run === undefined) return runsById.size > 0 && mtimeMs < cutoffMs ? true : null;
  const expired =
    isTerminalRunStatus(run.status) &&
    typeof run.finishedAt === "number" &&
    Number.isFinite(run.finishedAt) &&
    run.finishedAt < cutoffMs;
  return expired ? false : null;
}

function printSessionLogSummary(
  verb: "Found" | "Reaped",
  plan: Pick<NonNullable<SessionLogReapPlan>, "hotToCold" | "coldToGone">,
  io: { stdout: (s: string) => void },
): void {
  if (plan.hotToCold.length > 0) {
    const bytes = plan.hotToCold.reduce((total, log) => total + log.plainBytes, 0);
    const orphans = plan.hotToCold.filter((log) => log.orphan).length;
    const orphanSuffix = orphans > 0 ? ` (${orphans} by mtime, no run row)` : "";
    io.stdout(
      `${verb} ${plan.hotToCold.length} session log(s) for hot-to-cold compression${orphanSuffix}: ${bytes} plain bytes.\n`,
    );
  }
  if (plan.coldToGone.length > 0) {
    const bytes = plan.coldToGone.reduce((total, log) => total + log.gzipBytes, 0);
    const orphans = plan.coldToGone.filter((log) => log.orphan).length;
    const orphanSuffix = orphans > 0 ? ` (${orphans} by mtime, no run row)` : "";
    io.stdout(
      `${verb} ${plan.coldToGone.length} session log(s) for cold-to-gone deletion${orphanSuffix}: ${bytes} gzip bytes.\n`,
    );
  }
}

function hasNothingToClean(
  candidates: readonly CleanupCandidate[],
  stranded: readonly StrandedArtifact[],
  reaperResult: ReaperResult,
  branchRefCandidates: readonly MergedBranchRefCandidate[],
  sessionLogPlan: SessionLogReapPlan,
): boolean {
  return (
    candidates.length === 0 &&
    stranded.length === 0 &&
    reaperResult.dead.length === 0 &&
    reaperResult.preserved.length === 0 &&
    branchRefCandidates.length === 0 &&
    (sessionLogPlan === null ||
      (sessionLogPlan.hotToCold.length === 0 &&
        sessionLogPlan.coldToGone.length === 0 &&
        sessionLogPlan.tmpToRemove.length === 0))
  );
}

function previewReaperResult(reaperResult: ReaperResult, io: { stdout: (s: string) => void }): void {
  if (reaperResult.dead.length > 0) {
    io.stdout(`Found ${reaperResult.dead.length} legacy daemon artifact(s) for cleanup:\n`);
    for (const path of reaperResult.dead) {
      io.stdout(`  remove: ${path}\n`);
    }
  }
  if (reaperResult.preserved.length > 0) {
    io.stdout(`Preserved ${reaperResult.preserved.length} legacy daemon artifact(s):\n`);
    for (const item of reaperResult.preserved) {
      io.stdout(`  ${item.unit} — ${item.reason}\n`);
    }
  }
}

async function removeDeadDaemonArtifacts(
  paths: readonly string[],
  jarvisRoot: string,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  legacyDaemonArtifactDeps?: LegacyDaemonArtifactDeps,
): Promise<number> {
  let exitCode = 0;
  const keys = daemonUnitKeysFromNames(paths);

  for (const key of keys) {
    const revalidated = await reapLegacyDaemonArtifacts(jarvisRoot, [key], legacyDaemonArtifactDeps);
    for (const path of revalidated.dead) {
      if (!paths.includes(path)) continue;
      try {
        rmSync(path, { force: true });
        io.stdout(`Removed daemon artifact: ${path}\n`);
      } catch (err) {
        io.stderr(`Failed to remove daemon artifact ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

async function retireStrandedArtifacts(
  stranded: readonly StrandedArtifact[],
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  store: StateStore,
  io: { stdout: (s: string) => void },
  skips: ArtifactSkipLedger,
  sessions: ArchivePublicationSessions,
): Promise<void> {
  for (const spec of stranded) {
    const projectRoot = registry[spec.project]?.root;
    if (projectRoot === undefined) continue;
    if (spec.queue !== undefined) {
      if (spec.inRepoReadyIntentConsumer !== undefined) {
        const consumer: ArtifactSpec = { ...spec.inRepoReadyIntentConsumer, branch: "" };
        reportArchive(
          consumer,
          await sessions.for(spec.project, projectRoot).publishConsumedReadyIntentOnly(consumer, spec.source),
          "stranded artifact",
          io,
        );
        continue;
      }
      reportArchive(spec, pruneConsumedQueueEntry(spec), "stranded artifact", io);
      continue;
    }
    const current = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
    if (
      spec.branch === ""
        ? hasInRepoArtifactOwner(spec, projectRoot, "", current)
        : hasBranchKeyedArtifactOwner(spec, spec.project, "", registry, current, jarvisRoot, { store, projectRoot })
    ) {
      skips.skip(spec.source, "another materialized worktree owns this spec");
      continue;
    }
    reportArchive(spec, await archiveArtifactSpec(spec, spec.project, projectRoot, sessions), "stranded artifact", io);
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
  sessionLogPlan: SessionLogReapPlan;
  daemonUnreachable: DiscoveredWorktree[];
  skips: ArtifactSkipLedger;
};

async function gatherCleanupDiscoveryContext(
  registry: Record<string, ProjectRegistryEntry>,
  ownershipRegistry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  sessionsDir: string,
  configPath: string,
  clock: () => Date,
  skips: ArtifactSkipLedger,
  legacyDaemonArtifactDeps?: LegacyDaemonArtifactDeps,
): Promise<CleanupDiscoveryContext> {
  const branchRefDiscovery = await discoverMergedBranchRefCandidates(registry, { runner, ownershipRegistry });
  const discoveryExit = reportUnusableProjects(branchRefDiscovery.unusableProjects, io);
  const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);
  const { candidates, daemonUnreachable } = await findEligibleWorktreeCandidates(
    discovered,
    registry,
    jarvisRoot,
    runner,
    daemonClient,
    store,
    configPath,
    io,
  );
  const worktreeRefSnapshots = await collectWorktreeRefSnapshots(candidates, registry, runner);
  const daemonUnreachableExit = daemonUnreachable.length > 0 ? 1 : 0;
  const strandedArtifacts = [
    ...discoverStrandedArtifacts(registry, io),
    ...(await discoverInRepoReadyIntentQueueArtifacts(registry, runner)),
  ];
  const retiringPaths = new Set(candidates.map((candidate) => candidate.worktree.path));
  const skipArchivalSources = skipSpecArchivalSourceKeys(candidates, registry, store);
  const stranded = (
    await inspectStrandedArtifacts(
      strandedArtifacts,
      registry,
      discovered.filter((worktree) => !retiringPaths.has(worktree.path)),
      jarvisRoot,
      store,
      runner,
      io,
      skips,
    )
  ).filter((spec) => !skipArchivalSources.has(canonicalArtifactPath(spec.source)));
  const reaperResult = await reapLegacyDaemonArtifacts(jarvisRoot, undefined, legacyDaemonArtifactDeps);
  const sessionLogPlan = discoverExpiredSessionLogs(sessionsDir, configPath, clock, store, io);

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
    sessionLogPlan,
    daemonUnreachable,
    skips,
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
  jarvisRoot: string,
  clock: () => Date,
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
  if (ctx.sessionLogPlan !== null) {
    printSessionLogSummary("Found", ctx.sessionLogPlan, io);
  }
  await previewArchivePublicationTargets(ctx, registry, store, runner, jarvisRoot, clock, io);
}

async function executeConfirmedCleanup(
  ctx: CleanupDiscoveryContext,
  registry: Record<string, ProjectRegistryEntry>,
  configPath: string,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  daemonBlockedExit: number,
  legacyDaemonArtifactDeps?: LegacyDaemonArtifactDeps,
): Promise<number> {
  const recheck = await recheckEligibleWorktrees(ctx.candidates, registry, configPath, runner, daemonClient, store, io);
  const stillEligible = recheck.candidates;
  const retiredBranches = new Set<string>();
  const sessions = createArchivePublicationSessions(runner, jarvisRoot);
  const result = await retireEligibleWorktrees(
    stillEligible,
    registry,
    ctx.discovered,
    store,
    runner,
    jarvisRoot,
    io,
    ctx.worktreeRefSnapshots,
    daemonClient,
    retiredBranches,
    ctx.branchRefDiscovery.ownerProjectsByRepositoryRoot,
    ctx.skips,
    sessions,
    configPath,
  );
  const branchRefExit = await applyMergedBranchRefPrunes(
    ctx.branchRefDiscovery.candidates,
    runner,
    daemonClient,
    store,
    retiredBranches,
    ctx.branchRefDiscovery.ownerProjectsByRepositoryRoot,
    io,
  );
  let sessionLogExit = 0;
  if (ctx.sessionLogPlan !== null) {
    const applied: Pick<NonNullable<SessionLogReapPlan>, "hotToCold" | "coldToGone"> = {
      hotToCold: [],
      coldToGone: [],
    };
    let failures = 0;
    for (const path of ctx.sessionLogPlan.tmpToRemove) {
      try {
        rmSync(path, { force: true });
      } catch {
        failures += 1;
      }
    }
    for (const log of ctx.sessionLogPlan.hotToCold) {
      try {
        gzipSessionLogPlainToCold(log.path);
        applied.hotToCold.push(log);
      } catch {
        failures += 1;
      }
    }
    for (const log of ctx.sessionLogPlan.coldToGone) {
      try {
        rmSync(log.path, { force: true });
        applied.coldToGone.push(log);
      } catch {
        failures += 1;
      }
    }
    printSessionLogSummary("Reaped", applied, io);
    if (failures > 0) {
      io.stderr(`Failed to apply ${failures} session-log retention action(s).\n`);
      sessionLogExit = 1;
    }
  }
  const artifactRemoval = await removeDeadDaemonArtifacts(
    ctx.reaperResult.dead,
    jarvisRoot,
    io,
    legacyDaemonArtifactDeps,
  );

  const skipArchivalSources = skipSpecArchivalSourceKeys(stillEligible, registry, store);
  const strandedAfterRetirement = (
    await inspectStrandedArtifacts(
      ctx.strandedArtifacts,
      registry,
      await discoverMaterializedWorktrees(registry, jarvisRoot, runner),
      jarvisRoot,
      store,
      runner,
      io,
      ctx.skips,
      sessions,
    )
  ).filter((spec) => !skipArchivalSources.has(canonicalArtifactPath(spec.source)));
  await retireStrandedArtifacts(strandedAfterRetirement, registry, jarvisRoot, runner, store, io, ctx.skips, sessions);
  const archivePublicationExit = await applyEndArchivePublication(sessions, runner, io);
  if (stillEligible.length === 0 && ctx.candidates.length > 0) {
    io.stdout("No worktrees remain eligible after re-check.\n");
  }
  if (
    result !== 0 ||
    branchRefExit !== 0 ||
    sessionLogExit !== 0 ||
    artifactRemoval !== 0 ||
    archivePublicationExit !== 0
  ) {
    return 1;
  }
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
    sessionsDir?: string;
    configPath?: string;
    clock?: () => Date;
    legacyDaemonArtifactDeps?: LegacyDaemonArtifactDeps;
  },
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  ownershipRegistry: Record<string, ProjectRegistryEntry> = registry,
): Promise<number> {
  const skips = createArtifactSkipLedger(io);
  try {
    return await runCleanupCommandWithSkipLedger(
      options,
      registry,
      jarvisRoot,
      runner,
      daemonClient,
      store,
      io,
      ownershipRegistry,
      skips,
    );
  } finally {
    skips.flush();
  }
}

async function runCleanupCommandWithSkipLedger(
  options: {
    dryRun?: boolean;
    promptConfirm?: (message: string) => Promise<boolean>;
    sessionsDir?: string;
    configPath?: string;
    clock?: () => Date;
    legacyDaemonArtifactDeps?: LegacyDaemonArtifactDeps;
  },
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  ownershipRegistry: Record<string, ProjectRegistryEntry>,
  skips: ArtifactSkipLedger,
): Promise<number> {
  const ctx = await gatherCleanupDiscoveryContext(
    registry,
    ownershipRegistry,
    jarvisRoot,
    runner,
    daemonClient,
    store,
    io,
    options.sessionsDir ?? join(jarvisRoot, "sessions"),
    options.configPath ?? join(jarvisRoot, "config.json"),
    options.clock ?? (() => new Date()),
    skips,
    options.legacyDaemonArtifactDeps,
  );

  for (const worktree of ctx.daemonUnreachable) {
    io.stdout(`Skipped merged worktree: ${worktree.path} — ${DAEMON_UNREACHABLE_REASON}\n`);
  }

  if (
    hasNothingToClean(
      ctx.candidates,
      ctx.stranded,
      ctx.reaperResult,
      ctx.branchRefDiscovery.candidates,
      ctx.sessionLogPlan,
    )
  ) {
    io.stdout("No eligible worktrees or stranded artifacts to clean up.\n");
    return resolveDiscoveryOrDaemonExit(ctx.discoveryExit, ctx.daemonUnreachableExit);
  }

  await previewAllCleanupTargets(ctx, registry, store, runner, jarvisRoot, options.clock ?? (() => new Date()), io);

  const headOnlyDaemonUnreachableExit = (await hasHeadOnlyDaemonUnreachableSkip(
    ctx.branchRefDiscovery.candidates,
    runner,
    daemonClient,
    store,
    new Set<string>(),
    ctx.branchRefDiscovery.ownerProjectsByRepositoryRoot,
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

  return executeConfirmedCleanup(
    ctx,
    registry,
    options.configPath ?? join(jarvisRoot, "config.json"),
    jarvisRoot,
    runner,
    daemonClient,
    store,
    io,
    daemonBlockedExit,
    options.legacyDaemonArtifactDeps,
  );
}

type WorktreeRefPruneOptions = {
  refPruneSnapshotForCandidate?: (candidate: CleanupCandidate) => MergedBranchRefSnapshot | undefined;
  revalidateRefPrune?: (candidate: CleanupCandidate, snapshot: MergedBranchRefSnapshot) => Promise<EligibilityResult>;
  retiredBranches?: Set<string>;
  retirementPreflight?: {
    store: StateStore;
    registry: Record<string, ProjectRegistryEntry>;
  };
};

class MergedWorktreeRetirementRefusal extends Error {
  readonly dirtyPaths: readonly string[];

  constructor(dirtyPaths: readonly string[]) {
    super("worktree has uncommitted changes");
    this.name = "MergedWorktreeRetirementRefusal";
    this.dirtyPaths = dirtyPaths;
  }
}

function mergedWorktreeRetirementRefusalLine(
  worktreePath: string,
  branch: string,
  dirtyPaths: readonly string[],
): string {
  const pathDetail = dirtyPaths.length > 0 ? dirtyPaths.join(", ") : "unparseable git status output";
  return `Skipped merged worktree retirement: ${worktreePath} — worktree has uncommitted changes (${pathDetail}); run jarvis cleanup --abandon ${branch} --discard-unlanded after verifying\n`;
}

function isReadableSpecIndexInWorktree(worktreePath: string, projectRoot: string, specIndexRel: string): boolean {
  const worktreeAbs = join(worktreePath, specIndexRel);
  if (!isPathInside(projectRoot, resolve(projectRoot, specIndexRel))) return false;
  if (!existsSync(worktreeAbs)) return false;
  try {
    readFileSync(worktreeAbs, "utf8");
    return true;
  } catch {
    return false;
  }
}

function resolveMergedWorktreeSpecIndexPath(
  candidate: CleanupCandidate,
  projectRoot: string,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
  options?: { acceptWorktreeReadableIndex?: boolean },
): string | undefined {
  for (const run of store.listRuns()) {
    if (run.project !== candidate.project || run.branch !== candidate.worktree.branch) continue;
    const source = sourceForRun(run, candidate.worktree.path, projectRoot, registry);
    if (source === undefined) continue;
    const indexAbs = basename(source) === "index.md" ? source : join(source, "index.md");
    const relPath = relative(projectRoot, indexAbs);
    if (relPath === "" || relPath.startsWith("..") || isAbsolute(relPath)) continue;
    if (
      isStaleResetLandedCriteriaSpecPath(projectRoot, relPath) ||
      (options?.acceptWorktreeReadableIndex === true &&
        isReadableSpecIndexInWorktree(candidate.worktree.path, projectRoot, relPath))
    ) {
      return relPath;
    }
  }
  return undefined;
}

type MergedWorktreeRemovalPlan = { action: "remove" } | { action: "force-remove" };

async function planMergedWorktreeRemoval(
  candidate: CleanupCandidate,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
  store: StateStore,
  registry: Record<string, ProjectRegistryEntry>,
): Promise<MergedWorktreeRemovalPlan> {
  const dirtyList = await listDirtyWorktreePathsForStaleReset(candidate.worktree.path, runner);
  if (dirtyList.status === "clean" || dirtyList.status === "not-git-repository") {
    return { action: "remove" };
  }
  if (dirtyList.status === "error") {
    throw new MergedWorktreeRetirementRefusal([]);
  }

  const dirtyPaths = dirtyList.paths;
  const nonStagingDirty = dirtyPaths.filter((path) => !isHarnessWorkflowStagingPath(path));
  if (nonStagingDirty.length === 0) return { action: "force-remove" };

  const specPath = resolveMergedWorktreeSpecIndexPath(candidate, projectRoot, store, registry);
  if (specPath === undefined) throw new MergedWorktreeRetirementRefusal(dirtyPaths);

  const baseBranch = await getBaseBranch(projectRoot, runner);
  const baseRef = await resolveStaleResetRef(projectRoot, baseBranch, runner);
  const specTree = { projectRoot, worktreePath: candidate.worktree.path, baseRef, specPath, runner };
  const specRelPaths = new Set(
    specTreeRelPaths(projectRoot, specPath, (absPath) => {
      const worktreeAbsPath = join(candidate.worktree.path, relative(projectRoot, absPath));
      if (!existsSync(worktreeAbsPath)) throw new Error(`worktree spec unreadable: ${relative(projectRoot, absPath)}`);
      return readFileSync(worktreeAbsPath, "utf8");
    }),
  );
  const driftedSubspecPaths = new Set(await landedCriteriaAbsentFromBase(specTree));
  for (const path of nonStagingDirty) {
    if (!specRelPaths.has(path) || driftedSubspecPaths.has(path)) {
      throw new MergedWorktreeRetirementRefusal(dirtyPaths);
    }
  }
  return { action: "force-remove" };
}

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
  const preflight = refPruneOptions?.retirementPreflight;
  let forceRemove = false;
  if (preflight !== undefined) {
    const plan = await planMergedWorktreeRemoval(candidate, projectRoot, runner, preflight.store, preflight.registry);
    forceRemove = plan.action === "force-remove";
  }
  await removeWorktree(projectRoot, worktree.path, runner, { force: forceRemove });
  io.stdout(`Removed worktree: ${worktree.path}\n`);

  try {
    await pruneWorktrees(projectRoot, runner);
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
      if (err instanceof MergedWorktreeRetirementRefusal) {
        io.stdout(mergedWorktreeRetirementRefusalLine(worktree.path, worktree.branch, err.dirtyPaths));
      } else {
        io.stderr(`Failed to retire ${worktree.path}: ${cleanupOperationErrorMessage(err)}\n`);
      }
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
export const OPEN_PR_PROBE_UNREACHABLE_REASON =
  "could not determine open PR state: gh is unreachable from this environment; retry outside the agent sandbox";

function cleanupOperationErrorMessage(error: unknown): string {
  if (error instanceof GitOperationError) {
    return `${error.message} (retryable: ${error.retryable})`;
  }
  if (error instanceof GitHubOperationError) {
    return `gh ${error.operation} ${error.reason}: ${error.message} (retryable: ${error.retryable})`;
  }
  return errorMessage(error);
}

const staleResetDirtyRecovery = `commit, discard local changes, pass ${STALE_RESET_OVERRIDE_CLI_FLAG} on re-run, or run \`jarvis cleanup --abandon <branch>\``;
const staleResetLandedCriteriaRecovery = `pass ${STALE_RESET_LANDED_CRITERIA_OVERRIDE_CLI_FLAG} on re-run, or run \`jarvis cleanup --abandon <branch>\``;
const staleResetListingErrorRecovery = `commit, discard local changes, or run \`jarvis cleanup --abandon <branch>\``;

export async function isDescendantOfBase(
  worktreeHead: string,
  baseRef: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  return isAncestor(projectRoot, baseRef, worktreeHead, runner);
}

/** True when `head` carries nothing unlanded: an ancestor of base, or every `base..head` commit patch-equivalent in base (squash-merged). */
async function carriesNoUnlandedCommits(
  head: string,
  baseRef: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  if (await isDescendantOfBase(baseRef, head, projectRoot, runner)) return true;
  try {
    // Merging the lane into base changes nothing: every lane change already landed, including a
    // multi-commit lane squash-merged into one base commit (which `git cherry` reports as unlanded).
    const [mergedTree, baseTree] = await Promise.all([
      mergeTreeWriteTree(projectRoot, baseRef, head, runner),
      resolveRef(projectRoot, `${baseRef}^{tree}`, runner),
    ]);
    if (baseTree.status === "absent") return false;
    return mergedTree === baseTree.oid;
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
  return readBlobAtRef(projectRoot, baseRef, relPath, runner);
}

async function resolveStaleResetRef(
  projectRoot: string,
  gitRef: string,
  runner: AsyncSubprocessRunner,
): Promise<string> {
  const resolved = await resolveRef(projectRoot, gitRef, runner);
  if (resolved.status === "absent") {
    throw new GitOperationError("ref-query", "failed", `ref not found: ${gitRef}`, "", 1);
  }
  return resolved.oid;
}

/** A commit's diff hunk for one path, split from a multi-commit `git log -p --format=%H` run. */
function splitPerCommitDiffBlocks(log: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of log.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * True when one commit's diff both adds a checked `criterionText` line and either creates the file
 * or removes that same unchecked line — a genuine new-file introduction or unchecked-to-checked
 * transition. An added checked line with neither (e.g. a brand-new bullet typed in already checked)
 * is not evidence of completed work, only of a line that now exists.
 */
function blockBacksCheckedCriterion(block: string, criterionText: string): boolean {
  const isNewFile = block.split("\n").some((line) => line.startsWith("new file mode"));
  let addedChecked = false;
  let removedUnchecked = false;
  for (const line of block.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      const match = line.slice(1).match(/^\s*-\s\[([ xX])\]\s+(.*)$/);
      if (match !== null && (match[1] ?? " ").toLowerCase() === "x" && (match[2] ?? "").trim() === criterionText) {
        addedChecked = true;
      }
    } else if (line.startsWith("-")) {
      const match = line.slice(1).match(/^\s*-\s\[([ xX])\]\s+(.*)$/);
      if (match !== null && (match[1] ?? " ").toLowerCase() !== "x" && (match[2] ?? "").trim() === criterionText) {
        removedUnchecked = true;
      }
    }
  }
  return addedChecked && (isNewFile || removedUnchecked);
}

/** True when some commit in `baseRef..branch` genuinely backs `criterionText` becoming checked in `relPath`. */
async function checkedCriterionBackedByCommit(
  projectRoot: string,
  baseRef: string,
  branch: string,
  relPath: string,
  criterionText: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  let log: string;
  try {
    log = await logPatchForPathInRange(projectRoot, baseRef, branch, relPath, runner);
  } catch {
    return false;
  }
  return splitPerCommitDiffBlocks(log).some((block) => blockBacksCheckedCriterion(block, criterionText));
}

async function hasUnbackedCheckedCriterion(
  worktreeCriteria: AcceptanceCriterion[],
  baseCriteria: AcceptanceCriterion[],
  projectRoot: string,
  baseRef: string,
  branch: string,
  relPath: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  for (let index = 0; index < worktreeCriteria.length; index += 1) {
    const worktreeCriterion = worktreeCriteria[index];
    if (worktreeCriterion === undefined || !worktreeCriterion.checked) continue;
    const baseCriterion = baseCriteria[index];
    if (baseCriterion?.checked) continue;
    const backed = await checkedCriterionBackedByCommit(
      projectRoot,
      baseRef,
      branch,
      relPath,
      worktreeCriterion.text,
      runner,
    );
    if (!backed) return true;
  }
  return false;
}

/** Subspec paths (within `specTree`) carrying at least one checked-absent-from-base criterion with no backing `base..branch` commit. */
async function unbackedCheckedCriteriaPaths(specTree: LandedCriteriaSpecTree, branch: string): Promise<string[]> {
  const { projectRoot, worktreePath, baseRef, specPath, runner } = specTree;
  const relPaths = specTreeRelPaths(projectRoot, specPath, (absPath) => {
    const worktreeAbsPath = join(worktreePath, relative(projectRoot, absPath));
    if (!existsSync(worktreeAbsPath)) throw new Error(`worktree spec unreadable: ${relative(projectRoot, absPath)}`);
    return readFileSync(worktreeAbsPath, "utf8");
  });
  const unbacked: string[] = [];
  for (const relPath of relPaths) {
    const worktreeAbsPath = join(worktreePath, relPath);
    if (!existsSync(worktreeAbsPath)) continue;
    const worktreeCriteria = parseSpec(readFileSync(worktreeAbsPath, "utf8")).acceptanceCriteria.filter(
      (criterion) => !criterion.humanOnly,
    );
    const baseContent = await readGitFileAtRef(projectRoot, baseRef, relPath, runner);
    const baseCriteria =
      baseContent !== undefined ? parseSpec(baseContent).acceptanceCriteria.filter((c) => !c.humanOnly) : [];
    if (
      await hasUnbackedCheckedCriterion(worktreeCriteria, baseCriteria, projectRoot, baseRef, branch, relPath, runner)
    ) {
      unbacked.push(relPath);
    }
  }
  return unbacked;
}

async function hasCommonAncestor(
  a: string,
  b: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await mergeBase(projectRoot, a, b, runner);
    return true;
  } catch {
    return false;
  }
}

/** `undefined` means no verdict — the caller falls through to the pre-continuation gates unchanged. */
/** `preRebaseSha` is set only when this call rebased the lane: the lane tip before the rewrite, which authorizes the publisher's lease push. */
type CommittedLaneContinuationResult =
  | { status: "continue"; preRebaseSha?: string }
  | { status: "refused"; reason: string };

/** Post-descent decision: no trackable spec continues unconditionally; a trackable spec continues once every checked-absent-from-base criterion is commit-backed, unless the override forces retirement. */
async function evaluateContinuationTickBacking(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  trackableSpecPath: string | undefined;
  skipLandedCriteriaGate: boolean;
  runner: AsyncSubprocessRunner;
}): Promise<CommittedLaneContinuationResult | undefined> {
  const { projectRoot, worktreePath, branch, baseRef, trackableSpecPath, skipLandedCriteriaGate, runner } = args;
  if (trackableSpecPath === undefined) return { status: "continue" };
  if (skipLandedCriteriaGate) return undefined;
  const unbackedPaths = await unbackedCheckedCriteriaPaths(
    { projectRoot, worktreePath, baseRef, specPath: trackableSpecPath, runner },
    branch,
  );
  if (unbackedPaths.length > 0) {
    return { status: "refused", reason: staleResetForgedTickGateReason(unbackedPaths) };
  }
  return { status: "continue" };
}

/**
 * The three gates a non-disposable lane faced before continuation existed: unlanded commits (no open
 * PR yet), non-descendant `HEAD`, and landed-criteria drift. Applied whenever continuation isn't
 * attempted (dirty tree, nothing ahead of base) or was attempted but returned no verdict — never on a
 * lane that continuation itself resolved to `continue` or `refused`, where these gates are moot.
 */
async function applyPreContinuationGates(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  baseHead: string;
  worktreeHead: string;
  commitCount: number;
  hasOpenPr: boolean;
  trackableSpecPath: string | undefined;
  skipLandedCriteriaGate: boolean;
  continuePathAvailable?: boolean;
  runner: AsyncSubprocessRunner;
}): Promise<string[]> {
  const {
    projectRoot,
    worktreePath,
    branch,
    baseRef,
    baseHead,
    worktreeHead,
    commitCount,
    hasOpenPr,
    trackableSpecPath,
    skipLandedCriteriaGate,
    continuePathAvailable,
    runner,
  } = args;
  const parts: string[] = [];
  if (!hasOpenPr && commitCount > 0) {
    const nonStagingPaths = await unlandedNonStagingPaths(projectRoot, branch, baseRef, runner);
    if (nonStagingPaths.length > 0 && !(await carriesNoUnlandedCommits(branch, baseRef, projectRoot, runner))) {
      parts.push(staleResetUnlandedCommitsGateReason(worktreeHead, commitCount, continuePathAvailable === true));
    }
  }
  if (
    !(await isDescendantOfBase(worktreeHead, baseRef, projectRoot, runner)) &&
    !(await carriesNoUnlandedCommits(worktreeHead, baseRef, projectRoot, runner))
  ) {
    parts.push(staleResetDescendantGateReason(baseRef, baseHead, worktreeHead));
  }
  if (trackableSpecPath !== undefined) {
    const specTree = { projectRoot, worktreePath, baseRef, specPath: trackableSpecPath, runner };
    const driftedSubspecPaths = await landedCriteriaAbsentFromBase(specTree);
    if (driftedSubspecPaths.length > 0 && !skipLandedCriteriaGate) {
      parts.push(staleResetLandedCriteriaGateReason(driftedSubspecPaths));
    }
  }
  return parts;
}

/** Committed-lane continuation: descendant tick-backing, or merge/rebase onto a moved base when continuation-readable. */
async function evaluateCommittedLaneContinuation(args: {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  baseHead: string;
  worktreeHead: string;
  hasOpenPr: boolean;
  specPath: string | undefined;
  skipLandedCriteriaGate: boolean;
  runner: AsyncSubprocessRunner;
}): Promise<CommittedLaneContinuationResult | undefined> {
  const {
    projectRoot,
    worktreePath,
    baseRef,
    baseHead,
    worktreeHead,
    hasOpenPr,
    specPath,
    skipLandedCriteriaGate,
    runner,
  } = args;
  const trackableSpecPath =
    specPath !== undefined && isStaleResetLandedCriteriaSpecPath(projectRoot, specPath) ? specPath : undefined;
  const continuationReadableSpecPath =
    specPath !== undefined && isContinuationReadableSpecPath(projectRoot, specPath) ? specPath : undefined;
  const tickBackingArgs = { ...args, trackableSpecPath };

  if (await isDescendantOfBase(worktreeHead, baseRef, projectRoot, runner)) {
    return evaluateContinuationTickBacking(tickBackingArgs);
  }

  if (await carriesNoUnlandedCommits(worktreeHead, baseRef, projectRoot, runner)) {
    return undefined;
  }

  if (
    continuationReadableSpecPath === undefined ||
    !(await hasCommonAncestor(worktreeHead, baseHead, projectRoot, runner))
  ) {
    return { status: "refused", reason: staleResetDescendantGateReason(baseRef, baseHead, worktreeHead) };
  }

  // Tick backing is evaluated against the pre-rebase `base..branch` range before the rebase mutates
  // the branch: a clean rebase replays the same commit content under new SHAs, so the verdict doesn't
  // change, and a refusal here never lands on a branch this call already rewrote. Out-of-root chained
  // specs skip tick-backing — lane `git log` cannot validate ticks against a prior-worktree tree.
  if (trackableSpecPath !== undefined) {
    const tickBacking = await evaluateContinuationTickBacking(tickBackingArgs);
    if (tickBacking?.status !== "continue") return tickBacking;
  }

  if (skipLandedCriteriaGate) return undefined;

  let rewrite = hasOpenPr
    ? await abortableWorktreeMergeNoEdit(worktreePath, baseHead, runner)
    : await abortableWorktreeRebase(worktreePath, baseHead, runner);
  if (hasOpenPr && rewrite === undefined) await deleteRef(worktreePath, "ORIG_HEAD", runner);
  if (rewrite !== undefined) {
    return { status: "refused", reason: staleResetRebaseConflictGateReason(baseHead, rewrite) };
  }
  return hasOpenPr ? { status: "continue" } : { status: "continue", preRebaseSha: worktreeHead };
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

function isJarvisHarnessSidecarPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith(".jarvis-"));
}

function isHarnessWorkflowStagingPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === ".jarvis-plan-stage" || normalized.startsWith(".jarvis-plan-stage/")) return true;
  if (normalized === ".jarvis-intent-stage" || normalized.startsWith(".jarvis-intent-stage/")) return true;
  return isJarvisHarnessSidecarPath(path);
}

const staleResetUnlandedSalvageRecovery =
  "hand-finish the branch or run `jarvis cleanup --abandon <branch>` before retiring the workspace";

/** `continuePathAvailable` is set only when `--reset-despite-continuable` forced retirement of a lane that could have continued. */
export function staleResetUnlandedCommitsGateReason(
  tipSha: string,
  commitCount: number,
  continuePathAvailable = false,
  salvageRecovery = staleResetUnlandedSalvageRecovery,
): string {
  const recovery = continuePathAvailable
    ? `re-run without \`--reset-despite-continuable\` to continue the lane, ${salvageRecovery}`
    : salvageRecovery;
  return `branch has ${commitCount} commit(s) not on base (tip ${tipSha}); ${recovery}`;
}

/** Refusal when the worktree holds a commit the branch ref cannot reach, so retiring it would lose work. */
export function staleResetUnreachableWorktreeHeadGateReason(
  branch: string,
  worktreeHead: string,
  salvageRecovery = staleResetUnlandedSalvageRecovery,
): string {
  return `worktree HEAD ${worktreeHead} is not reachable from ${branch}, so retiring the branch would discard it; ${salvageRecovery}`;
}

/** Refusal when a checked criterion absent from base has no backing `base..HEAD` commit — a forged tick, not committed progress. */
export function staleResetForgedTickGateReason(unbackedSubspecPaths: string[]): string {
  const pathDetail = unbackedSubspecPaths.join(", ");
  return `worktree spec has acceptance criteria ticked with no backing commit (${pathDetail}); untick the criteria or run \`jarvis cleanup --abandon <branch>\` before re-running`;
}

/** Refusal when rebasing a committed lane onto a moved base conflicts; the worktree is left exactly as it was. */
export function staleResetRebaseConflictGateReason(baseHead: string, conflictPaths: string[]): string {
  const pathDetail = conflictPaths.length > 0 ? conflictPaths.join(", ") : "unknown conflicting paths";
  return `rebase onto base ${baseHead} conflicted (${pathDetail}); rebase aborted, worktree unchanged; resolve manually or run \`jarvis cleanup --abandon <branch>\``;
}

function pathAllowedForPlanLane(path: string, allowedPrefixes: readonly string[]): boolean {
  return allowedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

async function unlandedNonStagingPaths(
  projectRoot: string,
  branch: string,
  baseRef: string,
  runner: AsyncSubprocessRunner,
  allowedPrefixes?: readonly string[],
  options?: { mergeBase?: boolean },
): Promise<string[]> {
  // Plan-lane scope diffs from the merge-base (`...`) so default-branch commits after the lane cut
  // do not read as lane paths; stale-reset callers keep the tree diff (`..`).
  const paths =
    options?.mergeBase === true
      ? await diffNameOnlyRevision(projectRoot, `${baseRef}...${branch}`, runner)
      : await diffNameOnly(projectRoot, { from: baseRef, to: branch }, runner);
  return paths
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false;
      if (isHarnessWorkflowStagingPath(line)) return false;
      if (allowedPrefixes !== undefined && pathAllowedForPlanLane(line, allowedPrefixes)) return false;
      return true;
    });
}

async function unlandedCommitCount(
  projectRoot: string,
  branch: string,
  baseRef: string,
  runner: AsyncSubprocessRunner,
): Promise<number> {
  return countCommitsBetween(projectRoot, baseRef, branch, runner);
}

/** True when `absPath` resolves inside `root` (or is `root` itself). */
function isPathInside(root: string, absPath: string): boolean {
  const rel = relative(root, absPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveWriteStepSpecPath(projectRoot: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : resolve(projectRoot, specPath);
}

/** True when the write-step spec path is readable at its own location (markdown file or `index.md` directory). */
export function isContinuationReadableSpecPath(projectRoot: string, specPath: string): boolean {
  const absoluteSpecPath = resolveWriteStepSpecPath(projectRoot, specPath);
  if (!existsSync(absoluteSpecPath)) return false;
  try {
    if (statSync(absoluteSpecPath).isDirectory()) {
      const indexPath = join(absoluteSpecPath, "index.md");
      if (!existsSync(indexPath)) return false;
      readFileSync(indexPath, "utf8");
      return true;
    }
    readFileSync(absoluteSpecPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function isStaleResetLandedCriteriaSpecPath(projectRoot: string, specPath: string): boolean {
  const absoluteSpecPath = resolveWriteStepSpecPath(projectRoot, specPath);
  // The comparison reads each spec file at `join(worktreePath, relative(projectRoot, absPath))`,
  // which is only meaningful for a tree inside the project root. A chained fan-out lane's spec
  // lives in the prior stage's worktree under `~/.jarvis/worktrees/...`, so that relative path
  // escapes upward (`../../.jarvis/...`), resolves nowhere under the managed worktree, and the
  // gate reports `worktree spec unreadable` for a file that reads fine at its own location.
  // Out-of-root trees skip the comparison, matching the documented external-plan-path behavior.
  if (!isPathInside(projectRoot, absoluteSpecPath)) return false;
  if (!existsSync(absoluteSpecPath)) return false;
  try {
    if (statSync(absoluteSpecPath).isDirectory()) return false;
    readFileSync(absoluteSpecPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function listDirtyWorktreePathsForStaleReset(
  worktreePath: string,
  runner: AsyncSubprocessRunner,
): Promise<DirtyWorktreeListResult> {
  try {
    const inventory = await getGitStatusInventory(worktreePath, runner);
    const paths: string[] = [];
    for (const entry of inventory) {
      const untracked = entry.stagedStatus === "untracked" || entry.worktreeStatus === "untracked";
      if (untracked && isJarvisHarnessSidecarPath(entry.currentPath)) continue;
      if (untracked && isMaterializedNodeModulesPath(worktreePath, entry.currentPath)) continue;
      paths.push(entry.currentPath);
    }
    return paths.length === 0 ? { status: "clean" } : { status: "dirty", paths };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Malformed git status inventory:")) return { status: "dirty", paths: [] };
    return hasNotGitRepositoryDiagnostic(err) ? { status: "not-git-repository" } : { status: "error", message };
  }
}

function hasNotGitRepositoryDiagnostic(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const stderr =
    typeof error === "object" && error !== null && typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr
      : "";
  return isNotGitRepositoryDiagnostic(`${message}\n${stderr}`);
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
  disposableLane?: boolean;
  resetDespiteContinuable?: boolean;
  baseRef?: string;
  specPath?: string;
  /** Evaluate pre-mutation gates only; never rebase, reset, or destroy artifacts. */
  gatesOnly?: boolean;
  /** Skip the workflow-start claim probe (resume admission excludes `worktree_claimed`). */
  skipWorktreeClaimGate?: boolean;
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
  | { status: "continue"; preRebaseSha?: string }
  | { status: "refused"; code: "worktree_claimed"; message: string }
  | { status: "refused"; reason: string; destroyed?: DestroyedArtifacts }
> {
  const worktreePath = managedWorktreePath(jarvisRoot, project, branch);
  if (!existsSync(worktreePath)) return { status: "no-op" };

  const liveCheck = await isWorktreeLiveHeld(project, branch, jarvisRoot, daemonClient);
  if (liveCheck.live) return { status: "refused", reason: liveCheck.reason };

  const prGate = await gateOnOpenPrs(branch, runner, projectRoot);
  if (prGate.status !== "ok") return { status: "refused", reason: prGate.reason };

  if (options.skipWorktreeClaimGate !== true) {
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
  }

  const dirtyList = await listDirtyWorktreePathsForStaleReset(worktreePath, runner);
  if (dirtyList.status === "not-git-repository") return { status: "no-op" };

  const refusalParts: string[] = [];
  const skipDirtyWorktreeGate = options.skipDirtyWorktreeGate === true;
  const skipLandedCriteriaGate = options.skipLandedCriteriaGate === true;
  const disposableLane = options.disposableLane === true;
  const baseRef = options.baseRef;
  const specPath = options.specPath;
  let continuationEligible = false;
  let preRebaseSha: string | undefined;

  if (baseRef !== undefined) {
    const [worktreeHead, baseHead] = await Promise.all([
      resolveStaleResetRef(worktreePath, "HEAD", runner),
      resolveStaleResetRef(projectRoot, baseRef, runner),
    ]);
    if (disposableLane) {
      if (prGate.pr === undefined) {
        const commitCount = await unlandedCommitCount(projectRoot, branch, baseRef, runner);
        if (commitCount > 0) {
          const nonStagingPaths = await unlandedNonStagingPaths(projectRoot, branch, baseRef, runner);
          if (nonStagingPaths.length > 0 && !(await carriesNoUnlandedCommits(branch, baseRef, projectRoot, runner))) {
            refusalParts.push(staleResetUnlandedCommitsGateReason(worktreeHead, commitCount));
          }
        }
      }
      // Never-landed classification reasons entirely from the *branch* ref (`unlandedCommitCount` and
      // `unlandedNonStagingPaths` compare `branch` against `baseRef` in `projectRoot`), so commits the
      // worktree made that the branch ref cannot reach are invisible to it — a detached `HEAD`, or a
      // branch ref moved back while the worktree kept committing. The descendant gate below was the
      // only check that resolved `HEAD` inside the worktree, and `disposableLane` skips it. This gate
      // survives the bypass: it does not require descent from base, only that retiring the branch
      // cannot destroy a commit reachable only from the worktree.
      if (!(await isDescendantOfBase(branch, worktreeHead, projectRoot, runner))) {
        refusalParts.push(staleResetUnreachableWorktreeHeadGateReason(branch, worktreeHead));
      }
    } else {
      const trackableSpecPath =
        specPath !== undefined && isStaleResetLandedCriteriaSpecPath(projectRoot, specPath) ? specPath : undefined;
      const commitCount = await unlandedCommitCount(projectRoot, branch, baseRef, runner);
      const preContinuationGateArgs = {
        projectRoot,
        worktreePath,
        branch,
        baseRef,
        baseHead,
        worktreeHead,
        commitCount,
        hasOpenPr: prGate.pr !== undefined,
        trackableSpecPath,
        skipLandedCriteriaGate,
        runner,
      };
      // Continuation is clean-tree-only: attempting it (including a rebase) against a dirty worktree
      // would misreport a plain dirty-tree refusal as a rebase conflict. A dirty lane, like one with
      // nothing ahead of base, falls through to the pre-continuation gates (unlanded-commits,
      // descendant, landed-criteria-drift — unconditional in the pre-continuation code this restores)
      // — the dirty gate below then refuses or, on override, lets an ordinary reset proceed.
      if (commitCount === 0 || dirtyList.status !== "clean") {
        refusalParts.push(...(await applyPreContinuationGates(preContinuationGateArgs)));
      } else if (!(await isDescendantOfBase(branch, worktreeHead, projectRoot, runner))) {
        // Continuation rebases whatever the worktree has checked out, while never-landed reasoning
        // and every later retirement key off the *branch* ref. A `HEAD` the branch cannot reach (a
        // detached worktree, or a branch ref moved back while the worktree kept committing) would be
        // rebased into commits reachable only from that `HEAD`, which a later `--abandon` of the
        // branch would then discard. The disposable path keeps this same guarantee above; continuation
        // must not be the one path that drops it.
        refusalParts.push(staleResetUnreachableWorktreeHeadGateReason(branch, worktreeHead));
      } else {
        // `--reset-despite-continuable` skips only the continuation verdict; the no-verdict branch
        // below still applies every pre-continuation gate.
        const continuation =
          options.resetDespiteContinuable === true
            ? undefined
            : await evaluateCommittedLaneContinuation({
                projectRoot,
                worktreePath,
                branch,
                baseRef,
                baseHead,
                worktreeHead,
                hasOpenPr: prGate.pr !== undefined,
                specPath,
                skipLandedCriteriaGate,
                runner,
              });
        if (continuation?.status === "refused") {
          refusalParts.push(continuation.reason);
        } else if (continuation?.status === "continue") {
          continuationEligible = true;
          preRebaseSha = continuation.preRebaseSha;
        } else {
          // No verdict (e.g. `--reset-despite-landed-criteria` or `--reset-despite-continuable` on an otherwise-continuable, descendant
          // lane): fall through to the same pre-continuation gates as the dirty/nothing-ahead case.
          refusalParts.push(
            ...(await applyPreContinuationGates({
              ...preContinuationGateArgs,
              continuePathAvailable: options.resetDespiteContinuable === true,
            })),
          );
        }
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

  if (options.gatesOnly === true) {
    return continuationEligible
      ? preRebaseSha !== undefined
        ? { status: "continue", preRebaseSha }
        : { status: "continue" }
      : { status: "no-op" };
  }

  // continuationEligible is only ever set inside the branch gated on `dirtyList.status === "clean"`
  // (see the `else` above), and dirtyList is never reassigned, so that condition is already implied.
  if (continuationEligible) {
    return preRebaseSha !== undefined ? { status: "continue", preRebaseSha } : { status: "continue" };
  }

  if (baseRef !== undefined) {
    const baseRefusal = await staleResetBaseRefusalReason(baseRef, branch, projectRoot, runner);
    if (baseRefusal !== undefined) return { status: "refused", reason: baseRefusal };
  }

  const tips = await captureBranchTips(branch, projectRoot, runner);
  const abandonResult = await performAbandonmentSteps(branch, worktreePath, projectRoot, prGate.pr?.number, runner, io);
  const destroyed = withDestroyedBranchTips(abandonResult.destroyed, tips);
  if (abandonResult.ok) return { status: "reset", destroyed };
  return {
    status: "refused",
    reason: `retirement failed at ${abandonResult.step}; ${remainingArtifactsAfter(abandonResult.step)}`,
    destroyed,
  };
}

type BranchTips = Pick<DestroyedArtifacts, "localTipSha" | "remoteTipSha">;

async function resolveBranchTip(
  ref: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  try {
    const resolved = await resolveRef(projectRoot, `${ref}^{commit}`, runner);
    if (resolved.status !== "resolved") return undefined;
    return /^[0-9a-f]{40}$/.test(resolved.oid) ? resolved.oid : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort tips for the report of what retirement destroys; must run before deletion. Remote tip is the local remote-tracking ref (no network, may be stale). */
async function captureBranchTips(
  branch: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<BranchTips> {
  const [localTipSha, remoteTipSha] = await Promise.all([
    resolveBranchTip(`refs/heads/${branch}`, projectRoot, runner),
    resolveBranchTip(`refs/remotes/origin/${branch}`, projectRoot, runner),
  ]);
  return {
    ...(localTipSha !== undefined ? { localTipSha } : {}),
    ...(remoteTipSha !== undefined ? { remoteTipSha } : {}),
  };
}

/** Tips are reported only for branches retirement actually deleted. */
function withDestroyedBranchTips(destroyed: DestroyedArtifacts, tips: BranchTips): DestroyedArtifacts {
  return {
    ...destroyed,
    ...(destroyed.localBranch !== undefined && tips.localTipSha !== undefined ? { localTipSha: tips.localTipSha } : {}),
    ...(destroyed.remoteBranch !== undefined && tips.remoteTipSha !== undefined
      ? { remoteTipSha: tips.remoteTipSha }
      : {}),
  };
}

/** Refuses a rematerialization base that retirement would destroy (name collision) or that is not a commit. */
async function staleResetBaseRefusalReason(
  baseRef: string,
  branch: string,
  projectRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  const retiredForms = [branch, `refs/heads/${branch}`, `origin/${branch}`, `refs/remotes/origin/${branch}`];
  if (retiredForms.includes(baseRef)) {
    return `base '${baseRef}' names the branch '${branch}' being retired; retirement would destroy it before rematerialization`;
  }
  try {
    const resolved = await resolveRef(projectRoot, `${baseRef}^{commit}`, runner);
    if (resolved.status === "absent") {
      return `base '${baseRef}' does not resolve to a commit in ${projectRoot}`;
    }
  } catch {
    return `base '${baseRef}' does not resolve to a commit in ${projectRoot}`;
  }
  return undefined;
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

type OpenPrGateResult =
  | { status: "ok"; pr: OpenPr | undefined }
  | { status: "refused"; reason: string }
  | { status: "unknown"; reason: string };

/**
 * Refuse retirement when open-PR state is ambiguous or protects the branch:
 * multiple open PRs, or a single ready (non-draft) PR. gh probe failures are
 * inconclusive and return `unknown` rather than an empty list.
 */
export async function gateOnOpenPrs(
  branch: string,
  runner: AsyncSubprocessRunner,
  cwd = ".",
): Promise<OpenPrGateResult> {
  let openPrs: OpenPr[];
  try {
    openPrs = await listOpenPrsForBranch(branch, cwd, runner);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: "unknown", reason: `${OPEN_PR_PROBE_UNREACHABLE_REASON} (${detail})` };
  }
  if (openPrs.length > 1) return { status: "refused", reason: "multiple open PRs match branch" };
  const pr = openPrs.at(0);
  if (pr !== undefined && !pr.isDraft) return { status: "refused", reason: "matching PR is ready (non-draft)" };
  return { status: "ok", pr };
}

/**
 * `never-landed`: confirmed no open PR and no unlanded commit outside harness staging.
 * `landed`: an open PR or unlanded work protects the lane.
 * `inconclusive`: PR ownership or git state could not be determined; `reason` names the probe failure.
 */
export type NeverLandedLaneClassification =
  | { kind: "never-landed" }
  | { kind: "landed" }
  | { kind: "inconclusive"; reason: string };

/** Structural never-landed: no open PR and no unpushed commits whose paths leave harness workflow staging. A failed probe is inconclusive, never a confirmed absence. */
export async function classifyNeverLandedLane(
  projectRoot: string,
  branch: string,
  baseRef: string,
  runner: AsyncSubprocessRunner,
): Promise<NeverLandedLaneClassification> {
  try {
    const prGate = await gateOnOpenPrs(branch, runner, projectRoot);
    if (prGate.status === "unknown") return { kind: "inconclusive", reason: prGate.reason };
    if (prGate.status === "refused" || prGate.pr !== undefined) return { kind: "landed" };
    const commitCount = await unlandedCommitCount(projectRoot, branch, baseRef, runner);
    if (commitCount > 0) {
      const nonStagingPaths = await unlandedNonStagingPaths(projectRoot, branch, baseRef, runner);
      if (nonStagingPaths.length > 0) return { kind: "landed" };
    }
    return { kind: "never-landed" };
  } catch (error) {
    return {
      kind: "inconclusive",
      reason: `could not classify lane: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
  /** Tip of `localBranch` before deletion; set only when that branch was destroyed. */
  localTipSha?: string;
  /** Last-fetched tip of `remoteBranch` before deletion; set only when that branch was destroyed. */
  remoteTipSha?: string;
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
    await deleteRef(cwd, `refs/remotes/origin/${branch}`, runner);
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
  if ((await remoteUrl(cwd, "origin", runner)).status === "absent") {
    io.stdout(`No origin remote; remote branch ${branch} already absent\n`);
    return { ok: true };
  }

  try {
    const push = await pushBranch(cwd, { branch, delete: true }, runner);
    if (push.status === "pushed") {
      io.stdout(`Deleted remote branch: ${branch}\n`);
    } else {
      io.stdout(`Remote branch ${branch} already absent\n`);
    }
    return { ok: true };
  } catch (err) {
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
    await removeWorktree(cwd, worktreePath, runner, { force: true });
    io.stdout(`Removed worktree: ${worktreePath}\n`);
    destroyed.worktreePath = worktreePath;
  } catch (err) {
    io.stderr(`Failed to remove worktree: ${cleanupOperationErrorMessage(err)}\n`);
    return { ok: false, step: "worktree removal", destroyed };
  }

  try {
    await pruneWorktrees(cwd, runner);
  } catch {
    // Prune may fail but shouldn't block the operation
  }

  try {
    await deleteBranch(cwd, branch, runner, { force: true });
    io.stdout(`Deleted local branch: ${branch}\n`);
    destroyed.localBranch = branch;
  } catch (err) {
    io.stderr(`Failed to delete local branch ${branch}: ${cleanupOperationErrorMessage(err)}\n`);
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
      await closePr(runner, cwd, prNumber, networkSubprocessOptions());
      io.stdout(`Closed PR #${prNumber}\n`);
      destroyed.closedPrNumber = prNumber;
    } catch (err) {
      io.stderr(`Failed to close PR #${prNumber}: ${cleanupOperationErrorMessage(err)}\n`);
      return { ok: false, step: "PR closure", destroyed };
    }
  }

  return { ok: true, destroyed };
}

/**
 * Refusal reason when abandoning would destroy work no PR protects: commits on the branch not on base
 * (harness staging and squash-merged lanes exempt) or a worktree `HEAD` the branch cannot reach.
 * Fail-closed: a missing project root or a throwing git probe refuses.
 */
async function abandonUnlandedWorkRefusal(
  projectRoot: string | undefined,
  branch: string,
  worktreePath: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  if (projectRoot === undefined) return "project root unknown; cannot verify the branch carries no unlanded commits";
  const recovery = `hand-finish the branch, or re-run with --discard-unlanded to discard it`;
  try {
    const baseRef = await getBaseBranch(projectRoot, runner);
    const [tipSha, worktreeHead] = await Promise.all([
      resolveStaleResetRef(projectRoot, branch, runner),
      resolveStaleResetRef(worktreePath, "HEAD", runner),
    ]);
    const commitCount = await unlandedCommitCount(projectRoot, branch, baseRef, runner);
    if (commitCount > 0) {
      const nonStagingPaths = await unlandedNonStagingPaths(projectRoot, branch, baseRef, runner);
      if (nonStagingPaths.length > 0 && !(await carriesNoUnlandedCommits(branch, baseRef, projectRoot, runner))) {
        return staleResetUnlandedCommitsGateReason(tipSha, commitCount, false, recovery);
      }
    }
    if (!(await isDescendantOfBase(branch, worktreeHead, projectRoot, runner))) {
      return staleResetUnreachableWorktreeHeadGateReason(branch, worktreeHead, recovery);
    }
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `could not verify the branch carries no unlanded commits (${detail}); ${recovery}`;
  }
}

export async function runAbandonCommand(
  workspaceName: string,
  options: {
    dryRun?: boolean;
    discardUnlanded?: boolean;
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

  // PR-ownership gates: refuse ready PRs, ambiguous PR ownership, and inconclusive probes
  const prGate = await gateOnOpenPrs(branch, runner, projectRoot ?? ".");
  if (prGate.status !== "ok") {
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

  if (prNumber === undefined && options.discardUnlanded !== true) {
    const refusal = await abandonUnlandedWorkRefusal(projectRoot, branch, worktreePath, runner);
    if (refusal !== undefined) {
      io.stderr(`Error: Cannot abandon: ${refusal}\n`);
      return 1;
    }
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
