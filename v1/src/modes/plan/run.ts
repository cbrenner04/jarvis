import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentName } from "../../agents/types.ts";
import type { PlanCommandOptions, PlanIo } from "../../commands/plan.ts";
import { describePlanInvocation, isExistingFile, parsePlanArgs } from "../../commands/plan-args.ts";
import {
  CONFIG_DIR,
  effectiveGit,
  loadConfig,
  type ProjectMatch,
  resolvePlanFlags,
  resolveReviewAgentOrder,
  resolveReviewPasses,
} from "../../config.ts";
import type { LogClient } from "../../logging.ts";
import { enterMode } from "../../mode-entry.ts";
import { parseAgentFlagValues, prefixAgentFlagError } from "../../parse-agent-flag.ts";
import { ensureDraftPr, renderAttribution } from "../../pr.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { normalizeRepoUrl } from "../../repo-url.ts";
import { planSummary } from "../../run-summary.ts";
import { createPlanWorktree, createWorktreeSymlinks, ensureExistingBranchWorktree } from "../../worktree.ts";
import {
  appendBoundaryBlocker,
  assertPlanWriteBoundary,
  assertTargetRepoPlanBoundary,
  type BoundaryCheckResult,
  revertPaths,
} from "./boundary.ts";
import { commitPlanBlocker, commitPlanDraft } from "./commits.ts";
import { runDraftPhase, validateDraftOutput } from "./draft.ts";
import {
  assertRecoveryCheckpointSafe,
  findRecoveryTarget,
  hasQualifyingTimeout,
  validateRecoveryReconciliation,
} from "./recovery.ts";
import { stripNonContractIndexLines } from "./index-cleanup.ts";
import { repairPlanSpecMarkdown } from "./markdown-repair.ts";
import { createPlanTelemetryWriter, type PlanTelemetryWriter } from "./plan-telemetry.ts";
import { buildPlanPrHeader, maybeMarkPlanPrReady, type OpenPrInfo, updatePlanPrBody } from "./pr.ts";
import { type PlanReviewPhaseOptions, runPlanReviewPhase } from "./review.ts";
import {
  computeNoCommitSpecRoot,
  computeProjectSafeId,
  formatPlanSpecTimestamp,
  stripPlanSpecTimestampPrefix,
} from "./spec-paths.ts";

export const PLAN_USAGE = `Usage: jarvis1 plan [--review-passes <n>] [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] [--resume] <targetDir>/ready-intents/<name>.md
       jarvis1 plan --recover <relative-subspec> <targetDir>/<spec-dir>/index.md
                            Run plan mode (draft specs under spec/…); see docs/plan-mode.md.
`;

/** Best-effort harness log for plan setup diagnostics (mirrors patch-mode fanout style). */
function planHarnessLog(logClient: LogClient, text: string, tag: "harness" | "outbound" = "harness"): void {
  void logClient
    .send({
      namespace: "jarvis",
      text,
      tag,
    })
    .catch(() => {});
}

export function parseIntentFrontmatter(text: string): {
  name?: string | undefined;
} {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if ((lines[0] ?? "") !== "---") {
    return {};
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {};
  }
  for (let i = 1; i < end; i += 1) {
    const line = lines[i] ?? "";
    const match = /^name:\s*(.+)\s*$/.exec(line);
    if (match?.[1]) {
      return { name: match[1] };
    }
  }
  return {};
}

function hasPrerequisitesSection(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  return /^## Prerequisites\s*$/m.test(normalized);
}

export function validateReadyIntent(readyIntentPath: string):
  | {
      ok: true;
      name: string;
      content: string;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!isExistingFile(readyIntentPath)) {
    return {
      ok: false,
      message: `plan: ready-intent file not found: ${readyIntentPath}`,
    };
  }

  // Validate the file lives directly in a `ready-intents/` directory.
  const filename = basename(readyIntentPath);
  const nameWithoutExt = filename.replace(/\.md$/, "");
  const dir = dirname(readyIntentPath);

  if (basename(dir) !== "ready-intents") {
    return {
      ok: false,
      message: `plan: ready-intent must be located in <targetDir>/ready-intents/; got ${readyIntentPath}\nUse \`jarvis1 intent\` to author a ready-intent.`,
    };
  }

  let content: string;
  try {
    content = readFileSync(readyIntentPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `plan: could not read ready-intent: ${(err as Error).message}`,
    };
  }

  // Validate frontmatter
  const fm = parseIntentFrontmatter(content);
  if (!fm.name) {
    return {
      ok: false,
      message: `plan: ready-intent frontmatter missing required \`name:\` field`,
    };
  }

  if (fm.name !== nameWithoutExt) {
    return {
      ok: false,
      message: `plan: ready-intent \`name:\` frontmatter (${JSON.stringify(fm.name)}) does not match filename (${JSON.stringify(nameWithoutExt)})`,
    };
  }

  // Validate Prerequisites section
  if (!hasPrerequisitesSection(content)) {
    return {
      ok: false,
      message: `plan: ready-intent missing required \`## Prerequisites\` section`,
    };
  }

  return {
    ok: true,
    name: fm.name,
    content,
  };
}

