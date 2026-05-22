import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  CONFIG_DIR,
  findProjectForPath,
  loadConfig,
  type ProjectMatch,
  resolvePlanFlags,
} from "../config.ts";
import type { LogClient } from "../logging.ts";
import { enterMode } from "../mode-entry.ts";
import { detectBlocker } from "../modes/plan/blocker.ts";
import {
  appendBoundaryBlocker,
  assertNoCommitExternalSpecBoundary,
  assertPlanWriteBoundary,
  assertTargetRepoPlanBoundary,
  type BoundaryCheckResult,
  revertPaths,
} from "../modes/plan/boundary.ts";
import {
  commitPlanBlocker,
  commitPlanDraft,
  commitPlanRefine,
  commitPlanReview,
} from "../modes/plan/commits.ts";
import { runDraftPhase, validateDraftOutput } from "../modes/plan/draft.ts";
import { runInlineDraftTurn } from "../modes/plan/inline-draft.ts";
import { runNameOnlyPhase } from "../modes/plan/name-only.ts";
import {
  createPlanTelemetryWriter,
  type PlanTelemetryWriter,
} from "../modes/plan/plan-telemetry.ts";
import {
  buildPlanPrHeader,
  maybeMarkPlanPrReady,
  type OpenPrInfo,
} from "../modes/plan/pr.ts";
import {
  type RefineTerminalOutcome,
  runRefinePhase,
} from "../modes/plan/refine.ts";
import {
  hasWorkingTreeChanges,
  runReviewPass,
  validateReviewOutput,
} from "../modes/plan/review.ts";
import {
  hasSpecDirChanges,
  snapshotSpecDirFiles,
} from "../modes/plan/spec-dir.ts";
import {
  computeNoCommitSpecRoot,
  ensureNoCommitSpecRoot,
  formatPlanSpecTimestamp,
  stripPlanSpecTimestampPrefix,
} from "../modes/plan/spec-paths.ts";
import { ensureDraftPr, renderAttribution, updatePrBody } from "../pr.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../quota-harness-messages.ts";
import type { resolveTargetRepo } from "../repo.ts";
import { planSummary } from "../run-summary.ts";
import { createPlanWorktree, createWorktreeSymlinks } from "../worktree.ts";
import {
  describePlanInvocation,
  type PlanInvocation,
  parsePlanArgs,
} from "./plan-args.ts";

export type PlanIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type PlanCommandOptions = {
  io: PlanIo;
  args?: readonly string[];
  cwd?: string;
  /**
   * Optional config dir override (for tests).
   */
  config?: Parameters<typeof resolveTargetRepo>[0]["config"];
  /** Override the log client (for tests). */
  logClient?: LogClient;
  /** Skip git/gh checks and worktree creation (for tests). */
  skipGhCheck?: boolean;
};

export const PLAN_USAGE = `Usage: jarvis1 plan [--refine-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [--resume-draft] [<intent-file|"inline text">]
                            Run plan mode (draft specs under spec/…; see docs/plan-mode.md).
`;

const PLAN_STUB_MESSAGE =
  "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n";
const PHASE0_REVIEW_GATE_BLOCKER = `## Blocker

Review and approve \`spec/<spec-dir>/intent.md\` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in \`intent.md\`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
\`jarvis1 plan --resume-draft spec/<spec-dir>/intent.md\``;

/** Best-effort harness log for plan setup diagnostics (mirrors patch-mode fanout style). */
function planHarnessLog(logClient: LogClient, text: string): void {
  void logClient
    .send({
      namespace: "jarvis",
      text,
      tag: "harness",
    })
    .catch(() => {});
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function derivePlanName(inv: PlanInvocation): string {
  switch (inv.mode) {
    case "file": {
      const filename = basename(inv.intentPath);
      const nameWithoutExt = filename.replace(/\.[^.]*$/, "");
      return toKebabCase(nameWithoutExt) || "plan";
    }
    case "inline": {
      const words = inv.intentText.split(/\s+/).slice(0, 6);
      const kebabbed = toKebabCase(words.join(" "));
      const truncated = kebabbed.slice(0, 40);
      return truncated || "plan";
    }
    case "interactive":
      return `interactive-${new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", "-")
        .replace(":", "")}`;
  }
}

const RESERVED_NAMES = new Set(["index", "intent"]);
const TEMP_PLAN_PREFIX = "tmp-";

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

export function validateProposedName(name: string | undefined): {
  valid: boolean;
  normalized?: string | undefined;
} {
  if (name === undefined) {
    return { valid: false };
  }
  const normalized = name.trim();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return { valid: false };
  }
  if (normalized.length === 0 || normalized.length > 40) {
    return { valid: false };
  }
  if (RESERVED_NAMES.has(normalized)) {
    return { valid: false };
  }
  return { valid: true, normalized };
}

function remoteSpecBranchExists(
  projectRoot: string,
  branchName: string,
): boolean {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--heads", "origin", `plan/${branchName}`],
      {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      },
    );
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

function _removeSpecDirIfPresent(
  worktreePath: string,
  specDirBasename: string,
) {
  const specDir = join(worktreePath, "spec", specDirBasename);
  if (existsSync(specDir)) {
    rmSync(specDir, { recursive: true, force: true });
  }
}

type ResumePrep = {
  planName: string;
  specDirBasename: string;
  worktreePath: string;
  nextResumeIndex: number;
  nextReviewIndex: number;
  /**
   * For no-commit specs, the external spec root path where the spec lives.
   * When set, refine/draft/review operations read/write from here instead of worktreePath/spec/.
   */
  externalSpecRoot?: string;
};

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
  projectRoot: string;
  specPath: string;
  mode: "resume" | "resume-draft";
  config?: PlanCommandOptions["config"];
}): ResumePrep {
  const cfg = loadConfig(args.config);
  const project = findProjectForPath(args.specPath);
  if (project === undefined) {
    throw new Error(
      `could not determine project for spec path: ${args.specPath}`,
    );
  }
  const { commit, targetDir } = resolvePlanFlags(cfg, project);

  // For no-commit specs, the spec path is already external; for commit specs, it's in the worktree
  const isNoCommit = !commit;

  // The spec path points at the spec file (intent.md / index.md); its parent
  // is the spec directory and the grandparent is the external spec root.
  const { planName, specDirBasename, externalSpecRoot } = resolveResumeSpecPath(
    args.specPath,
    args.mode,
  );
  const specDir = specDirBasename;

  if (isNoCommit) {
    // For no-commit specs, specs live under ~/.jarvis/specs/<projectId>/<specDirBasename>/
    return {
      planName,
      specDirBasename: specDir,
      worktreePath: project.root,
      externalSpecRoot,
      nextResumeIndex: 0,
      nextReviewIndex: 0,
    };
  }

  // For commit: true, use the original logic
  const worktreePath = join(args.projectRoot, ".worktree", `plan-${planName}`);
  if (!existsSync(worktreePath)) {
    throw new Error(`plan worktree missing at ${worktreePath}`);
  }
  const branch = `plan/${planName}`;
  if (currentBranch(worktreePath) !== branch) {
    throw new Error(`${worktreePath} is not checked out on ${branch}`);
  }
  if (!existsSync(join(worktreePath, targetDir, specDir, "intent.md"))) {
    throw new Error(`missing ${targetDir}/${specDir}/intent.md in ${worktreePath}`);
  }
  if (
    args.mode === "resume" &&
    !existsSync(join(worktreePath, targetDir, specDir, "index.md"))
  ) {
    throw new Error(`missing ${targetDir}/${specDir}/index.md in ${worktreePath}`);
  }
  if (!isWorktreeClean(worktreePath)) {
    throw new Error(
      `the worktree is not clean; inspect with \`jarvis1 triage plan-${planName}\` and re-run`,
    );
  }
  if (!remoteSpecBranchExists(args.projectRoot, planName)) {
    throw new Error(
      `plan branch plan/${planName} is not on origin; cannot resume`,
    );
  }
  const counters = computeResumeCounters(worktreePath);
  return {
    planName,
    specDirBasename: specDir,
    worktreePath,
    nextResumeIndex: counters.nextResumeIndex,
    nextReviewIndex: counters.nextReviewIndex,
  };
}