function remoteSpecBranchExists(projectRoot: string, branchName: string): boolean {
  try {
    const output = execFileSync("git", ["ls-remote", "--heads", "origin", `plan/${branchName}`], {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function isDisposablePlanWorktree(args: {
  projectRoot: string;
  planName: string;
  targetDir: string;
  specTimestamp?: boolean;
}): boolean {
  const branchName = `plan/${args.planName}`;
  const _specTimestamp = args.specTimestamp ?? false;
  const worktreePath = join(args.projectRoot, ".worktree", `plan-${args.planName}`);

  // Check if local branch exists
  const localBranchExists = (() => {
    try {
      execFileSync("git", ["rev-parse", "--verify", branchName], {
        cwd: args.projectRoot,
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  })();

  // Check if local worktree exists
  const worktreeExists = existsSync(worktreePath);

  // Disposability requires at least some surviving state (branch or worktree)
  if (!localBranchExists && !worktreeExists) {
    return false; // No surviving state; non-disposable
  }

  // Check if origin has the branch (fail-closed: unreachable means non-disposable)
  const remoteExists = (() => {
    try {
      const output = execFileSync("git", ["ls-remote", "--heads", "origin", branchName], {
        cwd: args.projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      });
      return output.trim().length > 0;
    } catch {
      // Treat unknown/unreachable as non-disposable to preserve potentially-pushed work.
      // This is intentionally fail-closed: the collision helper uses fail-open semantics for performance.
      return true;
    }
  })();

  if (remoteExists) {
    return false;
  }

  // Check if local branch has commits beyond merge-base
  if (localBranchExists) {
    try {
      const mergeBase = execFileSync("git", ["merge-base", branchName, "HEAD"], {
        cwd: args.projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }).trim();
      const branchTip = execFileSync("git", ["rev-parse", branchName], {
        cwd: args.projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }).trim();
      if (mergeBase !== branchTip) {
        return false; // Has commits beyond merge-base
      }
    } catch {
      return false; // Error means non-disposable
    }
  }

  // Check if committed spec dir exists (match timestamped dirs via prefix stripping)
  const specRoot = join(args.projectRoot, args.targetDir);
  if (existsSync(specRoot)) {
    try {
      for (const entry of readdirSync(specRoot)) {
        // Always strip timestamp prefix when checking, consistent with collision check
        const stripped = stripPlanSpecTimestampPrefix(entry);
        if (stripped === args.planName) {
          return false; // Committed spec dir exists
        }
      }
    } catch {
      // Best effort; read failure means non-disposable to be safe
      return false;
    }
  }

  // All checks passed: disposable
  return true;
}

function _removeSpecDirIfPresent(worktreePath: string, specDirBasename: string, targetDir: string = "spec") {
  // Try both timestamped and unprefixed versions
  const specParentDir = join(worktreePath, targetDir);
  if (existsSync(specParentDir)) {
    try {
      for (const entry of readdirSync(specParentDir)) {
        const stripped = stripPlanSpecTimestampPrefix(entry);
        if (stripped === specDirBasename) {
          rmSync(join(specParentDir, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // Best effort
    }
  }
}

function externalSpecDirCollides(externalSpecRoot: string, planName: string, specTimestamp: boolean): boolean {
  if (!existsSync(externalSpecRoot)) {
    return false;
  }
  try {
    for (const entry of readdirSync(externalSpecRoot)) {
      if (specTimestamp) {
        if (stripPlanSpecTimestampPrefix(entry) === planName) {
          return true;
        }
      } else if (entry === planName) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function planNameCollides(
  projectRoot: string,
  planName: string,
  targetDir: string,
  externalSpecRoot: string | undefined,
  specTimestamp: boolean,
  checkCommittedPlanState: boolean,
): boolean {
  if (checkCommittedPlanState) {
    // Check for committed spec dir, matching timestamped dirs via prefix stripping
    const specRoot = join(projectRoot, targetDir);
    if (existsSync(specRoot)) {
      try {
        for (const entry of readdirSync(specRoot)) {
          const stripped = stripPlanSpecTimestampPrefix(entry);
          if (stripped === planName) {
            return true;
          }
        }
      } catch {
        // Read failure: conservatively assume no collision
      }
    }
    if (existsSync(join(projectRoot, ".worktree", `plan-${planName}`))) {
      return true;
    }
    if (remoteSpecBranchExists(projectRoot, planName)) {
      return true;
    }
  }
  if (externalSpecRoot !== undefined && externalSpecDirCollides(externalSpecRoot, planName, specTimestamp)) {
    return true;
  }
  return false;
}

function cleanupCommittedTempPlanState(
  projectRoot: string,
  tempPlanName: string,
  worktreePath: string | null,
  targetDir: string,
): void {
  if (worktreePath !== null && existsSync(worktreePath)) {
    _removeSpecDirIfPresent(worktreePath, tempPlanName, targetDir);
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch {
      // best effort
    }
  }
  try {
    execFileSync("git", ["branch", "-D", `plan/${tempPlanName}`], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    // best effort
  }
}

type ResumePrep = {
  planName: string;
  specDirBasename: string;
  worktreePath: string;
  nextResumeIndex: number;
  nextReviewIndex: number;
  recreatedFrom?: "local" | "origin";
  /**
   * For no-commit specs, the external spec root path where the spec lives.
   * When set, refine/draft/review operations read/write from here instead of worktreePath/spec/.
   */
  externalSpecRoot?: string;
};

class ResumePrepError extends Error {
  worktreePath?: string;
  recreatedFrom?: "local" | "origin";

  constructor(message: string, recreated?: { worktreePath: string; recreatedFrom: "local" | "origin" }) {
    super(message);
    this.name = "ResumePrepError";
    if (recreated !== undefined) {
      this.worktreePath = recreated.worktreePath;
      this.recreatedFrom = recreated.recreatedFrom;
    }
  }
}

const RESUME_SUBJECT_RE = /^plan: (refine|review \d+|blocker)(?: r(\d+))?$/;
const REVIEW_SUBJECT_RE = /^plan: review (\d+)(?: r\d+)?$/;

/**
 * Resolve a resume spec path into its components. The path points at the spec
 * file the user is told to pass — `index.md` for `--resume`, `intent.md` for
 * `--resume-draft` — so the spec directory is its parent, never the path's own
 * basename. (Reading the basename directly yields "intent.md"/"index.md" and
 * derives a bogus `plan-intent.md` worktree.)
 */
export function resolveResumeSpecPath(
  specPath: string,
  mode: "resume" | "resume-draft",
): {
  planName: string;
  specDirBasename: string;
  specDirPath: string;
  externalSpecRoot: string;
} {
  const resolved = resolve(specPath);
  const expectedFile = mode === "resume" ? "index.md" : "intent.md";
  if (basename(resolved) !== expectedFile) {
    const flag = mode === "resume" ? "--resume" : "--resume-draft";
    throw new Error(`${flag} requires a ${expectedFile} path; got ${specPath}`);
  }
  const specDirPath = dirname(resolved);
  const specDirBasename = basename(specDirPath);
  return {
    planName: stripPlanSpecTimestampPrefix(specDirBasename),
    specDirBasename,
    specDirPath,
    externalSpecRoot: dirname(specDirPath),
  };
}

function isWorktreeClean(cwd: string): boolean {
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
  return porcelain.length === 0;
}

function currentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
}

function computeResumeCounters(worktreePath: string): {
  nextResumeIndex: number;
  nextReviewIndex: number;
} {
  const subjects = execFileSync("git", ["log", "--format=%s"], {
    cwd: worktreePath,
    stdio: "pipe",
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let maxResume = 0;
  let maxReview = 0;
  for (const subject of subjects) {
    const resumeMatch = RESUME_SUBJECT_RE.exec(subject);
    if (resumeMatch?.[2] !== undefined) {
      const n = Number(resumeMatch[2]);
      if (Number.isFinite(n) && n > maxResume) {
        maxResume = n;
      }
    }
    const reviewMatch = REVIEW_SUBJECT_RE.exec(subject);
    if (reviewMatch?.[1] !== undefined) {
      const n = Number(reviewMatch[1]);
      if (Number.isFinite(n) && n > maxReview) {
        maxReview = n;
      }
    }
  }
  return {
    nextResumeIndex: maxResume + 1,
    nextReviewIndex: maxReview + 1,
  };
}

function prepareResume(args: {
  cfg: ReturnType<typeof loadConfig>;
  project: ProjectMatch;
  specPath: string;
  mode: "resume" | "resume-draft";
}): ResumePrep {
  const gitEnabled = effectiveGit(args.cfg, args.project.key);
  const { commit: configuredCommit, targetDir } = resolvePlanFlags(args.cfg, args.cfg.projects[args.project.key]);
  const commit = gitEnabled ? configuredCommit : false;

  // For no-commit specs, the spec path is already external; for commit specs, it's in the worktree
  const isNoCommit = !commit;

  // The spec path points at the spec file (intent.md / index.md); its parent
  // is the spec directory and the grandparent is the external spec root.
  const { planName, specDirBasename, externalSpecRoot } = resolveResumeSpecPath(args.specPath, args.mode);
  const specDir = specDirBasename;

  if (isNoCommit) {
    // For no-commit specs, specs live under ~/.jarvis/specs/<projectId>/<specDirBasename>/
    return {
      planName,
      specDirBasename: specDir,
      worktreePath: args.project.root,
      externalSpecRoot,
      nextResumeIndex: 0,
      nextReviewIndex: 0,
    };
  }

  // For commit: true, use the original logic
  const projectRoot = args.project.root;
  const worktreePath = join(projectRoot, ".worktree", `plan-${planName}`);
  let recreatedFrom: "local" | "origin" | undefined;
  if (!existsSync(worktreePath)) {
    try {
      const recreated = ensureExistingBranchWorktree({
        projectRoot,
        worktreeName: `plan-${planName}`,
        branchName: `plan/${planName}`,
        missingBranchMessage: `plan worktree missing at ${worktreePath}`,
      });
      recreatedFrom = recreated.source;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }
  const branch = `plan/${planName}`;
  const recreated = recreatedFrom !== undefined ? { worktreePath, recreatedFrom } : undefined;
  if (currentBranch(worktreePath) !== branch) {
    throw new ResumePrepError(`${worktreePath} is not checked out on ${branch}`, recreated);
  }
  if (!existsSync(join(worktreePath, targetDir, specDir, "intent.md"))) {
    throw new ResumePrepError(`missing ${targetDir}/${specDir}/intent.md in ${worktreePath}`, recreated);
  }
  if (args.mode === "resume" && !existsSync(join(worktreePath, targetDir, specDir, "index.md"))) {
    throw new ResumePrepError(`missing ${targetDir}/${specDir}/index.md in ${worktreePath}`, recreated);
  }
  if (!isWorktreeClean(worktreePath)) {
    throw new ResumePrepError(
      `the worktree is not clean; inspect with \`jarvis1 triage plan-${planName}\` and re-run`,
      recreated,
    );
  }
  if (!remoteSpecBranchExists(projectRoot, planName)) {
    throw new ResumePrepError(`plan branch plan/${planName} is not on origin; cannot resume`, recreated);
  }
  const counters = computeResumeCounters(worktreePath);
  return {
    planName,
    specDirBasename: specDir,
    worktreePath,
    nextResumeIndex: counters.nextResumeIndex,
    nextReviewIndex: counters.nextReviewIndex,
    ...(recreatedFrom !== undefined ? { recreatedFrom } : {}),
  };
}

function emitNoCommitPlanNextSteps(io: PlanIo, indexPath: string): void {
  io.stdout(`Spec written to ${indexPath}\nRun with: jarvis1 run ${indexPath}\n`);
}

async function ensureUniquePlanName(
  projectRoot: string,
  baseName: string,
  targetDir: string = "spec",
  opts?: { externalSpecRoot?: string; specTimestamp?: boolean; checkCommittedPlanState?: boolean },
): Promise<string> {
  const externalSpecRoot = opts?.externalSpecRoot;
  const specTimestamp = opts?.specTimestamp ?? false;
  const checkCommittedPlanState = opts?.checkCommittedPlanState ?? true;
  let finalName = baseName;
  if (!planNameCollides(projectRoot, finalName, targetDir, externalSpecRoot, specTimestamp, checkCommittedPlanState)) {
    return finalName;
  }
  let suffix = 2;
  while (true) {
    finalName = `${baseName}-${suffix}`;
    if (
      !planNameCollides(projectRoot, finalName, targetDir, externalSpecRoot, specTimestamp, checkCommittedPlanState)
    ) {
      return finalName;
    }
    suffix += 1;
  }
}

/**
 * Return true when `child` stays within `parent`.
 */
export function isPathInside(
  parent: string,
  child: string,
  pathApi: {
    relative: typeof relative;
    isAbsolute: typeof isAbsolute;
    sep: string;
  } = { relative, isAbsolute, sep },
): boolean {
  const rel = pathApi.relative(parent, child);
  return rel === "" || (!pathApi.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${pathApi.sep}`));
}

/**
 * Delete the source ready-intent from the worktree if it exists and resolves within it.
 * Returns true if a file was deleted, false if deletion was skipped.
 */
export function deleteReadyIntentFromWorktree(args: {
  readyIntentPath: string;
  projectRoot: string;
  worktreePath: string;
}): boolean {
  const worktreePath = resolve(args.worktreePath);
  const canonicalWorktreePath = (() => {
    try {
      return realpathSync(worktreePath);
    } catch {
      return worktreePath;
    }
  })();
  const targetPath = resolve(worktreePath, relative(resolve(args.projectRoot), resolve(args.readyIntentPath)));
  if (!isPathInside(worktreePath, targetPath)) {
    return false;
  }
  if (!existsSync(targetPath)) {
    return false;
  }
  let resolvedTargetPath: string;
  try {
    resolvedTargetPath = realpathSync(targetPath);
  } catch {
    return false;
  }
  if (!isPathInside(canonicalWorktreePath, resolvedTargetPath)) {
    return false;
  }
  try {
    unlinkSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function planCommand(opts: PlanCommandOptions): Promise<number> {
  const args = opts.args ?? [];
  if (args.includes("--help") || args.includes("-h")) {
    opts.io.stdout(PLAN_USAGE);
    return 0;
  }

  let interrupted = false;

  // Set up SIGINT handler
  const onSigint = () => {
    interrupted = true;
    process.removeListener("SIGINT", onSigint);
  };
  process.once("SIGINT", onSigint);
  try {
    const processCwd = opts.cwd ?? process.cwd();
    const result = parsePlanArgs(args, processCwd);
    if (!result.ok) {
      opts.io.stderr(`${result.message}\n`);
      if (result.message.includes("missing required ready-intent")) {
        opts.io.stdout(PLAN_USAGE);
      }
      return result.exitCode;
    }

    const inv = result.invocation;
    const candidatePath = inv.readyIntentPath;
    const rawCfg = loadConfig(opts.config);
    let agentOrderOverride = opts.agentOrderOverride;
    if (inv.agentFlags !== undefined && inv.agentFlags.length > 0) {
      const parsedAgents = parseAgentFlagValues(inv.agentFlags, rawCfg.modes.plan.agentOrder);
      if (!parsedAgents.ok) {
        opts.io.stderr(`${prefixAgentFlagError("plan", parsedAgents.message)}\n`);
        return 1;
      }
      agentOrderOverride = parsedAgents.agentOrder;
    }
    const reviewAgentOrder = resolveReviewAgentOrder(rawCfg);
    const planCfg =
      agentOrderOverride === undefined
        ? rawCfg
        : {
            ...rawCfg,
            modes: {
              ...rawCfg.modes,
              plan: { ...rawCfg.modes.plan, agentOrder: agentOrderOverride },
            },
          };
    // Agent used to author the model-written PR narrative (Description +
    // Decisions). Resolved from the head of the plan agent order; generation
    // degrades gracefully to no narrative if it fails or is unavailable.
    const prAgentEntry = planCfg.modes.plan.agentOrder[0];
    const resolveAgent: (agentName: AgentName, model: string | undefined) => Agent =
      opts.createAgent ?? ((agentName, model) => defaultCreateAgent(agentName, model ?? ""));
    const prDescAgent = prAgentEntry ? resolveAgent(prAgentEntry.agent, prAgentEntry.model) : undefined;
    const entryOpts: Parameters<typeof enterMode>[0] = {
      candidatePath,
      io: { stderr: opts.io.stderr },
      logServerUrl: rawCfg.logServerUrl,
    };
    if (inv.repo !== undefined) {
      entryOpts.repoFlag = inv.repo;
    }
    if (opts.config !== undefined) {
      entryOpts.config = opts.config;
    }
    if (opts.logClient !== undefined) {
      entryOpts.logClient = opts.logClient;
    }
    const entry = await enterMode(entryOpts);
    if (entry.kind === "error") {
      opts.io.stderr(`${entry.message}\n`);
      return 1;
    }
    if (entry.kind === "ambiguous") {
      const names = entry.candidates.map((c) => `  - ${c.key}`).join("\n");
      opts.io.stderr(`${entry.reason}\nMatching projects:\n${names}\nPass --repo <name> to disambiguate.\n`);
      return 1;
    }
    if (entry.kind === "needs-prompt") {
      opts.io.stderr(
        "could not determine a target project for this intent and no projects are registered. Run `jarvis1 init` in a target repo, or pass --repo <name|url>.\n",
      );
      return 1;
    }
    if (entry.kind === "log-error") {
      return entry.exitCode;
    }

    const planLogClient = entry.logClient;
    const logOutboundPrompt = (prompt: string): void => planHarnessLog(planLogClient, prompt, "outbound");
    planHarnessLog(planLogClient, describePlanInvocation(inv));
    const project = entry.resolution.resolved.project;
    planHarnessLog(planLogClient, `plan: target project=${project.key} root=${project.root}`);

    const fullProject = rawCfg.projects[project.key];
    const gitEnabled = effectiveGit(rawCfg, project.key);
    const {
      specTimestamp,
      commit: configuredCommit,
      targetDir: resolvedTargetDir,
    } = resolvePlanFlags(rawCfg, fullProject);
    const commit = gitEnabled ? configuredCommit : false;
    const targetDir = inv.targetDir ?? resolvedTargetDir;
    planHarnessLog(
      planLogClient,
      `plan: resolved flags specTimestamp=${specTimestamp} commit=${commit} targetDir=${targetDir} gitEnabled=${gitEnabled}`,
    );

    if (inv.recover !== undefined) {
      if (!commit) {
        opts.io.stderr("recovery: requires committed plan mode\n");
        return 1;
      }
      let target;
      try {
        target = findRecoveryTarget(candidatePath, inv.recover);
        const specDirBasename = basename(dirname(candidatePath));
        assertRecoveryCheckpointSafe(project.root, specDirBasename);
        if (!hasQualifyingTimeout(rawCfg.telemetryPath ?? "", project.root, target.subspecPath)) {
          throw new Error("recovery: no qualifying terminal iteration-timeout for selected subspec");
        }
      } catch (err) {
        opts.io.stderr(`${(err as Error).message}\n`);
        return 1;
      }

      const specDirBasename = basename(dirname(candidatePath));
      const recoveryName = await ensureUniquePlanName(
        project.root,
        `recover-${stripPlanSpecTimestampPrefix(specDirBasename)}-${basename(target.subspecPath, ".md")}`,
        targetDir,
      );
      let recoveryWorktree: string;
      try {
        recoveryWorktree = await createPlanWorktree({ projectRoot: project.root, name: recoveryName });
        createWorktreeSymlinks(project.root, recoveryWorktree, rawCfg.worktreeSymlinks);
      } catch (err) {
        opts.io.stderr(`recovery: could not create plan worktree: ${(err as Error).message}\n`);
        return 1;
      }
      const recoverySpecDir = join(recoveryWorktree, targetDir, specDirBasename);
      const recoveryIndex = join(recoverySpecDir, "index.md");
      const originalIntent = readFileSync(join(recoverySpecDir, "intent.md"), "utf8");
      const oldSubspecBasename = basename(target.subspecPath);
      const recoveryIntent = `${originalIntent}\n\n## Recovery\n\nReplace \`${oldSubspecBasename}\` with two or more independently testable numbered sibling subspecs. Preserve completed neighbors and unchecked index order. Delete the old file and rewrite each unambiguous relative Markdown link to it. Do not change intent.md.\n`;
      try {
        const drafted = await runDraftPhase({
          onOutboundPrompt: logOutboundPrompt,
          worktreePath: recoveryWorktree,
          name: specDirBasename,
          config: planCfg,
          intentBefore: recoveryIntent,
          stderr: opts.io.stderr,
          targetDir,
          createAgent: resolveAgent,
          planWorktreeDir: recoveryWorktree,
          idleOutputTimeoutMs: rawCfg.idleOutputTimeoutMs,
        });
        if (drafted.result.kind !== "ok") throw new Error("recovery: drafting replacements failed");
        writeFileSync(join(recoverySpecDir, "intent.md"), originalIntent, "utf8");
        const validation = validateDraftOutput(recoveryWorktree, specDirBasename, originalIntent, recoverySpecDir);
        if (!validation.valid) throw new Error(`recovery: spec validation failed: ${validation.error}`);
        const replacements = validateRecoveryReconciliation({
          specDir: recoverySpecDir,
          oldSubspecBasename,
          indexPath: recoveryIndex,
        });
        commitPlanDraft({
          worktreePath: recoveryWorktree,
          specDirBasename,
          agentLabel: drafted.agentLabel ?? "unknown",
          subspecCount: replacements,
          subjectSuffix: "recovery",
          targetDir,
        });
        const branch = `plan/${recoveryName}`;
        await ensureDraftPr({
          branch,
          base: getCurrentBranch(project.root),
          title: `plan: recover ${specDirBasename}`,
          bodyGenerator: async () => buildPlanPrHeader({ name: recoveryName, specDirBasename, worktreePath: recoveryWorktree, targetDir }),
          footer: renderAttribution({ cwd: recoveryWorktree, base: getCurrentBranch(project.root) }),
          cwd: recoveryWorktree,
        });
        opts.io.stdout(`${getPrUrl(recoveryWorktree, branch)}\n`);
        return 0;
      } catch (err) {
        opts.io.stderr(`${(err as Error).message}\n`);
        cleanupCommittedTempPlanState(project.root, recoveryName, recoveryWorktree, targetDir);
        return 1;
      }
    }

    if (inv.resume || inv.resumeDraft) {
      if (inv.resumeDraft) {
        opts.io.stderr(
          `plan: --resume-draft is no longer supported. Use \`jarvis1 plan <ready-intent>\` for fresh work or \`jarvis1 plan --resume <index.md>\` for post-draft review.\n`,
        );
        return 1;
      }
      const reviewPasses = resolveReviewPasses(rawCfg, inv.reviewPasses);
      if (reviewPasses === 0) {
        opts.io.stderr(`--resume requires at least one review pass\n`);
        return 1;
      }

      let resume: ResumePrep;
      try {
        resume = prepareResume({
          cfg: rawCfg,
          project,
          specPath: inv.readyIntentPath,
          mode: "resume",
        });
      } catch (err) {
        if (err instanceof ResumePrepError && err.recreatedFrom !== undefined && err.worktreePath !== undefined) {
          opts.io.stderr(`plan: recreated worktree at ${err.worktreePath} from ${err.recreatedFrom}\n`);
        }
        opts.io.stderr(`${(err as Error).message}\n`);
        return 1;
      }

      const branch = `plan/${resume.planName}`;
      const suffix = `r${resume.nextResumeIndex}`;
      const nextReviewIndex = resume.nextReviewIndex;
      opts.io.stderr(`plan: resume ${suffix} started\n`);
      if (resume.recreatedFrom !== undefined) {
        opts.io.stderr(`plan: recreated worktree at ${resume.worktreePath} from ${resume.recreatedFrom}\n`);
      }

      const resumeTargetDir = targetDir;
      const resumePlanStartedAt = new Date();
      const resumePlanStartedMs = Date.now();
      const resumeTelemetryPath = rawCfg.telemetryPath ?? null;
      const resumePlanNs = `plan:${project.key}:${resume.specDirBasename}`;
      const resumePlanTelemetry = createPlanTelemetryWriter({
        telemetryPath: resumeTelemetryPath,
        namespace: resumePlanNs,
      });
      const summarizeResume = (exitReason: string): void => {
        emitPlanUsageSummaryIfNeeded({
          io: opts.io,
          telemetryPath: resumeTelemetryPath,
          namespace: resumePlanNs,
          startedAt: resumePlanStartedAt,
          startedMs: resumePlanStartedMs,
          exitReason,
          specPathForSummary: `${resumeTargetDir}/${resume.specDirBasename}/index.md`,
          writer: resumePlanTelemetry,
        });
      };

      const resumeSpecPath = resume.externalSpecRoot
        ? join(resume.externalSpecRoot, resume.specDirBasename)
        : join(resume.worktreePath, resumeTargetDir, resume.specDirBasename);

      if (reviewPasses > 0) {
        const reviewResult = await runPlanReviewPhase({
          onOutboundPrompt: logOutboundPrompt,
          worktreePath: resume.worktreePath,
          name: resume.specDirBasename,
          specDirBasename: resume.specDirBasename,
          ...(resume.externalSpecRoot ? { specDirPath: resumeSpecPath } : {}),
          config: planCfg,
          reviewAgentOrder,
          ...(inv.reviewPasses !== undefined ? { reviewPassesOverride: inv.reviewPasses } : {}),
          startPassNumber: nextReviewIndex,
          subjectSuffix: suffix,
          stderr: opts.io.stderr,
          planTelemetry: resumePlanTelemetry,
          targetDir: resumeTargetDir,
          commit,
          gitEnabled,
          checkBoundary: false,
          logNoChangeSkip: false,
          createAgent: resolveAgent,
          planWorktreeDir: resume.worktreePath,
          idleOutputTimeoutMs: rawCfg.idleOutputTimeoutMs,
          ...(commit
            ? {
                updatePrBody: async () => {
                  await safeUpdatePrBody({
                    agent: prDescAgent,
                    timeoutMs: rawCfg.iterationTimeoutMs,
                    io: opts.io,
                    branch,
                    base: getCurrentBranch(project.root),
                    worktreePath: resume.worktreePath,
                    name: resume.planName,
                    specDirBasename: resume.specDirBasename,
                    prNarrative: planCfg.modes.plan.prNarrative ?? "template",
                    targetDir: resumeTargetDir,
                  });
                },
              }
            : {}),
          isInterrupted: () => interrupted,
          onPassStart: (pass, total) => {
            opts.io.stderr(`plan: review pass ${pass}/${total} starting\n`);
          },
        });
        if (reviewResult.interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizeResume("sigint");
          return 130;
        }
        if (reviewResult.exitCode === 2) {
          summarizeResume("quota-exhausted");
          return 2;
        }
        if (reviewResult.exitCode === 3) {
          summarizeResume("model-config");
          return 3;
        }
        if (reviewResult.exitCode !== 0) {
          if (reviewResult.blocker !== undefined) {
            opts.io.stderr(`\n## Blocker\n\n${reviewResult.blocker}\n`);
            summarizeResume("blocker");
          } else {
            summarizeResume(reviewResult.exitCode === 1 ? "agent-error" : "error");
          }
          return reviewResult.exitCode;
        }
      }

      if (commit) {
        let prUrl: string | null = null;
        try {
          prUrl = getPrUrl(resume.worktreePath, branch);
        } catch {
          // best-effort; completion still succeeds without a URL
        }
        if (prUrl !== null) {
          opts.io.stdout(
            renderPlanNextSteps({
              prUrl,
              planName: resume.planName,
              specDirBasename: resume.specDirBasename,
              targetDir: resumeTargetDir,
            }),
          );
        }
        const planFixCommand = rawCfg.projects[project.key]?.fixCommand;
        safeMarkPlanPrReady({
          io: opts.io,
          branch,
          worktreePath: resume.worktreePath,
          specDirPath: resumeSpecPath,
          commit: true,
          timeoutMs: rawCfg.iterationTimeoutMs,
          ...(planFixCommand !== undefined ? { fixCommand: planFixCommand } : {}),
        });
      } else {
        const indexPath = join(resume.externalSpecRoot ?? resume.worktreePath, resume.specDirBasename, "index.md");
        emitNoCommitPlanNextSteps(opts.io, indexPath);
      }
      summarizeResume("complete");
      return 0;
    }

    // Validate ready-intent BEFORE creating any artifacts
    const readyIntentValidation = validateReadyIntent(inv.readyIntentPath);
    if (!readyIntentValidation.ok) {
      opts.io.stderr(`${readyIntentValidation.message}\n`);
      return 1;
    }

    const readyIntentName = readyIntentValidation.name;
    const readyIntentContent = readyIntentValidation.content;
    planHarnessLog(planLogClient, `plan: ready-intent name=${readyIntentName}`);

    const jarvisConfigDir = opts.config?.dir ?? CONFIG_DIR;

    // For no-commit runs, create the external spec root directory early
    let externalSpecRoot: string | undefined;
    if (commit === false) {
      externalSpecRoot = join(jarvisConfigDir, "specs", computeProjectSafeId(project));
      mkdirSync(externalSpecRoot, { recursive: true });
    }

    // For commit: true fresh runs, check if a disposable same-name worktree survives
    let disposablePlanName: string | undefined;
    if (commit) {
      if (
        isDisposablePlanWorktree({
          projectRoot: project.root,
          planName: readyIntentName,
          targetDir,
          specTimestamp,
        })
      ) {
        disposablePlanName = readyIntentName;
        // Will tear down and reuse this name below
      }
    }

    // Check for collision and determine final plan name
    const planName =
      disposablePlanName ??
      (await ensureUniquePlanName(project.root, readyIntentName, targetDir, {
        ...(externalSpecRoot !== undefined ? { externalSpecRoot } : {}),
        specTimestamp,
        checkCommittedPlanState: commit && disposablePlanName === undefined,
      }));
    const specDirBasename = specTimestamp ? `${formatPlanSpecTimestamp()}-${planName}` : planName;
    planHarnessLog(planLogClient, `plan: spec name=${planName}`);

    // If a disposable worktree survives, tear it down before creating fresh
    if (disposablePlanName) {
      cleanupCommittedTempPlanState(
        project.root,
        disposablePlanName,
        join(project.root, ".worktree", `plan-${disposablePlanName}`),
        targetDir,
      );
      planHarnessLog(planLogClient, `plan: disposed stale worktree plan-${disposablePlanName}`);
    }

    // Create worktree for fresh mode (only if it's a git repo and gh is available).
    // For commit: false, use the main checkout as worktreePath.
    const isGitRepo = existsSync(join(project.root, ".git"));
    let worktreePath: string | null = null;
    const planBranch = `plan/${planName}`;

    // Enter the main plan flow if: commit is false (using project root directly),
    // or if commit is true and we can create a worktree
    if (commit === false || (!opts.skipGhCheck && isGitRepo)) {
      // For commit: false, use project root directly; otherwise create a worktree
      if (commit === false) {
        worktreePath = project.root;
      } else if (!opts.skipGhCheck && isGitRepo) {
        try {
          worktreePath = await createPlanWorktree({
            projectRoot: project.root,
            name: planName,
          });
          createWorktreeSymlinks(project.root, worktreePath, rawCfg.worktreeSymlinks);
          planHarnessLog(planLogClient, `plan: worktree created at ${worktreePath}`);
        } catch (err) {
          const message = (err as Error).message;
          // Handle local-only branch collision with a specific error message
          if (message.includes("already exists") && message.includes(".worktree")) {
            opts.io.stderr(
              `plan: local branch ${planBranch} already exists; delete it with \`git branch -D ${planBranch}\` and re-run\n`,
            );
          } else {
            opts.io.stderr(`failed to create plan worktree: ${message}\n`);
          }
          return 1;
        }
      }

      // At this point, worktreePath is guaranteed to be non-null
      if (worktreePath === null) {
        opts.io.stderr("internal error: worktreePath is null\n");
        return 1;
      }

      // Determine base branch for PR operations
      // Only needed when commit: true; gate to avoid calling getCurrentBranch on non-git roots
      let baseBranch: string | null = null;
      if (commit) {
        baseBranch = getCurrentBranch(project.root);
      }

      const removeAbandonedPreIntentSpecDir = (): void => {
        if (commit === false && externalSpecRoot) {
          const finalSpecPath = join(externalSpecRoot, specDirBasename);
          if (existsSync(finalSpecPath)) {
            rmSync(finalSpecPath, { recursive: true, force: true });
          }
        }
      };

      // Create spec directory and write ready-intent to intent.md (byte-for-byte copy)
      const finalSpecPath = externalSpecRoot
        ? join(externalSpecRoot, specDirBasename)
        : join(worktreePath, targetDir, specDirBasename);
      const intentPath = join(finalSpecPath, "intent.md");

      try {
        mkdirSync(finalSpecPath, { recursive: true });
        writeFileSync(intentPath, readyIntentContent, "utf8");
      } catch (err) {
        opts.io.stderr(`failed to write intent file: ${(err as Error).message}\n`);
        removeAbandonedPreIntentSpecDir();
        if (commit) {
          cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
        }
        return 1;
      }

      // For no-commit runs, print the external intent.md path early so it is not lost if a later phase fails
      if (commit === false) {
        opts.io.stdout(`Intent: ${intentPath}\n`);
      }

      const planStartedAt = new Date();
      const planStartedMs = Date.now();
      const planTelemetryPath = rawCfg.telemetryPath ?? null;
      const planNsBase = `plan:${project.key}:${planName}`;
      const planTelemetryWriter = createPlanTelemetryWriter({
        telemetryPath: planTelemetryPath,
        namespace: planNsBase,
      });
      const summarizePlan = (exitReason: string, summarySpecName: string): void => {
        emitPlanUsageSummaryIfNeeded({
          io: opts.io,
          telemetryPath: planTelemetryPath,
          namespace: planNsBase,
          startedAt: planStartedAt,
          startedMs: planStartedMs,
          exitReason,
          specPathForSummary: `${targetDir}/${summarySpecName}/index.md`,
          writer: planTelemetryWriter,
        });
      };

      if (commit === false) {
        injectRepoLineIntoIndex(finalSpecPath, project);
      }

      if (interrupted) {
        opts.io.stderr(`plan: interrupted\n`);
        emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
        summarizePlan("sigint", specDirBasename);
        return 130;
      }

      // Run draft phase: invoke agent to generate spec tree
      let draftResult: Awaited<ReturnType<typeof runDraftPhase>>;
      let draftBlocker: string | undefined;
      let draftSpecFilesCount = 0;
      try {
        // Read intent.md before the draft phase
        const intentPath = join(finalSpecPath, "intent.md");
        const intentBefore = readFileSync(intentPath, "utf8");

        draftResult = await runDraftPhase({
          onOutboundPrompt: logOutboundPrompt,
          worktreePath,
          name: specDirBasename,
          ...(commit ? {} : { specDirPath: finalSpecPath, additionalReadDirs: [finalSpecPath] }),
          config: planCfg,
          intentBefore,
          stderr: opts.io.stderr,
          planTelemetry: planTelemetryWriter,
          targetDir,
          createAgent: resolveAgent,
          planWorktreeDir: worktreePath,
          idleOutputTimeoutMs: rawCfg.idleOutputTimeoutMs,
        });

        // Check if draft succeeded
        if (draftResult.result.kind !== "ok") {
          if (draftResult.result.kind === "quota") {
            opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
            emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
            summarizePlan("quota-exhausted", specDirBasename);
            if (commit) {
              cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
            }
            return 2;
          }
          if (draftResult.result.kind === "model_config") {
            opts.io.stderr(`plan: model configuration error\n${draftResult.result.stderr}`);
            emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
            summarizePlan("model-config", specDirBasename);
            if (commit) {
              cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
            }
            return 3;
          }
          // Generic error
          opts.io.stderr(`plan: draft phase failed\n${draftResult.result.stderr}`);
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("agent-error", specDirBasename);
          if (commit) {
            cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
          }
          return 1;
        }

        // Check for interrupt before any commit
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("sigint", specDirBasename);
          return 130;
        }

        // Validate output
        const validation = validateDraftOutput(worktreePath, specDirBasename, intentBefore, finalSpecPath);
        if (!validation.valid) {
          opts.io.stderr(`plan: draft validation failed: ${validation.error}\n`);
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("error", specDirBasename);
          if (commit) {
            cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
          }
          return 1;
        }

        // Surface structural AC warnings
        for (const warning of validation.warnings) {
          opts.io.stderr(`plan: warning: ${warning}\n`);
        }

        // Check if a blocker was raised
        if (validation.blocker !== undefined) {
          draftBlocker = validation.blocker;
        }

        draftSpecFilesCount = draftResult.subspecCount ?? 0;
        if (draftBlocker === undefined && draftResult.subspecCount === null) {
          opts.io.stderr(`plan: could not count subspecs\n`);
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("error", specDirBasename);
          if (commit) {
            cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
          }
          return 1;
        }

        // Strip non-contract lines from index.md before injection
        stripNonContractIndexLines({
          specDirPath: finalSpecPath,
          stderr: opts.io.stderr,
        });

        opts.io.stderr(`plan: draft phase completed\n`);
        if (commit === false) {
          injectRepoLineIntoIndex(finalSpecPath, project);
        }
      } catch (err) {
        opts.io.stderr(`plan: draft phase error: ${(err as Error).message}\n`);
        emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
        summarizePlan("error", specDirBasename);
        if (commit) {
          cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
        }
        return 1;
      }

      // Check boundary before draft commit
      const boundaryCheck: BoundaryCheckResult = commit
        ? assertPlanWriteBoundary(worktreePath, specDirBasename, targetDir)
        : gitEnabled
          ? assertTargetRepoPlanBoundary(project.root)
          : { ok: true };

      if (!boundaryCheck.ok) {
        opts.io.stderr(`plan: boundary violation detected before draft commit\n`);
        const offendingPaths = boundaryCheck.ok ? [] : boundaryCheck.offendingPaths;
        if (commit) {
          revertPaths(worktreePath, offendingPaths);
        }
        appendBoundaryBlocker(finalSpecPath, specDirBasename, offendingPaths, targetDir);
        for (const path of offendingPaths) {
          opts.io.stderr(`  - ${path}\n`);
        }

        if (commit) {
          try {
            const agentLabel = draftResult.agentLabel ?? "unknown";
            commitPlanBlocker({
              worktreePath: worktreePath as string,
              specDirBasename,
              agentLabel,
              reason: "write boundary violation",
              specFilesCount: draftSpecFilesCount,
              targetDir,
            });
            opts.io.stderr(`plan: blocker commit pushed\n`);

            await safeUpdatePrBody({
              agent: prDescAgent,
              timeoutMs: rawCfg.iterationTimeoutMs,
              io: opts.io,
              branch: planBranch,
              base: baseBranch as string,
              worktreePath: worktreePath as string,
              name: planName,
              specDirBasename,
              prNarrative: planCfg.modes.plan.prNarrative ?? "template",
              targetDir,
            });
          } catch (err) {
            opts.io.stderr(`${(err as Error).message}\n`);
            summarizePlan("error", specDirBasename);
            cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
            return 1;
          }
        }

        opts.io.stderr(`plan: blocked\n`);
        emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Always create a `plan: draft` commit for whatever the agent produced (when commit: true)
      // (per docs/plan-mode.md: draft files are committed as `plan: draft`,
      // even when a blocker is raised in the same pass). Then, if a blocker
      // was raised, append a separate `plan: blocker` commit and stop.
      if (commit) {
        try {
          const agentLabel = draftResult.agentLabel ?? "unknown";

          // Delete the source ready-intent from the worktree before the draft commit,
          // so the deletion is staged and lands in the plan: draft commit.
          deleteReadyIntentFromWorktree({
            readyIntentPath: candidatePath,
            projectRoot: project.root,
            worktreePath: worktreePath as string,
          });

          commitPlanDraft({
            worktreePath: worktreePath as string,
            specDirBasename,
            agentLabel,
            subspecCount: draftSpecFilesCount,
            targetDir,
          });
          opts.io.stderr(`plan: draft commit pushed\n`);
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizePlan("error", specDirBasename);
          cleanupCommittedTempPlanState(project.root, planName, worktreePath, targetDir);
          return 1;
        }

        // Open the draft PR now that the first `plan: draft` commit is on the
        // remote. Subsequent commits update the body via `updatePrBody`.
        try {
          const prResult = await ensureDraftPr({
            branch: planBranch,
            base: baseBranch as string,
            title: `plan: ${planName}`,
            bodyGenerator: async () =>
              buildPlanPrHeader({
                name: planName,
                specDirBasename,
                worktreePath: worktreePath as string,
                targetDir,
              }),
            footer: renderAttribution({
              cwd: worktreePath as string,
              base: baseBranch as string,
            }),
            cwd: worktreePath as string,
          });
          const prUrl = getPrUrl(worktreePath as string, planBranch);
          opts.io.stdout(`${prUrl}\n`);
          opts.io.stderr(`plan: draft PR #${prResult.number} opened\n`);
        } catch (err) {
          opts.io.stderr(`warning: could not open draft PR: ${(err as Error).message}\n`);
          // Continue; downstream commits still push, and the PR can be opened
          // manually if needed.
        }
      }

      // If a blocker was raised during the draft phase, commit it on top of
      // `plan: draft` and stop.
      if (draftBlocker !== undefined) {
        if (commit) {
          try {
            const agentLabel = draftResult.agentLabel ?? "unknown";
            const reason = firstNonEmptyLine(draftBlocker);

            commitPlanBlocker({
              worktreePath: worktreePath as string,
              specDirBasename,
              agentLabel,
              reason,
              specFilesCount: draftSpecFilesCount,
              targetDir,
            });
            opts.io.stderr(`plan: blocker commit pushed\n`);

            await safeUpdatePrBody({
              agent: prDescAgent,
              timeoutMs: rawCfg.iterationTimeoutMs,
              io: opts.io,
              branch: planBranch,
              base: baseBranch as string,
              worktreePath: worktreePath as string,
              name: planName,
              specDirBasename,
              prNarrative: planCfg.modes.plan.prNarrative ?? "template",
              targetDir,
            });
          } catch (err) {
            opts.io.stderr(`${(err as Error).message}\n`);
            summarizePlan("error", specDirBasename);
            return 1;
          }
        }

        opts.io.stderr(`plan: blocked\n`);
        if (draftBlocker) {
          opts.io.stderr(`\n## Blocker\n\n${draftBlocker}\n`);
        }
        emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Post-draft body refresh (header now reflects the real index.md).
      if (commit) {
        await safeUpdatePrBody({
          agent: prDescAgent,
          timeoutMs: rawCfg.iterationTimeoutMs,
          io: opts.io,
          branch: planBranch,
          base: baseBranch as string,
          worktreePath: worktreePath as string,
          name: planName,
          specDirBasename,
          prNarrative: planCfg.modes.plan.prNarrative ?? "template",
          targetDir,
        });
      }

      // Self-review phase
      const reviewPasses = resolveReviewPasses(rawCfg, inv.reviewPasses);
      if (reviewPasses > 0) {
        const reviewOpts: PlanReviewPhaseOptions = {
          onOutboundPrompt: logOutboundPrompt,
          worktreePath,
          name: specDirBasename,
          specDirBasename,
          ...(commit ? {} : { specDirPath: finalSpecPath, additionalReadDirs: [finalSpecPath] }),
          config: planCfg,
          reviewAgentOrder,
          ...(inv.reviewPasses !== undefined ? { reviewPassesOverride: inv.reviewPasses } : {}),
          stderr: opts.io.stderr,
          planTelemetry: planTelemetryWriter,
          targetDir,
          commit,
          gitEnabled,
          checkBoundary: true,
          logNoChangeSkip: true,
          createAgent: resolveAgent,
          projectRoot: project.root,
          planWorktreeDir: worktreePath,
          idleOutputTimeoutMs: rawCfg.idleOutputTimeoutMs,
        };
        if (externalSpecRoot !== undefined) {
          reviewOpts.externalSpecRoot = externalSpecRoot;
        }
        const reviewResult = await runPlanReviewPhase({
          ...reviewOpts,
          ...(commit
            ? {
                updatePrBody: async () => {
                  await safeUpdatePrBody({
                    agent: prDescAgent,
                    timeoutMs: rawCfg.iterationTimeoutMs,
                    io: opts.io,
                    branch: planBranch,
                    base: baseBranch as string,
                    worktreePath: worktreePath as string,
                    name: planName,
                    specDirBasename,
                    prNarrative: planCfg.modes.plan.prNarrative ?? "template",
                    targetDir,
                  });
                },
              }
            : {}),
          isInterrupted: () => interrupted,
          onPassStart: (pass, total) => {
            opts.io.stderr(`plan: review pass ${pass}/${total} starting\n`);
          },
        });
        if (reviewResult.interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("sigint", specDirBasename);
          return 130;
        }
        if (reviewResult.exitCode === 2) {
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("quota-exhausted", specDirBasename);
          return 2;
        }
        if (reviewResult.exitCode === 3) {
          emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
          summarizePlan("model-config", specDirBasename);
          return 3;
        }
        if (reviewResult.exitCode !== 0) {
          if (reviewResult.blocker !== undefined) {
            opts.io.stderr(`\n## Blocker\n\n${reviewResult.blocker}\n`);
            emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
            summarizePlan("blocker", specDirBasename);
          } else {
            emitPreservedSpecDirBreadcrumb(opts.io, externalSpecRoot, specDirBasename);
            summarizePlan(reviewResult.exitCode === 1 ? "agent-error" : "error", specDirBasename);
          }
          return reviewResult.exitCode;
        }
      }

      if (commit) {
        try {
          const prUrl = getPrUrl(worktreePath as string, planBranch);
          opts.io.stdout(
            renderPlanNextSteps({
              prUrl,
              planName,
              specDirBasename,
              targetDir,
            }),
          );
        } catch {
          // best-effort; completion still succeeds without a URL
        }

        const planFixCommand = rawCfg.projects[project.key]?.fixCommand;
        safeMarkPlanPrReady({
          io: opts.io,
          branch: planBranch,
          worktreePath: worktreePath as string,
          specDirPath: finalSpecPath,
          commit: true,
          timeoutMs: rawCfg.iterationTimeoutMs,
          ...(planFixCommand !== undefined ? { fixCommand: planFixCommand } : {}),
        });
      } else {
        // For commit: false, show the absolute path and jarvis run command
        const noCommitSpecRoot = computeNoCommitSpecRoot(jarvisConfigDir, project, specDirBasename);
        const indexPath = join(noCommitSpecRoot, "index.md");
        emitNoCommitPlanNextSteps(opts.io, indexPath);
      }
      summarizePlan("complete", specDirBasename);

      return 0;
    }

    // This path is reached when `skipGhCheck` is true (test seam) or when the
    // target is not a git repo: no worktree is created, no commits are made,
    // and plan mode falls through to the not-yet-implemented stub. The
    // interactive case is handled earlier when `planName` is null.
    opts.io.stderr("plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n");
    return 2;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

export function renderPlanNextSteps(args: {
  prUrl: string;
  planName?: string;
  specDirBasename?: string;
  specName?: string;
  targetDir?: string;
}): string {
  const specDirBasename = args.specDirBasename ?? args.specName;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  const targetDir = args.targetDir ?? "spec";
  return [
    "",
    "Next steps:",
    `  1. Review the draft PR: ${args.prUrl}`,
    `  2. Edit ${targetDir}/${specDirBasename}/ on the plan branch as needed (locally or`,
    "     through GitHub), or run `jarvis1 plan --resume",
    `     ${targetDir}/${specDirBasename}/index.md\` for another self-review pass.`,
    "  3. After the merge, implement the spec with:",
    `       jarvis1 run ${targetDir}/${specDirBasename}/index.md`,
    "",
  ].join("\n");
}

function getCurrentBranch(cwd: string): string {
  const output = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  return output.trim();
}

function getPrUrl(cwd: string, branch: string): string {
  const url = execFileSync("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  return url.trim();
}

/**
 * Wrap `updatePlanPrBody` with the warn-and-continue pattern used throughout
 * plan mode so the caller doesn't repeat the try/catch.
 *
 * When `agent` is supplied, the rewrite regenerates a model-authored
 * Description + Decisions narrative whenever the marker section is empty
 * (e.g., on first body refresh after the draft commit). Existing human-edited
 * narrative is preserved verbatim. The intent is read best-effort from the
 * spec dir; a missing intent only disables regeneration.
 */
async function safeUpdatePrBody(args: {
  io: PlanIo;
  branch: string;
  base: string;
  worktreePath: string;
  name: string;
  specDirBasename: string;
  prNarrative: "template" | "agent";
  specDirPath?: string;
  targetDir?: string;
  agent?: Agent | undefined;
  timeoutMs?: number | undefined;
}): Promise<void> {
  const controller = new AbortController();
  const timeout =
    args.timeoutMs === undefined ? null : setTimeout(() => controller.abort("pr-description-timeout"), args.timeoutMs);
  timeout?.unref();
  try {
    const specDirPath = args.specDirPath ?? join(args.worktreePath, args.targetDir ?? "spec", args.specDirBasename);
    const indexPath = join(specDirPath, "index.md");
    let intentContent: string | undefined;
    try {
      intentContent = readFileSync(join(specDirPath, "intent.md"), "utf8");
    } catch {
      // best-effort: missing intent just disables regeneration
    }
    await updatePlanPrBody({
      indexPath,
      specDirPath,
      branch: args.branch,
      base: args.base,
      cwd: args.worktreePath,
      prNarrative: args.prNarrative,
      ...(args.targetDir !== undefined ? { targetDir: args.targetDir } : {}),
      ...(args.agent !== undefined ? { agent: args.agent } : {}),
      ...(intentContent !== undefined ? { intentContent } : {}),
      runOptions: {
        signal: controller.signal,
      },
    });
  } catch (err) {
    args.io.stderr(`warning: could not update PR body: ${(err as Error).message}\n`);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Wrap `maybeMarkPlanPrReady` with the warn-and-continue pattern.
 */
function safeMarkPlanPrReady(args: {
  io: PlanIo;
  branch: string;
  worktreePath: string;
  specDirPath?: string;
  commit?: boolean;
  fixCommand?: string;
  timeoutMs: number;
  markReady?: (branch: string, cwd: string) => void;
  getOpenPrState?: (branch: string, cwd: string) => OpenPrInfo;
}): void {
  try {
    if (args.commit === true && args.specDirPath !== undefined) {
      repairPlanSpecMarkdown({
        specDirPath: args.specDirPath,
        commit: true,
        warn: (message) => args.io.stderr(message),
      });
    }
    maybeMarkPlanPrReady({
      branch: args.branch,
      cwd: args.worktreePath,
      timeoutMs: args.timeoutMs,
      ...(args.fixCommand !== undefined ? { fixCommand: args.fixCommand } : {}),
      ...(args.markReady ? { markReady: args.markReady } : {}),
      ...(args.getOpenPrState ? { getOpenPrState: args.getOpenPrState } : {}),
    });
  } catch (err) {
    args.io.stderr(`warning: could not mark PR ready for review: ${(err as Error).message}\n`);
  }
}

/** Emit stdout usage summary when at least one plan agent invocation wrote telemetry.*/
function emitPlanUsageSummaryIfNeeded(args: {
  io: PlanIo;
  telemetryPath: string | null;
  namespace: string;
  startedAt: Date;
  startedMs: number;
  exitReason: string;
  specPathForSummary: string;
  writer: PlanTelemetryWriter;
}): void {
  if (!args.writer.hasAgentInvocationWrites()) {
    return;
  }
  args.io.stdout(
    `\n${planSummary({
      telemetryPath: args.telemetryPath,
      namespace: args.namespace,
      startTs: args.startedAt.toISOString(),
      exitReason: args.exitReason,
      durationMs: Date.now() - args.startedMs,
      specPath: args.specPathForSummary,
    })}`,
  );
}

/** First non-empty line of `text`, trimmed. Empty string if none. */
function firstNonEmptyLine(text: string): string {
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line !== "") {
      return line;
    }
  }
  return "";
}

/** Emit breadcrumb for preserved no-commit spec directory on failure. */
function emitPreservedSpecDirBreadcrumb(
  io: PlanIo,
  externalSpecRoot: string | undefined,
  specDirBasename: string,
): void {
  if (externalSpecRoot) {
    const finalSpecPath = join(externalSpecRoot, specDirBasename);
    io.stderr(`Spec preserved at ${finalSpecPath}\n`);
  }
}

/** Try to detect git origin from a project root directory.
 * Returns the non-empty trimmed stdout from `git -C <root> remote get-url origin`,
 * or undefined if detection fails for any reason (non-zero exit, missing git, non-git directory, etc.).
 * Non-throwing; all errors are caught and return undefined.
 */
function detectGitOrigin(projectRoot: string): string | undefined {
  try {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    // Return only if non-empty; empty stdout is treated as "no origin"
    return origin.length > 0 ? origin : undefined;
  } catch {
    // Any error (non-zero exit, missing git binary, non-git directory, etc.) is silent
    return undefined;
  }
}

/**
 * Format a raw repo origin/key for MD034-safe `repo:` inject (`commit: false` only).
 * GitHub HTTPS/SSH/scp origins become `owner/repo`; other http(s) URLs wrap in `<>`.
 */
function formatInjectedRepoValue(raw: string): string {
  const trimmed = raw.trim();
  const normalized = normalizeRepoUrl(trimmed);
  if (normalized?.startsWith("github.com/")) {
    return normalized.slice("github.com/".length);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return `<${trimmed}>`;
  }
  return trimmed;
}

/**
 * Inject a `repo:` line into the index.md if not already present.
 * Prefers origin URL if available; falls back to detected git origin; falls back to project key.
 */
export function injectRepoLineIntoIndex(specDirPath: string, project: ProjectMatch): void {
  const indexPath = join(specDirPath, "index.md");
  if (!existsSync(indexPath)) {
    return; // index.md not yet created
  }

  let content = readFileSync(indexPath, "utf8");

  // Check if repo: line already exists
  if (/^repo:\s*\S+/m.test(content)) {
    return; // Already has a repo: line
  }

  // Determine the repo value: prefer configured origin, then detect from git, then fall back to key
  let repoValue = project.origin;
  if (!repoValue) {
    // Try to detect git origin when project.origin is not configured
    repoValue = detectGitOrigin(project.root);
  }
  // Final fallback to project key
  if (!repoValue) {
    repoValue = project.key;
  }
  if (!repoValue) {
    return; // Can't inject if no repo identifier
  }

  const repoLineValue = formatInjectedRepoValue(repoValue);

  // Insert repo: line after the first line (which is usually a heading like # ...)
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0) {
    // Insert after the first line
    lines.splice(1, 0, `repo: ${repoLineValue}`);
    content = lines.join("\n");
    writeFileSync(indexPath, content, "utf8");
  }
}