export async function deriveSpecName(
  inv: PlanInvocation,
  projectRoot: string,
  targetDir: string = "spec",
): Promise<string> {
  let name = derivePlanName(inv);

  // Check reserved names
  if (RESERVED_NAMES.has(name)) {
    name = "plan";
  }

  // Check for collisions and append suffix if needed
  let finalName = name;
  const specDirExists = existsSync(join(projectRoot, targetDir, finalName));
  const worktreeDirExists = existsSync(
    join(projectRoot, ".worktree", `plan-${finalName}`),
  );
  const remoteBranchExists = remoteSpecBranchExists(projectRoot, finalName);

  if (!specDirExists && !worktreeDirExists && !remoteBranchExists) {
    // No collision, return the name as-is
    return finalName;
  }

  // There's a collision, start with suffix -2
  let suffix = 2;
  while (true) {
    finalName = `${name}-${suffix}`;

    const specDirExists = existsSync(join(projectRoot, targetDir, finalName));
    const worktreeDirExists = existsSync(
      join(projectRoot, ".worktree", `plan-${finalName}`),
    );
    const remoteBranchExists = remoteSpecBranchExists(projectRoot, finalName);

    if (!specDirExists && !worktreeDirExists && !remoteBranchExists) {
      break;
    }

    suffix += 1;
  }

  return finalName;
}

async function ensureUniquePlanName(
  projectRoot: string,
  baseName: string,
): Promise<string> {
  let finalName = baseName;
  let suffix = 2;
  while (true) {
    const specDirExists = existsSync(join(projectRoot, "spec", finalName));
    const worktreeDirExists = existsSync(
      join(projectRoot, ".worktree", `plan-${finalName}`),
    );
    const remoteBranchExists = remoteSpecBranchExists(projectRoot, finalName);
    if (!specDirExists && !worktreeDirExists && !remoteBranchExists) {
      return finalName;
    }
    finalName = `${baseName}-${suffix}`;
    suffix += 1;
  }
}

export type SeedIntentFileMode = "file" | "inline" | "interactive";

export type SeedIntentFileOptions = {
  worktreePath: string;
  name: string;
  mode: SeedIntentFileMode;
  intentPath?: string;
  intentText?: string;
  /**
   * Optional external spec root for no-commit specs.
   * If provided, the spec is seeded here instead of under worktreePath/spec/.
   */
  externalSpecRoot?: string;
};

export function seedIntentFile(opts: SeedIntentFileOptions): void {
  const specDir = opts.externalSpecRoot
    ? join(opts.externalSpecRoot, opts.name)
    : join(opts.worktreePath, "spec", opts.name);
  const intentPath = join(specDir, "intent.md");

  if (existsSync(intentPath)) {
    throw new Error(
      `intent.md already exists at ${intentPath}; will not overwrite`,
    );
  }

  mkdirSync(specDir, { recursive: true });

  let content: string;
  if (opts.mode === "file") {
    if (!opts.intentPath) {
      throw new Error("intentPath required for file mode");
    }
    try {
      content = readFileSync(opts.intentPath, "utf8");
    } catch (err) {
      throw new Error(`could not read intent file: ${(err as Error).message}`);
    }
  } else if (opts.mode === "inline") {
    if (opts.intentText === undefined) {
      throw new Error("intentText required for inline mode");
    }
    content = `${opts.intentText}\n`;
  } else if (opts.mode === "interactive") {
    content =
      "# Intent\n\n(Interactive session — no seed text. The refine phase will gather\nthe intent.)\n";
  } else {
    throw new Error(`unknown mode: ${opts.mode}`);
  }

  writeFileSync(intentPath, content, "utf8");
}

export function shouldStopAfterPhase0Refine(opts: {
  commit: boolean;
  mode: SeedIntentFileMode;
  resume: boolean;
}): boolean {
  return opts.commit && opts.mode === "file" && !opts.resume;
}

export function appendPhase0ReviewGateBlocker(
  intentPath: string,
  specDirBasename: string,
  targetDir: string = "spec",
): string {
  const current = readFileSync(intentPath, "utf8").replace(/\r\n/g, "\n");
  if (detectBlocker(current).hasBlocker) {
    return current;
  }
  const blockerSection = PHASE0_REVIEW_GATE_BLOCKER.replaceAll(
    "<spec-dir>",
    specDirBasename,
  ).replaceAll(
    "spec/",
    `${targetDir}/`,
  );
  const withSpacer = current.endsWith("\n\n")
    ? current
    : current.endsWith("\n")
      ? `${current}\n`
      : `${current}\n\n`;
  const updated = `${withSpacer}${blockerSection}\n`;
  writeFileSync(intentPath, updated, "utf8");
  return updated;
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
      return result.exitCode;
    }

    const inv = result.invocation;
    // Resolve from a file-like path (matching run mode, which passes a spec
    // file). For inline/interactive plan modes there's no real intent file, so
    // synthesize one inside cwd: resolveProject's `dirname()` then yields cwd
    // as the walk start, mirroring "as if there were a spec here".
    const candidatePath =
      inv.mode === "file" ? inv.intentPath : join(inv.cwd, "intent");
    const cfg = loadConfig(opts.config);
    const entryOpts: Parameters<typeof enterMode>[0] = {
      candidatePath,
      io: { stderr: opts.io.stderr },
      logServerUrl: cfg.logServerUrl,
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
      opts.io.stderr(
        `${entry.reason}\nMatching projects:\n${names}\nPass --repo <name> to disambiguate.\n`,
      );
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
    planHarnessLog(planLogClient, describePlanInvocation(inv));
    if (inv.mode === "interactive") {
      opts.io.stderr("plan: interactive session started\n");
    }

    const project = entry.resolution.resolved.project;
    planHarnessLog(
      planLogClient,
      `plan: target project=${project.key} root=${project.root}`,
    );

    const fullProject = cfg.projects[project.key];
    const { specTimestamp, commit, targetDir } = resolvePlanFlags(cfg, fullProject);
    planHarnessLog(
      planLogClient,
      `plan: resolved flags specTimestamp=${specTimestamp} commit=${commit} targetDir=${targetDir}`,
    );

    if (inv.mode === "interactive" && (inv.refineTurns ?? 3) === 0) {
      opts.io.stderr(
        "plan: --refine-turns 0 is incompatible with interactive mode\n(no intent text was provided)\n",
      );
      return 1;
    }

    if (inv.mode === "inline" && !inv.resume && !inv.resumeDraft) {
      const inlineIntentPath = join(
        inv.cwd,
        "spec",
        "wip-intents",
        `${toKebabCase(inv.intentText.split(" ").slice(0, 4).join(" "))}.md`,
      );
      if (existsSync(inlineIntentPath)) {
        opts.io.stderr(
          `plan: ${inlineIntentPath} already exists; refusing to overwrite\n`,
        );
        return 1;
      }
      mkdirSync(dirname(inlineIntentPath), { recursive: true });
      writeFileSync(inlineIntentPath, `${inv.intentText}\n`, "utf8");
      const inlineCfg = loadConfig(opts.config);
      const inlineResult = await runInlineDraftTurn({
        worktreePath: inv.cwd,
        inlineIntent: inv.intentText,
        intentPath: inlineIntentPath,
        config: inlineCfg,
        stderr: opts.io.stderr,
      });
      if (inlineResult.result.kind === "ok") {
        opts.io.stderr(
          `plan: inline intent draft written to ${inlineIntentPath}\n`,
        );
        return 0;
      }
      if (inlineResult.result.kind === "quota") {
        opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
        return 2;
      }
      if (inlineResult.result.kind === "model_config") {
        opts.io.stderr(
          `plan: model configuration error\n${inlineResult.result.stderr}\n`,
        );
        return 3;
      }
      opts.io.stderr(
        `plan: inline intent draft failed\n${inlineResult.result.stderr}\n`,
      );
      return 1;
    }

    if (inv.resume || inv.resumeDraft) {
      const resumeFlag = inv.resume ? "--resume" : "--resume-draft";
      if (inv.mode === "interactive") {
        opts.io.stderr(`${resumeFlag} requires a spec path\n`);
        return 1;
      }
      if (inv.mode !== "file") {
        opts.io.stderr(
          `${resumeFlag} cannot be combined with intent text/file\n`,
        );
        return 1;
      }
      const reviewPasses = inv.reviewPasses ?? 2;
      const refineTurns = inv.resume ? (inv.refineTurns ?? 0) : 0;
      if (reviewPasses === 0 && refineTurns === 0) {
        opts.io.stderr(`${resumeFlag} requires at least one phase\n`);
        return 1;
      }

      let resume: ResumePrep;
      try {
        resume = prepareResume({
          projectRoot: project.root,
          specPath: inv.intentPath,
          mode: inv.resume ? "resume" : "resume-draft",
          ...(opts.config !== undefined ? { config: opts.config } : {}),
        });
      } catch (err) {
        opts.io.stderr(`${(err as Error).message}\n`);
        return 1;
      }

      const branch = `plan/${resume.planName}`;
      const suffix = `r${resume.nextResumeIndex}`;
      let nextReviewIndex = resume.nextReviewIndex;
      opts.io.stderr(`plan: resume ${suffix} started\n`);

      const cfg = loadConfig(opts.config);
      const resumeProject = findProjectForPath(inv.intentPath);
      const { targetDir: resumeTargetDir } = resolvePlanFlags(cfg, resumeProject);
      const resumeIntentPath = resume.externalSpecRoot
        ? join(resume.externalSpecRoot, resume.specDirBasename, "intent.md")
        : join(
            resume.worktreePath,
            resumeTargetDir,
            resume.specDirBasename,
            "intent.md",
          );
      if (inv.resumeDraft) {
        const intentBody = readFileSync(resumeIntentPath, "utf8");
        if (detectBlocker(intentBody).hasBlocker) {
          opts.io.stderr(
            `--resume-draft requires \`## Blocker\` to be cleared in ${resumeTargetDir}/${resume.specDirBasename}/intent.md\n`,
          );
          return 1;
        }
      }
      const resumePlanStartedAt = new Date();
      const resumePlanStartedMs = Date.now();
      const resumeTelemetryPath = cfg.telemetryPath ?? null;
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
      if (refineTurns > 0) {
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizeResume("sigint");
          return 130;
        }
        try {
          const refineResult = await runRefinePhase({
            worktreePath: resume.worktreePath,
            name: resume.specDirBasename,
            config: cfg,
            refineTurns,
            stderr: opts.io.stderr,
            planTelemetry: resumePlanTelemetry,
            targetDir: resumeTargetDir,
            ...(resume.externalSpecRoot !== undefined
              ? { externalSpecRoot: resume.externalSpecRoot }
              : {}),
          });
          if (refineResult.result.kind !== "ok") {
            if (refineResult.result.kind === "quota") {
              opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
              summarizeResume("quota-exhausted");
              return 2;
            }
            if (refineResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan: model configuration error\n${refineResult.result.stderr}`,
              );
              summarizeResume("model-config");
              return 3;
            }
            opts.io.stderr(
              `plan: refine phase failed\n${refineResult.result.stderr}`,
            );
            summarizeResume("agent-error");
            return 1;
          }
          if (interrupted) {
            opts.io.stderr(`plan: interrupted\n`);
            summarizeResume("sigint");
            return 130;
          }
          if (refineResult.terminalOutcome !== undefined) {
            opts.io.stderr(`plan: refine: ${refineResult.terminalOutcome}\n`);
          }
          if (hasWorkingTreeChanges(resume.worktreePath)) {
            commitPlanRefine({
              worktreePath: resume.worktreePath,
              specDirBasename: resume.specDirBasename,
              mode: "interactive",
              intentPathOrLabel: "interactive",
              completedTurns: refineResult.completedTurns,
              subjectSuffix: suffix,
              resumedBy: refineResult.agentLabel ?? "unknown",
              targetDir: resumeTargetDir,
              ...(refineResult.terminalOutcome === "skipped" ||
              refineResult.terminalOutcome === "blocker"
                ? { refineOutcome: refineResult.terminalOutcome }
                : {}),
            });
          }
          if (refineResult.blocker !== undefined) {
            commitPlanBlocker({
              worktreePath: resume.worktreePath,
              specDirBasename: resume.specDirBasename,
              agentLabel: refineResult.agentLabel ?? "unknown",
              reason: firstNonEmptyLine(refineResult.blocker),
              specFilesCount: countSpecFiles(
                join(resume.worktreePath, resumeTargetDir, resume.specDirBasename),
              ),
              subjectSuffix: suffix,
              targetDir: resumeTargetDir,
            });
            safeUpdatePrBody({
              io: opts.io,
              branch,
              base: getCurrentBranch(project.root),
              worktreePath: resume.worktreePath,
              name: resume.planName,
              specDirBasename: resume.specDirBasename,
            });
            opts.io.stderr(`plan: blocked\n`);
            opts.io.stderr(`\n## Blocker\n\n${refineResult.blocker}\n`);
            summarizeResume("blocker");
            return 1;
          }
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizeResume("error");
          return 1;
        }
      }

      if (inv.resumeDraft) {
        let draftResult: Awaited<ReturnType<typeof runDraftPhase>>;
        let draftBlocker: string | undefined;
        let draftSpecFilesCount = 0;
        try {
          const finalSpecPath = resume.externalSpecRoot
            ? join(resume.externalSpecRoot, resume.specDirBasename)
            : join(resume.worktreePath, resumeTargetDir, resume.specDirBasename);
          const intentBefore = readFileSync(resumeIntentPath, "utf8");
          draftResult = await runDraftPhase({
            worktreePath: resume.worktreePath,
            name: resume.specDirBasename,
            ...(resume.externalSpecRoot ? { specDirPath: finalSpecPath } : {}),
            config: cfg,
            intentBefore,
            stderr: opts.io.stderr,
            planTelemetry: resumePlanTelemetry,
            targetDir: resumeTargetDir,
          });
          if (draftResult.result.kind !== "ok") {
            if (draftResult.result.kind === "quota") {
              opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
              summarizeResume("quota-exhausted");
              return 2;
            }
            if (draftResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan: model configuration error\n${draftResult.result.stderr}`,
              );
              summarizeResume("model-config");
              return 3;
            }
            opts.io.stderr(
              `plan: draft phase failed\n${draftResult.result.stderr}`,
            );
            summarizeResume("agent-error");
            return 1;
          }
          const validation = validateDraftOutput(
            resume.worktreePath,
            resume.specDirBasename,
            intentBefore,
            finalSpecPath,
          );
          if (!validation.valid) {
            opts.io.stderr(
              `plan: draft validation failed: ${validation.error}\n`,
            );
            summarizeResume("error");
            return 1;
          }
          draftBlocker = validation.blocker;
          draftSpecFilesCount = draftResult.subspecCount ?? 0;
          if (draftBlocker === undefined && draftResult.subspecCount === null) {
            opts.io.stderr(`plan: could not count subspecs\n`);
            summarizeResume("error");
            return 1;
          }
          commitPlanDraft({
            worktreePath: resume.worktreePath,
            specDirBasename: resume.specDirBasename,
            agentLabel: draftResult.agentLabel ?? "unknown",
            subspecCount: draftSpecFilesCount,
            subjectSuffix: suffix,
            targetDir: resumeTargetDir,
          });
          safeUpdatePrBody({
            io: opts.io,
            branch,
            base: getCurrentBranch(project.root),
            worktreePath: resume.worktreePath,
            name: resume.planName,
            specDirBasename: resume.specDirBasename,
          });
          if (draftBlocker !== undefined) {
            commitPlanBlocker({
              worktreePath: resume.worktreePath,
              specDirBasename: resume.specDirBasename,
              agentLabel: draftResult.agentLabel ?? "unknown",
              reason: firstNonEmptyLine(draftBlocker),
              specFilesCount: draftSpecFilesCount,
              subjectSuffix: suffix,
            });
            safeUpdatePrBody({
              io: opts.io,
              branch,
              base: getCurrentBranch(project.root),
              worktreePath: resume.worktreePath,
              name: resume.planName,
              specDirBasename: resume.specDirBasename,
            });
            opts.io.stderr(`plan: blocked\n`);
            opts.io.stderr(`\n## Blocker\n\n${draftBlocker}\n`);
            summarizeResume("blocker");
            return 1;
          }
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizeResume("error");
          return 1;
        }
      }

      for (let pass = 1; pass <= reviewPasses; pass += 1) {
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizeResume("sigint");
          return 130;
        }
        const resumeSpecPath = resume.externalSpecRoot
          ? join(resume.externalSpecRoot, resume.specDirBasename)
          : join(resume.worktreePath, resumeTargetDir, resume.specDirBasename);
        const intentPath = join(resumeSpecPath, "intent.md");
        const intentBefore = readFileSync(intentPath, "utf8");
        const result = await runReviewPass({
          worktreePath: resume.worktreePath,
          name: resume.specDirBasename,
          ...(resume.externalSpecRoot ? { specDirPath: resumeSpecPath } : {}),
          config: cfg,
          passNumber: nextReviewIndex,
          totalPasses: nextReviewIndex + reviewPasses - pass,
          stderr: opts.io.stderr,
          planTelemetry: resumePlanTelemetry,
          targetDir: resumeTargetDir,
        });
        if (result.result.kind !== "ok") {
          if (result.result.kind === "quota") {
            opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
            summarizeResume("quota-exhausted");
            return 2;
          }
          if (result.result.kind === "model_config") {
            opts.io.stderr(
              `plan: model configuration error: ${result.result.stderr}\n`,
            );
            summarizeResume("model-config");
            return 3;
          }
          opts.io.stderr(
            `plan: review pass ${nextReviewIndex} failed: ${result.result.stderr}\n`,
          );
          summarizeResume("agent-error");
          return 1;
        }
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizeResume("sigint");
          return 130;
        }

        if (!hasWorkingTreeChanges(resume.worktreePath)) {
          nextReviewIndex += 1;
          continue;
        }

        const validation = validateReviewOutput(
          resume.worktreePath,
          resume.specDirBasename,
          intentBefore,
        );
        if (!validation.valid) {
          opts.io.stderr(
            `plan: review pass ${nextReviewIndex} validation failed: ${validation.error}\n`,
          );
          summarizeResume("error");
          return 1;
        }
        if (validation.blocker !== undefined) {
          commitPlanBlocker({
            worktreePath: resume.worktreePath,
            specDirBasename: resume.specDirBasename,
            agentLabel: result.agentLabel ?? "unknown",
            reason: firstNonEmptyLine(validation.blocker),
            specFilesCount: countSpecFiles(
              join(resume.worktreePath, "spec", resume.specDirBasename),
            ),
            subjectSuffix: suffix,
          });
          safeUpdatePrBody({
            io: opts.io,
            branch,
            base: getCurrentBranch(project.root),
            worktreePath: resume.worktreePath,
            name: resume.planName,
            specDirBasename: resume.specDirBasename,
          });
          opts.io.stderr(`plan: blocked\n`);
          opts.io.stderr(`\n## Blocker\n\n${validation.blocker}\n`);
          summarizeResume("blocker");
          return 1;
        }

        commitPlanReview({
          worktreePath: resume.worktreePath,
          specDirBasename: resume.specDirBasename,
          passNumber: nextReviewIndex,
          agentLabel: result.agentLabel ?? "unknown",
          subjectSuffix: suffix,
          targetDir: resumeTargetDir,
        });
        safeUpdatePrBody({
          io: opts.io,
          branch,
          base: getCurrentBranch(project.root),
          worktreePath: resume.worktreePath,
          name: resume.planName,
          specDirBasename: resume.specDirBasename,
        });
        nextReviewIndex += 1;
      }

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
      summarizeResume("complete");
      return 0;
    }

    const tempId = crypto.randomUUID().slice(0, 8);
    const tempPlanName = `${TEMP_PLAN_PREFIX}${tempId}`;
    let planName = tempPlanName;
    let specDirBasename = tempPlanName;
    planHarnessLog(planLogClient, `plan: temporary plan name=${tempPlanName}`);

    // Create worktree for file or inline mode (only if it's a git repo and gh is available).
    // For commit: false, use the main checkout as worktreePath.
    const isGitRepo = existsSync(join(project.root, ".git"));
    let worktreePath: string | null = null;

    // Prepare plan branch name early (doesn't depend on git)
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
            name: tempPlanName,
          });
          const cfg = loadConfig(opts.config);
          createWorktreeSymlinks(
            project.root,
            worktreePath,
            cfg.worktreeSymlinks,
          );
          planHarnessLog(
            planLogClient,
            `plan: worktree created at ${worktreePath}`,
          );
        } catch (err) {
          const message = (err as Error).message;
          // Handle local-only branch collision with a specific error message
          if (
            message.includes("already exists") &&
            message.includes(".worktree")
          ) {
            opts.io.stderr(
              `plan: local branch plan/${planName} already exists; delete it with \`git branch -D plan/${planName}\` and re-run\n`,
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

      // Load config once for use in refine and draft phases
      const cfg = loadConfig(opts.config);

      // For no-commit runs, create the external spec root directory early (before any agent writes)
      // and check for collisions before seeding the intent.
      let externalSpecRoot: string | undefined;
      if (commit === false) {
        externalSpecRoot = ensureNoCommitSpecRoot(
          CONFIG_DIR,
          project,
          specDirBasename,
        );
      }

      // Check for collision in the external spec root for no-commit runs
      // This happens BEFORE any agent invocation or intent seeding
      if (commit === false && externalSpecRoot) {
        const tempSpecPath = join(externalSpecRoot, specDirBasename);
        if (existsSync(tempSpecPath)) {
          opts.io.stderr(
            `${tempSpecPath} already exists. Rename or remove it before running again.\n`,
          );
          return 1;
        }
      }

      const cleanupNoCommitTempSpec = (): void => {
        if (commit === false && externalSpecRoot) {
          const tempSpecPath = join(externalSpecRoot, specDirBasename);
          if (existsSync(tempSpecPath)) {
            rmSync(tempSpecPath, { recursive: true, force: true });
          }
        }
      };

      // Seed the intent.md file into the worktree or external spec root
      try {
        if (inv.mode === "file") {
          seedIntentFile({
            worktreePath,
            name: specDirBasename,
            mode: "file",
            intentPath: inv.intentPath,
            ...(externalSpecRoot !== undefined ? { externalSpecRoot } : {}),
          });
        } else if (inv.mode === "inline") {
          seedIntentFile({
            worktreePath,
            name: specDirBasename,
            mode: "inline",
            intentText: inv.intentText,
            ...(externalSpecRoot !== undefined ? { externalSpecRoot } : {}),
          });
        } else {
          seedIntentFile({
            worktreePath,
            name: specDirBasename,
            mode: "interactive",
            ...(externalSpecRoot !== undefined ? { externalSpecRoot } : {}),
          });
        }
      } catch (err) {
        opts.io.stderr(
          `failed to seed intent file: ${(err as Error).message}\n`,
        );
        cleanupNoCommitTempSpec();
        return 1;
      }

      const planStartedAt = new Date();
      const planStartedMs = Date.now();
      const planTelemetryPath = cfg.telemetryPath ?? null;
      const planNsBase = `plan:${project.key}:${tempPlanName}`;
      const planTelemetryWriter = createPlanTelemetryWriter({
        telemetryPath: planTelemetryPath,
        namespace: planNsBase,
      });
      const summarizePlan = (
        exitReason: string,
        summarySpecName: string,
      ): void => {
        emitPlanUsageSummaryIfNeeded({
          io: opts.io,
          telemetryPath: planTelemetryPath,
          namespace: planNsBase,
          startedAt: planStartedAt,
          startedMs: planStartedMs,
          exitReason,
          specPathForSummary: `spec/${summarySpecName}/index.md`,
          writer: planTelemetryWriter,
        });
      };

      // Run refine phase
      let refineCompletedTurns = 0;
      let refineBlocker: string | undefined;
      let refineAgentLabel: string | null = null;
      let refineTerminalOutcome: RefineTerminalOutcome | undefined;

      try {
        const refineBudget = inv.refineTurns ?? 3;

        if (refineBudget > 0) {
          const refineResult = await runRefinePhase({
            worktreePath,
            name: specDirBasename,
            config: cfg,
            refineTurns: refineBudget,
            stderr: opts.io.stderr,
            planTelemetry: planTelemetryWriter,
            targetDir,
            ...(externalSpecRoot !== undefined ? { externalSpecRoot } : {}),
          });

          // Handle refine result
          if (refineResult.result.kind !== "ok") {
            if (refineResult.result.kind === "quota") {
              opts.io.stderr(
                `plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} during refine\n`,
              );
              cleanupNoCommitTempSpec();
              summarizePlan("quota-exhausted", specDirBasename);
              return 2;
            }
            if (refineResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan: model configuration error\n${refineResult.result.stderr}`,
              );
              cleanupNoCommitTempSpec();
              summarizePlan("model-config", specDirBasename);
              return 3;
            }
            // Generic error
            opts.io.stderr(
              `plan: refine phase failed\n${refineResult.result.stderr}`,
            );
            cleanupNoCommitTempSpec();
            summarizePlan("agent-error", specDirBasename);
            return 1;
          }

          refineCompletedTurns = refineResult.completedTurns;
          refineAgentLabel = refineResult.agentLabel;
          refineBlocker = refineResult.blocker;
          refineTerminalOutcome = refineResult.terminalOutcome;
          if (refineResult.terminalOutcome !== undefined) {
            opts.io.stderr(`plan: refine: ${refineResult.terminalOutcome}\n`);
          }
        } else if (inv.mode !== "interactive") {
          const namingResult = await runNameOnlyPhase({
            worktreePath,
            name: specDirBasename,
            config: cfg,
            stderr: opts.io.stderr,
            planTelemetry: planTelemetryWriter,
            targetDir,
            ...(externalSpecRoot !== undefined ? { externalSpecRoot } : {}),
          });
          if (namingResult.result.kind !== "ok") {
            if (namingResult.result.kind === "quota") {
              opts.io.stderr(
                `plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} during naming-only phase\n`,
              );
              cleanupNoCommitTempSpec();
              summarizePlan("quota-exhausted", specDirBasename);
              return 2;
            }
            if (namingResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan: model configuration error\n${namingResult.result.stderr}`,
              );
              cleanupNoCommitTempSpec();
              summarizePlan("model-config", specDirBasename);
              return 3;
            }
            opts.io.stderr(
              `plan: naming-only phase failed\n${namingResult.result.stderr}`,
            );
            cleanupNoCommitTempSpec();
            summarizePlan("agent-error", specDirBasename);
            return 1;
          }
        }
      } catch (err) {
        opts.io.stderr(`plan: refine phase error: ${(err as Error).message}\n`);
        cleanupNoCommitTempSpec();
        summarizePlan("error", specDirBasename);
        return 1;
      }

      const tempIntentPath = externalSpecRoot
        ? join(externalSpecRoot, specDirBasename, "intent.md")
        : join(worktreePath, targetDir, specDirBasename, "intent.md");
      const tempIntent = readFileSync(tempIntentPath, "utf8");
      const parsedName = parseIntentFrontmatter(tempIntent).name;
      const validation = validateProposedName(parsedName);
      let chosenBaseName: string;
      if (validation.valid && validation.normalized !== undefined) {
        chosenBaseName = validation.normalized;
      } else {
        chosenBaseName = await deriveSpecName(inv, project.root, targetDir);
        opts.io.stderr(
          `plan: agent did not propose a valid name; falling back to deterministic derivation (${chosenBaseName})\n`,
        );
      }
      planName = await ensureUniquePlanName(project.root, chosenBaseName);
      specDirBasename = specTimestamp
        ? `${formatPlanSpecTimestamp()}-${planName}`
        : planName;
      planHarnessLog(planLogClient, `plan: spec name=${planName}`);

      // Disk-collision guard for commit: false (worktrees are checked by ensureUniquePlanName)
      // This was already checked before seeding the intent, so skip it for no-commit.
      if (commit === false) {
        // Already checked; skip
      }

      const finalIntentBody = tempIntent.startsWith("---\n")
        ? tempIntent.replace(
            /^---\n[\s\S]*?\n---/,
            `---\nname: ${planName}\n---`,
          )
        : `---\nname: ${planName}\n---\n\n${tempIntent}`;
      writeFileSync(tempIntentPath, finalIntentBody, "utf8");

      // Rename temp spec directory to validated name
      try {
        if (commit === false && externalSpecRoot) {
          // For no-commit, rename within the external spec root
          renameSync(
            join(externalSpecRoot, tempPlanName),
            join(externalSpecRoot, specDirBasename),
          );
        } else {
          // For commit: true, rename within worktree
          renameSync(
            join(worktreePath, targetDir, tempPlanName),
            join(worktreePath, targetDir, specDirBasename),
          );
        }
      } catch (err) {
        opts.io.stderr(
          `plan: failed to rename spec directory: ${(err as Error).message}\n`,
        );
        cleanupNoCommitTempSpec();
        summarizePlan("error", specDirBasename);
        return 1;
      }

      // For commit: false, the spec is already in its final location (external).
      // For commit: true, the spec is in the worktree and will be committed to git.
      let finalSpecPath: string;
      if (commit === false && externalSpecRoot) {
        finalSpecPath = join(externalSpecRoot, specDirBasename);
      } else {
        finalSpecPath = join(worktreePath, targetDir, specDirBasename);
      }

      // Inject repo: line into index.md for no-commit specs (for portability)
      if (commit === false) {
        injectRepoLineIntoIndex(finalSpecPath, project);
      }

      // Skip git operations when commit: false
      if (commit !== false) {
        try {
          execFileSync(
            "git",
            ["branch", "-m", `plan/${tempPlanName}`, `plan/${planName}`],
            {
              cwd: worktreePath as string,
              stdio: "pipe",
            },
          );
          const nextWorktreePath = join(
            project.root,
            ".worktree",
            `plan-${planName}`,
          );
          execFileSync(
            "git",
            ["worktree", "move", worktreePath as string, nextWorktreePath],
            {
              cwd: project.root,
              stdio: "pipe",
            },
          );
          worktreePath = nextWorktreePath;
          finalSpecPath = join(worktreePath, targetDir, specDirBasename);
          const oldBranch = `plan/${tempPlanName}`;
          const localBranches = execFileSync(
            "git",
            ["branch", "--list", oldBranch],
            {
              cwd: project.root,
              stdio: "pipe",
              encoding: "utf8",
            },
          ).trim();
          if (localBranches.length > 0) {
            execFileSync("git", ["branch", "-D", oldBranch], {
              cwd: project.root,
              stdio: "pipe",
            });
          }
          planHarnessLog(
            planLogClient,
            `plan: renamed worktree and branch to plan/${planName}`,
          );
        } catch (err) {
          const message =
            typeof err === "object" &&
            err !== null &&
            "stderr" in err &&
            Buffer.isBuffer((err as { stderr: unknown }).stderr)
              ? (err as { stderr: Buffer }).stderr.toString("utf8")
              : (err as Error).message;
          opts.io.stderr(message);
          summarizePlan("error", specDirBasename);
          return 1;
        }
      }

      // Check for interrupt before any commit
      if (interrupted) {
        opts.io.stderr(`plan: interrupted\n`);
        summarizePlan("sigint", specDirBasename);
        return 130;
      }

      // If a blocker was raised during refine, commit it and stop
      if (refineBlocker !== undefined) {
        if (commit) {
          try {
            // Create the refine commit first (with the blocked state)
            const intentPathOrLabel =
              inv.mode === "file"
                ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
                : inv.mode === "inline"
                  ? (inv as Extract<typeof inv, { mode: "inline" }>).intentText
                  : "interactive";
            commitPlanRefine({
              worktreePath: worktreePath as string,
              specDirBasename,
              mode: inv.mode as "file" | "inline" | "interactive",
              intentPathOrLabel,
              completedTurns: refineCompletedTurns,
              refineOutcome: "blocker",
              targetDir,
            });
            opts.io.stderr(`plan: refine commit pushed\n`);

            // Then create the blocker commit
            const agentLabel = refineAgentLabel ?? "unknown";
            const reason = firstNonEmptyLine(refineBlocker);

            commitPlanBlocker({
              worktreePath: worktreePath as string,
              specDirBasename,
              agentLabel,
              reason,
              specFilesCount: 0,
            });
            opts.io.stderr(`plan: blocker commit pushed\n`);

            safeUpdatePrBody({
              io: opts.io,
              branch: planBranch,
              base: baseBranch as string,
              worktreePath: worktreePath as string,
              name: planName,
              specDirBasename,
            });
          } catch (err) {
            opts.io.stderr(`${(err as Error).message}\n`);
            summarizePlan("error", specDirBasename);
            return 1;
          }
        }

        opts.io.stderr(`plan: blocked\n`);
        if (refineBlocker) {
          opts.io.stderr(`\n## Blocker\n\n${refineBlocker}\n`);
        }
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Create plan: refine commit and push (only when commit: true)
      if (commit) {
        try {
          const intentPathOrLabel =
            inv.mode === "file"
              ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
              : inv.mode === "inline"
                ? (inv as Extract<typeof inv, { mode: "inline" }>).intentText
                : "interactive";
          commitPlanRefine({
            worktreePath: worktreePath as string,
            specDirBasename,
            mode: inv.mode as "file" | "inline" | "interactive",
            intentPathOrLabel,
            completedTurns: refineCompletedTurns,
            targetDir,
            ...(refineTerminalOutcome === "skipped" ||
            refineTerminalOutcome === "blocker"
              ? { refineOutcome: refineTerminalOutcome }
              : {}),
          });
          opts.io.stderr(`plan: refine commit pushed\n`);
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizePlan("error", specDirBasename);
          return 1;
        }
      }

      if (
        shouldStopAfterPhase0Refine({
          commit,
          mode: inv.mode,
          resume: inv.resume,
        })
      ) {
        const intentPath = join(finalSpecPath, "intent.md");
        const gatedIntent = appendPhase0ReviewGateBlocker(
          intentPath,
          specDirBasename,
          targetDir,
        );
        const blockerBody = detectBlocker(gatedIntent).body;
        const blockerReason =
          blockerBody !== undefined
            ? firstNonEmptyLine(blockerBody)
            : "intent approval required";
        try {
          commitPlanBlocker({
            worktreePath: worktreePath as string,
            specDirBasename,
            agentLabel: "operator",
            reason: blockerReason,
            specFilesCount: 0,
            targetDir,
          });
          opts.io.stderr(`plan: blocker commit pushed\n`);
          const planBranch = `plan/${planName}`;
          const baseBranch = getCurrentBranch(project.root);
          const prResult = await ensureDraftPr({
            branch: planBranch,
            base: baseBranch,
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
              base: baseBranch,
            }),
            cwd: worktreePath as string,
          });
          const prUrl = getPrUrl(worktreePath as string, planBranch);
          opts.io.stdout(`${prUrl}\n`);
          opts.io.stderr(`plan: draft PR #${prResult.number} opened\n`);
          safeUpdatePrBody({
            io: opts.io,
            branch: planBranch,
            base: baseBranch as string,
            worktreePath: worktreePath as string,
            name: planName,
            specDirBasename,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizePlan("error", specDirBasename);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
        if (blockerBody !== undefined) {
          opts.io.stderr(`\n## Blocker\n\n${blockerBody}\n`);
        }
        summarizePlan("blocker", specDirBasename);
        return 1;
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
          worktreePath,
          name: specDirBasename,
          ...(commit ? {} : { specDirPath: finalSpecPath }),
          config: cfg,
          intentBefore,
          stderr: opts.io.stderr,
          planTelemetry: planTelemetryWriter,
          targetDir,
        });

        // Check if draft succeeded
        if (draftResult.result.kind !== "ok") {
          if (draftResult.result.kind === "quota") {
            opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
            summarizePlan("quota-exhausted", specDirBasename);
            return 2;
          }
          if (draftResult.result.kind === "model_config") {
            opts.io.stderr(
              `plan: model configuration error\n${draftResult.result.stderr}`,
            );
            summarizePlan("model-config", specDirBasename);
            return 3;
          }
          // Generic error
          opts.io.stderr(
            `plan: draft phase failed\n${draftResult.result.stderr}`,
          );
          summarizePlan("agent-error", specDirBasename);
          return 1;
        }

        // Check for interrupt before any commit
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizePlan("sigint", specDirBasename);
          return 130;
        }

        // Validate output
        const validation = validateDraftOutput(
          worktreePath,
          specDirBasename,
          intentBefore,
          finalSpecPath,
        );
        if (!validation.valid) {
          opts.io.stderr(
            `plan: draft validation failed: ${validation.error}\n`,
          );
          summarizePlan("error", specDirBasename);
          return 1;
        }

        // Check if a blocker was raised
        if (validation.blocker !== undefined) {
          draftBlocker = validation.blocker;
        }

        draftSpecFilesCount = draftResult.subspecCount ?? 0;
        if (draftBlocker === undefined && draftResult.subspecCount === null) {
          opts.io.stderr(`plan: could not count subspecs\n`);
          summarizePlan("error", specDirBasename);
          return 1;
        }

        opts.io.stderr(`plan: draft phase completed\n`);
        if (commit === false) {
          injectRepoLineIntoIndex(finalSpecPath, project);
        }
      } catch (err) {
        opts.io.stderr(`plan: draft phase error: ${(err as Error).message}\n`);
        summarizePlan("error", specDirBasename);
        return 1;
      }

      // Check boundary before draft commit
      const boundaryCheck = commit
        ? assertPlanWriteBoundary(worktreePath, specDirBasename, targetDir)
        : assertTargetRepoPlanBoundary(project.root);

      // For no-commit runs, also check the external spec directory
      const externalBoundaryCheck: BoundaryCheckResult =
        !commit && externalSpecRoot
          ? assertNoCommitExternalSpecBoundary(
              externalSpecRoot,
              specDirBasename,
            )
          : { ok: true };

      const allBoundariesOk = boundaryCheck.ok && externalBoundaryCheck.ok;
      if (!allBoundariesOk) {
        opts.io.stderr(
          `plan: boundary violation detected before draft commit\n`,
        );
        const bcOffending = boundaryCheck.ok
          ? []
          : boundaryCheck.offendingPaths;
        const ebcOffending = externalBoundaryCheck.ok
          ? []
          : externalBoundaryCheck.offendingPaths;
        const allOffendingPaths = [...bcOffending, ...ebcOffending];
        if (commit) {
          revertPaths(worktreePath, allOffendingPaths);
        }
        appendBoundaryBlocker(
          finalSpecPath,
          specDirBasename,
          allOffendingPaths,
          targetDir,
        );
        for (const path of allOffendingPaths) {
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

            safeUpdatePrBody({
              io: opts.io,
              branch: planBranch,
              base: baseBranch as string,
              worktreePath: worktreePath as string,
              name: planName,
              specDirBasename,
            });
          } catch (err) {
            opts.io.stderr(`${(err as Error).message}\n`);
            summarizePlan("error", specDirBasename);
            return 1;
          }
        }

        opts.io.stderr(`plan: blocked\n`);
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
          opts.io.stderr(
            `warning: could not open draft PR: ${(err as Error).message}\n`,
          );
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
            });
            opts.io.stderr(`plan: blocker commit pushed\n`);

            safeUpdatePrBody({
              io: opts.io,
              branch: planBranch,
              base: baseBranch as string,
              worktreePath: worktreePath as string,
              name: planName,
              specDirBasename,
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
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Post-draft body refresh (header now reflects the real index.md).
      if (commit) {
        safeUpdatePrBody({
          io: opts.io,
          branch: planBranch,
          base: baseBranch as string,
          worktreePath: worktreePath as string,
          name: planName,
          specDirBasename,
        });
      }

      // Self-review phase
      const reviewPasses = inv.reviewPasses ?? 2;
      for (let pass = 1; pass <= reviewPasses; pass++) {
        // Honor a pending interrupt before doing any work for this pass.
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizePlan("sigint", specDirBasename);
          return 130;
        }

        opts.io.stderr(`plan: review pass ${pass}/${reviewPasses} starting\n`);

        try {
          // Read intent.md before the pass so we can validate it wasn't modified
          const intentPath = join(finalSpecPath, "intent.md");
          const intentBefore = readFileSync(intentPath, "utf8");
          const specSnapshotBefore = commit
            ? null
            : snapshotSpecDirFiles(finalSpecPath);

          // Run the review pass
          const reviewResult = await runReviewPass({
            worktreePath,
            name: specDirBasename,
            ...(commit ? {} : { specDirPath: finalSpecPath }),
            config: cfg,
            passNumber: pass,
            totalPasses: reviewPasses,
            stderr: opts.io.stderr,
            planTelemetry: planTelemetryWriter,
            targetDir,
          });

          // Handle agent errors
          if (reviewResult.result.kind === "error") {
            opts.io.stderr(
              `plan: review pass ${pass} failed: ${reviewResult.result.stderr}\n`,
            );
            summarizePlan("agent-error", specDirBasename);
            return 1;
          }

          if (reviewResult.result.kind === "model_config") {
            opts.io.stderr(
              `plan: model configuration error: ${reviewResult.result.stderr}\n`,
            );
            summarizePlan("model-config", specDirBasename);
            // Match patch mode (src/modes/patch/run.ts:1080) which exits 3 for
            // model_config errors so a single config typo produces the same
            // exit code regardless of which mode hits it.
            return 3;
          }

          if (reviewResult.result.kind === "quota") {
            opts.io.stderr(`plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
            summarizePlan("quota-exhausted", specDirBasename);
            return 2; // Quota exhausted exit code
          }

          // Honor a pending interrupt *before* committing so Ctrl-C during the
          // agent call leaves the worktree, branch, and PR untouched.
          if (interrupted) {
            opts.io.stderr(`plan: interrupted\n`);
            summarizePlan("sigint", specDirBasename);
            return 130;
          }

          // Check if the pass produced changes
          const passHasChanges = commit
            ? hasWorkingTreeChanges(worktreePath)
            : specSnapshotBefore !== null &&
              hasSpecDirChanges(finalSpecPath, specSnapshotBefore);
          if (!passHasChanges) {
            opts.io.stderr(
              `plan: review pass ${pass} made no changes; skipping commit\n`,
            );
            continue;
          }

          // Validate the review output
          const validation = validateReviewOutput(
            worktreePath,
            specDirBasename,
            intentBefore,
            finalSpecPath,
          );
          if (!validation.valid) {
            opts.io.stderr(
              `plan: review pass ${pass} validation failed: ${validation.error}\n`,
            );
            summarizePlan("error", specDirBasename);
            return 1;
          }

          // Check if a blocker was raised
          if (validation.blocker !== undefined) {
            // Check boundary before blocker commit
            const boundaryCheck = commit
              ? assertPlanWriteBoundary(worktreePath, specDirBasename, targetDir)
              : assertTargetRepoPlanBoundary(project.root);

            // For no-commit runs, also check the external spec directory
            const externalBoundaryCheck: BoundaryCheckResult =
              !commit && externalSpecRoot
                ? assertNoCommitExternalSpecBoundary(
                    externalSpecRoot,
                    specDirBasename,
                  )
                : { ok: true };

            const allBoundariesOk =
              boundaryCheck.ok && externalBoundaryCheck.ok;
            if (!allBoundariesOk) {
              opts.io.stderr(
                `plan: boundary violation detected before review blocker commit\n`,
              );
              const bcOffending = boundaryCheck.ok
                ? []
                : boundaryCheck.offendingPaths;
              const ebcOffending = externalBoundaryCheck.ok
                ? []
                : externalBoundaryCheck.offendingPaths;
              const allOffendingPaths = [...bcOffending, ...ebcOffending];
              if (commit) {
                revertPaths(worktreePath, allOffendingPaths);
              }
              appendBoundaryBlocker(
                finalSpecPath,
                specDirBasename,
                allOffendingPaths,
                targetDir,
              );
              for (const path of allOffendingPaths) {
                opts.io.stderr(`  - ${path}\n`);
              }

              if (commit) {
                try {
                  const agentLabel = reviewResult.agentLabel ?? "unknown";
                  commitPlanBlocker({
                    worktreePath: worktreePath as string,
                    specDirBasename,
                    agentLabel,
                    reason: "write boundary violation",
                    specFilesCount: countSpecFiles(finalSpecPath),
                  });
                  opts.io.stderr(`plan: blocker commit pushed\n`);

                  safeUpdatePrBody({
                    io: opts.io,
                    branch: planBranch,
                    base: baseBranch as string,
                    worktreePath: worktreePath as string,
                    name: planName,
                    specDirBasename,
                  });
                } catch (err) {
                  opts.io.stderr(`${(err as Error).message}\n`);
                  summarizePlan("error", specDirBasename);
                  return 1;
                }
              }

              opts.io.stderr(`plan: blocked\n`);
              summarizePlan("blocker", specDirBasename);
              return 1;
            }

            if (commit) {
              try {
                const agentLabel = reviewResult.agentLabel ?? "unknown";
                const reason = firstNonEmptyLine(validation.blocker);
                const specFilesCount = countSpecFiles(finalSpecPath);

                commitPlanBlocker({
                  worktreePath: worktreePath as string,
                  specDirBasename,
                  agentLabel,
                  reason,
                  specFilesCount,
                });
                opts.io.stderr(`plan: blocker commit pushed\n`);

                safeUpdatePrBody({
                  io: opts.io,
                  branch: planBranch,
                  base: baseBranch as string,
                  worktreePath: worktreePath as string,
                  name: planName,
                  specDirBasename,
                });
              } catch (err) {
                opts.io.stderr(`${(err as Error).message}\n`);
                summarizePlan("error", specDirBasename);
                return 1;
              }
            }

            opts.io.stderr(`plan: blocked\n`);
            if (validation.blocker) {
              opts.io.stderr(`\n## Blocker\n\n${validation.blocker}\n`);
            }
            summarizePlan("blocker", specDirBasename);
            return 1;
          }

          // Check boundary before review commit
          const boundaryCheck = commit
            ? assertPlanWriteBoundary(worktreePath, specDirBasename, targetDir)
            : assertTargetRepoPlanBoundary(project.root);

          // For no-commit runs, also check the external spec directory
          const externalBoundaryCheck: BoundaryCheckResult =
            !commit && externalSpecRoot
              ? assertNoCommitExternalSpecBoundary(
                  externalSpecRoot,
                  specDirBasename,
                )
              : { ok: true };

          const allBoundariesOk = boundaryCheck.ok && externalBoundaryCheck.ok;
          if (!allBoundariesOk) {
            opts.io.stderr(
              `plan: boundary violation detected before review commit\n`,
            );
            const bcOffending = boundaryCheck.ok
              ? []
              : boundaryCheck.offendingPaths;
            const ebcOffending = externalBoundaryCheck.ok
              ? []
              : externalBoundaryCheck.offendingPaths;
            const allOffendingPaths = [...bcOffending, ...ebcOffending];
            if (commit) {
              revertPaths(worktreePath, allOffendingPaths);
            }
            appendBoundaryBlocker(
              finalSpecPath,
              specDirBasename,
              allOffendingPaths,
            );
            for (const path of allOffendingPaths) {
              opts.io.stderr(`  - ${path}\n`);
            }

            if (commit) {
              try {
                const agentLabel = reviewResult.agentLabel ?? "unknown";
                commitPlanBlocker({
                  worktreePath: worktreePath as string,
                  specDirBasename,
                  agentLabel,
                  reason: "write boundary violation",
                  specFilesCount: countSpecFiles(finalSpecPath),
                });
                opts.io.stderr(`plan: blocker commit pushed\n`);

                safeUpdatePrBody({
                  io: opts.io,
                  branch: planBranch,
                  base: baseBranch as string,
                  worktreePath: worktreePath as string,
                  name: planName,
                  specDirBasename,
                });
              } catch (err) {
                opts.io.stderr(`${(err as Error).message}\n`);
                summarizePlan("error", specDirBasename);
                return 1;
              }
            }

            opts.io.stderr(`plan: blocked\n`);
            summarizePlan("blocker", specDirBasename);
            return 1;
          }

          // Commit and push this review pass (when commit: true)
          if (commit) {
            try {
              const agentLabel = reviewResult.agentLabel ?? "unknown";

              commitPlanReview({
                worktreePath: worktreePath as string,
                specDirBasename,
                passNumber: pass,
                agentLabel,
                targetDir,
              });
              opts.io.stderr(
                `plan: review pass ${pass} committed and pushed\n`,
              );

              safeUpdatePrBody({
                io: opts.io,
                branch: planBranch,
                base: baseBranch as string,
                worktreePath: worktreePath as string,
                name: planName,
                specDirBasename,
              });
            } catch (err) {
              opts.io.stderr(`${(err as Error).message}\n`);
              summarizePlan("error", specDirBasename);
              return 1;
            }
          }
        } catch (err) {
          opts.io.stderr(
            `plan: review pass ${pass} error: ${(err as Error).message}\n`,
          );
          summarizePlan("error", specDirBasename);
          return 1;
        }
      }

      if (commit) {
        try {
          const prUrl = getPrUrl(worktreePath as string, planBranch);
          opts.io.stdout(
            renderPlanNextSteps({ prUrl, planName, specDirBasename, targetDir }),
          );
        } catch {
          // best-effort; completion still succeeds without a URL
        }

        safeMarkPlanPrReady({
          io: opts.io,
          branch: planBranch,
          worktreePath: worktreePath as string,
        });
      } else {
        // For commit: false, show the absolute path and jarvis run command
        const noCommitSpecRoot = computeNoCommitSpecRoot(
          CONFIG_DIR,
          project,
          specDirBasename,
        );
        const indexPath = join(noCommitSpecRoot, "index.md");
        opts.io.stdout(
          `Spec written to ${indexPath}\nRun with: jarvis1 run ${indexPath}\n`,
        );
      }
      summarizePlan("complete", specDirBasename);

      return 0;
    }

    // This path is reached when `skipGhCheck` is true (test seam) or when the
    // target is not a git repo: no worktree is created, no commits are made,
    // and plan mode falls through to the not-yet-implemented stub. The
    // interactive case is handled earlier when `planName` is null.
    opts.io.stderr(PLAN_STUB_MESSAGE);
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
  const url = execFileSync(
    "gh",
    ["pr", "view", branch, "--json", "url", "-q", ".url"],
    {
      cwd,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
    },
  );
  return url.trim();
}

/**
 * Wrap `updatePrBody` with the warn-and-continue pattern used throughout
 * plan mode so the caller doesn't repeat the try/catch four times.
 */
function safeUpdatePrBody(args: {
  io: PlanIo;
  branch: string;
  base: string;
  worktreePath: string;
  name: string;
  specDirBasename: string;
}): void {
  try {
    updatePrBody({
      branch: args.branch,
      base: args.base,
      cwd: args.worktreePath,
      headerBuilder: () =>
        buildPlanPrHeader({
          name: args.name,
          specDirBasename: args.specDirBasename,
          worktreePath: args.worktreePath,
        }),
    });
  } catch (err) {
    args.io.stderr(
      `warning: could not update PR body: ${(err as Error).message}\n`,
    );
  }
}

/**
 * Wrap `maybeMarkPlanPrReady` with the warn-and-continue pattern.
 */
export function safeMarkPlanPrReady(args: {
  io: PlanIo;
  branch: string;
  worktreePath: string;
  markReady?: (branch: string, cwd: string) => void;
  getOpenPrState?: (branch: string, cwd: string) => OpenPrInfo;
}): void {
  try {
    maybeMarkPlanPrReady({
      branch: args.branch,
      cwd: args.worktreePath,
      ...(args.markReady ? { markReady: args.markReady } : {}),
      ...(args.getOpenPrState ? { getOpenPrState: args.getOpenPrState } : {}),
    });
  } catch (err) {
    args.io.stderr(
      `warning: could not mark PR ready for review: ${(err as Error).message}\n`,
    );
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

/** Count subspec files under a spec directory matching the `NN-*.md` shape. */
function countSpecFiles(specDirPath: string): number {
  if (!existsSync(specDirPath)) {
    return 0;
  }
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(specDirPath).filter((f) => /^\d{2}-.*\.md$/.test(f))
    .length;
}

/**
 * Try to detect git origin from a project root directory.
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
 * Inject a `repo:` line into the index.md if not already present.
 * Prefers origin URL if available; falls back to detected git origin; falls back to project key.
 */
export function injectRepoLineIntoIndex(
  specDirPath: string,
  project: ProjectMatch,
): void {
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

  // Insert repo: line after the first line (which is usually a heading like # ...)
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0) {
    // Insert after the first line
    lines.splice(1, 0, `repo: ${repoValue}`);
    content = lines.join("\n");
    writeFileSync(indexPath, content, "utf8");
  }
}
