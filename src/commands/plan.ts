import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { loadConfig } from "../config.ts";
import type { LogClient } from "../logging.ts";
import { enterMode } from "../mode-entry.ts";
import {
  appendBoundaryBlocker,
  assertPlanWriteBoundary,
  revertPaths,
} from "../modes/plan/boundary.ts";
import {
  commitPlanBlocker,
  commitPlanDraft,
  commitPlanRefine,
  commitPlanReview,
} from "../modes/plan/commits.ts";
import { runDraftPhase, validateDraftOutput } from "../modes/plan/draft.ts";
import { runNameOnlyPhase } from "../modes/plan/name-only.ts";
import {
  createPlanTelemetryWriter,
  type PlanTelemetryWriter,
} from "../modes/plan/plan-telemetry.ts";
import { buildPlanPrHeader, maybeMarkPlanPrReady } from "../modes/plan/pr.ts";
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

export const PLAN_USAGE = `Usage: jarvis plan [--refine-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [<intent-file|"inline text">]
                            Run plan mode (draft specs under spec/…; see docs/plan-mode.md).
`;

const PLAN_STUB_MESSAGE =
  "plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n";

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

type ResumePrep = {
  planName: string;
  specDirBasename: string;
  worktreePath: string;
  nextResumeIndex: number;
  nextReviewIndex: number;
};

const RESUME_SUBJECT_RE = /^plan: (refine|review \d+|blocker)(?: r(\d+))?$/;
const REVIEW_SUBJECT_RE = /^plan: review (\d+)(?: r\d+)?$/;

function assertResumeIndexPath(specPath: string): {
  planName: string;
  specDirBasename: string;
} {
  const resolved = resolve(specPath);
  const base = basename(resolved);
  if (base !== "index.md") {
    throw new Error(`--resume requires an index.md path; got ${specPath}`);
  }
  const specDirBasename = basename(dirname(resolved));
  return {
    specDirBasename,
    planName: stripPlanSpecTimestampPrefix(specDirBasename),
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
}): ResumePrep {
  const { planName, specDirBasename } = assertResumeIndexPath(args.specPath);
  const worktreePath = join(args.projectRoot, ".worktree", `plan-${planName}`);
  if (!existsSync(worktreePath)) {
    throw new Error(`plan worktree missing at ${worktreePath}`);
  }
  const branch = `plan/${planName}`;
  if (currentBranch(worktreePath) !== branch) {
    throw new Error(`${worktreePath} is not checked out on ${branch}`);
  }
  if (!existsSync(join(worktreePath, "spec", specDirBasename, "index.md"))) {
    throw new Error(
      `missing spec/${specDirBasename}/index.md in ${worktreePath}`,
    );
  }
  if (!existsSync(join(worktreePath, "spec", specDirBasename, "intent.md"))) {
    throw new Error(
      `missing spec/${specDirBasename}/intent.md in ${worktreePath}`,
    );
  }
  if (!isWorktreeClean(worktreePath)) {
    throw new Error(
      `the worktree is not clean; inspect with \`jarvis triage plan-${planName}\` and re-run`,
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
    specDirBasename,
    worktreePath,
    nextResumeIndex: counters.nextResumeIndex,
    nextReviewIndex: counters.nextReviewIndex,
  };
}

export async function deriveSpecName(
  inv: PlanInvocation,
  projectRoot: string,
): Promise<string> {
  let name = derivePlanName(inv);

  // Check reserved names
  if (RESERVED_NAMES.has(name)) {
    name = "plan";
  }

  // Check for collisions and append suffix if needed
  let finalName = name;
  const specDirExists = existsSync(join(projectRoot, "spec", finalName));
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

    const specDirExists = existsSync(join(projectRoot, "spec", finalName));
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
};

export function seedIntentFile(opts: SeedIntentFileOptions): void {
  const specDir = join(opts.worktreePath, "spec", opts.name);
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
        "could not determine a target project for this intent and no projects are registered. Run `jarvis init` in a target repo, or pass --repo <name|url>.\n",
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

    if (inv.mode === "interactive" && (inv.refineTurns ?? 3) === 0) {
      opts.io.stderr(
        "plan: --refine-turns 0 is incompatible with interactive mode\n(no intent text was provided)\n",
      );
      return 1;
    }

    if (inv.resume) {
      if (inv.mode === "interactive") {
        opts.io.stderr("--resume requires a spec path\n");
        return 1;
      }
      if (inv.mode !== "file") {
        opts.io.stderr("--resume cannot be combined with intent text/file\n");
        return 1;
      }
      const reviewPasses = inv.reviewPasses ?? 2;
      const refineTurns = inv.refineTurns ?? 0;
      if (reviewPasses === 0 && refineTurns === 0) {
        opts.io.stderr("--resume requires at least one phase\n");
        return 1;
      }

      let resume: ResumePrep;
      try {
        resume = prepareResume({
          projectRoot: project.root,
          specPath: inv.intentPath,
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
          specPathForSummary: `spec/${resume.specDirBasename}/index.md`,
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
                resume.worktreePath,
                resume.specDirBasename,
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

      for (let pass = 1; pass <= reviewPasses; pass += 1) {
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          summarizeResume("sigint");
          return 130;
        }
        const intentPath = join(
          resume.worktreePath,
          "spec",
          resume.specDirBasename,
          "intent.md",
        );
        const intentBefore = readFileSync(intentPath, "utf8");
        const result = await runReviewPass({
          worktreePath: resume.worktreePath,
          name: resume.specDirBasename,
          config: cfg,
          passNumber: nextReviewIndex,
          totalPasses: nextReviewIndex + reviewPasses - pass,
          stderr: opts.io.stderr,
          planTelemetry: resumePlanTelemetry,
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
              resume.worktreePath,
              resume.specDirBasename,
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

    // Create worktree for file or inline mode (only if it's a git repo and gh is available)
    const isGitRepo = existsSync(join(project.root, ".git"));
    let worktreePath: string | null = null;
    if (!opts.skipGhCheck && isGitRepo) {
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

      // Seed the intent.md file into the worktree
      try {
        if (inv.mode === "file") {
          seedIntentFile({
            worktreePath,
            name: specDirBasename,
            mode: "file",
            intentPath: inv.intentPath,
          });
        } else if (inv.mode === "inline") {
          seedIntentFile({
            worktreePath,
            name: specDirBasename,
            mode: "inline",
            intentText: inv.intentText,
          });
        } else {
          seedIntentFile({
            worktreePath,
            name: specDirBasename,
            mode: "interactive",
          });
        }
      } catch (err) {
        opts.io.stderr(
          `failed to seed intent file: ${(err as Error).message}\n`,
        );
        return 1;
      }

      // Load config once for use in refine and draft phases
      const cfg = loadConfig(opts.config);

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
          });

          // Handle refine result
          if (refineResult.result.kind !== "ok") {
            if (refineResult.result.kind === "quota") {
              opts.io.stderr(
                `plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} during refine\n`,
              );
              summarizePlan("quota-exhausted", specDirBasename);
              return 2;
            }
            if (refineResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan: model configuration error\n${refineResult.result.stderr}`,
              );
              summarizePlan("model-config", specDirBasename);
              return 3;
            }
            // Generic error
            opts.io.stderr(
              `plan: refine phase failed\n${refineResult.result.stderr}`,
            );
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
          });
          if (namingResult.result.kind !== "ok") {
            if (namingResult.result.kind === "quota") {
              opts.io.stderr(
                `plan: ${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} during naming-only phase\n`,
              );
              summarizePlan("quota-exhausted", specDirBasename);
              return 2;
            }
            if (namingResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan: model configuration error\n${namingResult.result.stderr}`,
              );
              summarizePlan("model-config", specDirBasename);
              return 3;
            }
            opts.io.stderr(
              `plan: naming-only phase failed\n${namingResult.result.stderr}`,
            );
            summarizePlan("agent-error", specDirBasename);
            return 1;
          }
        }
      } catch (err) {
        opts.io.stderr(`plan: refine phase error: ${(err as Error).message}\n`);
        summarizePlan("error", specDirBasename);
        return 1;
      }

      const tempIntentPath = join(
        worktreePath,
        "spec",
        specDirBasename,
        "intent.md",
      );
      const tempIntent = readFileSync(tempIntentPath, "utf8");
      const parsedName = parseIntentFrontmatter(tempIntent).name;
      const validation = validateProposedName(parsedName);
      let chosenBaseName: string;
      if (validation.valid && validation.normalized !== undefined) {
        chosenBaseName = validation.normalized;
      } else {
        chosenBaseName = await deriveSpecName(inv, project.root);
        opts.io.stderr(
          `plan: agent did not propose a valid name; falling back to deterministic derivation (${chosenBaseName})\n`,
        );
      }
      planName = await ensureUniquePlanName(project.root, chosenBaseName);
      const timestampPrefix = formatPlanSpecTimestamp();
      specDirBasename = `${timestampPrefix}-${planName}`;
      planHarnessLog(planLogClient, `plan: spec name=${planName}`);

      const finalIntentBody = tempIntent.startsWith("---\n")
        ? tempIntent.replace(
            /^---\n[\s\S]*?\n---/,
            `---\nname: ${planName}\n---`,
          )
        : `---\nname: ${planName}\n---\n\n${tempIntent}`;
      writeFileSync(tempIntentPath, finalIntentBody, "utf8");

      try {
        renameSync(
          join(worktreePath, "spec", tempPlanName),
          join(worktreePath, "spec", specDirBasename),
        );
      } catch (err) {
        opts.io.stderr(
          `plan: failed to rename spec directory: ${(err as Error).message}\n`,
        );
        summarizePlan("error", specDirBasename);
        return 1;
      }

      try {
        execFileSync(
          "git",
          ["branch", "-m", `plan/${tempPlanName}`, `plan/${planName}`],
          {
            cwd: worktreePath,
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
          ["worktree", "move", worktreePath, nextWorktreePath],
          {
            cwd: project.root,
            stdio: "pipe",
          },
        );
        worktreePath = nextWorktreePath;
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

      // Check for interrupt before any commit
      if (interrupted) {
        opts.io.stderr(`plan: interrupted\n`);
        summarizePlan("sigint", specDirBasename);
        return 130;
      }

      // If a blocker was raised during refine, commit it and stop
      if (refineBlocker !== undefined) {
        try {
          // Create the refine commit first (with the blocked state)
          const intentPathOrLabel =
            inv.mode === "file"
              ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
              : inv.mode === "inline"
                ? (inv as Extract<typeof inv, { mode: "inline" }>).intentText
                : "interactive";
          commitPlanRefine({
            worktreePath,
            specDirBasename,
            mode: inv.mode as "file" | "inline" | "interactive",
            intentPathOrLabel,
            completedTurns: refineCompletedTurns,
            refineOutcome: "blocker",
          });
          opts.io.stderr(`plan: refine commit pushed\n`);

          // Then create the blocker commit
          const agentLabel = refineAgentLabel ?? "unknown";
          const reason = firstNonEmptyLine(refineBlocker);

          commitPlanBlocker({
            worktreePath,
            specDirBasename,
            agentLabel,
            reason,
            specFilesCount: 0,
          });
          opts.io.stderr(`plan: blocker commit pushed\n`);

          safeUpdatePrBody({
            io: opts.io,
            branch: `plan/${planName}`,
            base: getCurrentBranch(project.root),
            worktreePath,
            name: planName,
            specDirBasename,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizePlan("error", specDirBasename);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
        if (refineBlocker) {
          opts.io.stderr(`\n## Blocker\n\n${refineBlocker}\n`);
        }
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Create plan: refine commit and push
      try {
        const intentPathOrLabel =
          inv.mode === "file"
            ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
            : inv.mode === "inline"
              ? (inv as Extract<typeof inv, { mode: "inline" }>).intentText
              : "interactive";
        commitPlanRefine({
          worktreePath,
          specDirBasename,
          mode: inv.mode as "file" | "inline" | "interactive",
          intentPathOrLabel,
          completedTurns: refineCompletedTurns,
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

      // Run draft phase: invoke agent to generate spec tree
      let draftResult: Awaited<ReturnType<typeof runDraftPhase>>;
      let draftBlocker: string | undefined;
      let draftSpecFilesCount = 0;
      try {
        // Read intent.md before the draft phase
        const intentPath = join(
          worktreePath,
          "spec",
          specDirBasename,
          "intent.md",
        );
        const intentBefore = readFileSync(intentPath, "utf8");

        draftResult = await runDraftPhase({
          worktreePath,
          name: specDirBasename,
          config: cfg,
          intentBefore,
          stderr: opts.io.stderr,
          planTelemetry: planTelemetryWriter,
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
      } catch (err) {
        opts.io.stderr(`plan: draft phase error: ${(err as Error).message}\n`);
        summarizePlan("error", specDirBasename);
        return 1;
      }

      // Cache the base branch once for subsequent gh/git calls.
      const baseBranch = getCurrentBranch(project.root);
      const planBranch = `plan/${planName}`;

      // Check boundary before draft commit
      const boundaryCheck = assertPlanWriteBoundary(
        worktreePath,
        specDirBasename,
      );
      if (!boundaryCheck.ok) {
        opts.io.stderr(
          `plan: boundary violation detected before draft commit\n`,
        );
        revertPaths(worktreePath, boundaryCheck.offendingPaths);
        appendBoundaryBlocker(
          worktreePath,
          specDirBasename,
          boundaryCheck.offendingPaths,
        );
        for (const path of boundaryCheck.offendingPaths) {
          opts.io.stderr(`  - ${path}\n`);
        }

        try {
          const agentLabel = draftResult.agentLabel ?? "unknown";
          commitPlanBlocker({
            worktreePath,
            specDirBasename,
            agentLabel,
            reason: "write boundary violation",
            specFilesCount: draftSpecFilesCount,
          });
          opts.io.stderr(`plan: blocker commit pushed\n`);

          safeUpdatePrBody({
            io: opts.io,
            branch: planBranch,
            base: baseBranch,
            worktreePath,
            name: planName,
            specDirBasename,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizePlan("error", specDirBasename);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Always create a `plan: draft` commit for whatever the agent produced
      // (per docs/plan-mode.md: draft files are committed as `plan: draft`,
      // even when a blocker is raised in the same pass). Then, if a blocker
      // was raised, append a separate `plan: blocker` commit and stop.
      try {
        const agentLabel = draftResult.agentLabel ?? "unknown";

        commitPlanDraft({
          worktreePath,
          specDirBasename,
          agentLabel,
          subspecCount: draftSpecFilesCount,
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
          base: baseBranch,
          title: `plan: ${planName}`,
          bodyGenerator: async () =>
            buildPlanPrHeader({
              name: planName,
              specDirBasename,
              worktreePath: worktreePath as string,
            }),
          footer: renderAttribution({
            cwd: worktreePath,
            base: baseBranch,
          }),
          cwd: worktreePath,
        });
        const prUrl = getPrUrl(worktreePath, planBranch);
        opts.io.stdout(`${prUrl}\n`);
        opts.io.stderr(`plan: draft PR #${prResult.number} opened\n`);
      } catch (err) {
        opts.io.stderr(
          `warning: could not open draft PR: ${(err as Error).message}\n`,
        );
        // Continue; downstream commits still push, and the PR can be opened
        // manually if needed.
      }

      // If a blocker was raised during the draft phase, commit it on top of
      // `plan: draft` and stop.
      if (draftBlocker !== undefined) {
        try {
          const agentLabel = draftResult.agentLabel ?? "unknown";
          const reason = firstNonEmptyLine(draftBlocker);

          commitPlanBlocker({
            worktreePath,
            specDirBasename,
            agentLabel,
            reason,
            specFilesCount: draftSpecFilesCount,
          });
          opts.io.stderr(`plan: blocker commit pushed\n`);

          safeUpdatePrBody({
            io: opts.io,
            branch: planBranch,
            base: baseBranch,
            worktreePath,
            name: planName,
            specDirBasename,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          summarizePlan("error", specDirBasename);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
        if (draftBlocker) {
          opts.io.stderr(`\n## Blocker\n\n${draftBlocker}\n`);
        }
        summarizePlan("blocker", specDirBasename);
        return 1;
      }

      // Post-draft body refresh (header now reflects the real index.md).
      safeUpdatePrBody({
        io: opts.io,
        branch: planBranch,
        base: baseBranch,
        worktreePath,
        name: planName,
        specDirBasename,
      });

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
          const intentPath = join(
            worktreePath,
            "spec",
            specDirBasename,
            "intent.md",
          );
          const intentBefore = readFileSync(intentPath, "utf8");

          // Run the review pass
          const reviewResult = await runReviewPass({
            worktreePath,
            name: specDirBasename,
            config: cfg,
            passNumber: pass,
            totalPasses: reviewPasses,
            stderr: opts.io.stderr,
            planTelemetry: planTelemetryWriter,
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
          if (!hasWorkingTreeChanges(worktreePath)) {
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
            const boundaryCheck = assertPlanWriteBoundary(
              worktreePath,
              specDirBasename,
            );
            if (!boundaryCheck.ok) {
              opts.io.stderr(
                `plan: boundary violation detected before review blocker commit\n`,
              );
              revertPaths(worktreePath, boundaryCheck.offendingPaths);
              appendBoundaryBlocker(
                worktreePath,
                specDirBasename,
                boundaryCheck.offendingPaths,
              );
              for (const path of boundaryCheck.offendingPaths) {
                opts.io.stderr(`  - ${path}\n`);
              }

              try {
                const agentLabel = reviewResult.agentLabel ?? "unknown";
                commitPlanBlocker({
                  worktreePath,
                  specDirBasename,
                  agentLabel,
                  reason: "write boundary violation",
                  specFilesCount: countSpecFiles(worktreePath, specDirBasename),
                });
                opts.io.stderr(`plan: blocker commit pushed\n`);

                safeUpdatePrBody({
                  io: opts.io,
                  branch: planBranch,
                  base: baseBranch,
                  worktreePath,
                  name: planName,
                  specDirBasename,
                });
              } catch (err) {
                opts.io.stderr(`${(err as Error).message}\n`);
                summarizePlan("error", specDirBasename);
                return 1;
              }

              opts.io.stderr(`plan: blocked\n`);
              summarizePlan("blocker", specDirBasename);
              return 1;
            }

            try {
              const agentLabel = reviewResult.agentLabel ?? "unknown";
              const reason = firstNonEmptyLine(validation.blocker);
              const specFilesCount = countSpecFiles(
                worktreePath,
                specDirBasename,
              );

              commitPlanBlocker({
                worktreePath,
                specDirBasename,
                agentLabel,
                reason,
                specFilesCount,
              });
              opts.io.stderr(`plan: blocker commit pushed\n`);

              safeUpdatePrBody({
                io: opts.io,
                branch: planBranch,
                base: baseBranch,
                worktreePath,
                name: planName,
                specDirBasename,
              });
            } catch (err) {
              opts.io.stderr(`${(err as Error).message}\n`);
              summarizePlan("error", specDirBasename);
              return 1;
            }

            opts.io.stderr(`plan: blocked\n`);
            if (validation.blocker) {
              opts.io.stderr(`\n## Blocker\n\n${validation.blocker}\n`);
            }
            summarizePlan("blocker", specDirBasename);
            return 1;
          }

          // Check boundary before review commit
          const boundaryCheck = assertPlanWriteBoundary(
            worktreePath,
            specDirBasename,
          );
          if (!boundaryCheck.ok) {
            opts.io.stderr(
              `plan: boundary violation detected before review commit\n`,
            );
            revertPaths(worktreePath, boundaryCheck.offendingPaths);
            appendBoundaryBlocker(
              worktreePath,
              specDirBasename,
              boundaryCheck.offendingPaths,
            );
            for (const path of boundaryCheck.offendingPaths) {
              opts.io.stderr(`  - ${path}\n`);
            }

            try {
              const agentLabel = reviewResult.agentLabel ?? "unknown";
              commitPlanBlocker({
                worktreePath,
                specDirBasename,
                agentLabel,
                reason: "write boundary violation",
                specFilesCount: countSpecFiles(worktreePath, specDirBasename),
              });
              opts.io.stderr(`plan: blocker commit pushed\n`);

              safeUpdatePrBody({
                io: opts.io,
                branch: planBranch,
                base: baseBranch,
                worktreePath,
                name: planName,
                specDirBasename,
              });
            } catch (err) {
              opts.io.stderr(`${(err as Error).message}\n`);
              summarizePlan("error", specDirBasename);
              return 1;
            }

            opts.io.stderr(`plan: blocked\n`);
            summarizePlan("blocker", specDirBasename);
            return 1;
          }

          // Commit and push this review pass
          try {
            const agentLabel = reviewResult.agentLabel ?? "unknown";

            commitPlanReview({
              worktreePath,
              specDirBasename,
              passNumber: pass,
              agentLabel,
            });
            opts.io.stderr(`plan: review pass ${pass} committed and pushed\n`);

            safeUpdatePrBody({
              io: opts.io,
              branch: planBranch,
              base: baseBranch,
              worktreePath,
              name: planName,
              specDirBasename,
            });
          } catch (err) {
            opts.io.stderr(`${(err as Error).message}\n`);
            summarizePlan("error", specDirBasename);
            return 1;
          }
        } catch (err) {
          opts.io.stderr(
            `plan: review pass ${pass} error: ${(err as Error).message}\n`,
          );
          summarizePlan("error", specDirBasename);
          return 1;
        }
      }

      try {
        const prUrl = getPrUrl(worktreePath, planBranch);
        opts.io.stdout(
          renderPlanNextSteps({ prUrl, planName, specDirBasename }),
        );
      } catch {
        // best-effort; completion still succeeds without a URL
      }
      summarizePlan("complete", specDirBasename);

      safeMarkPlanPrReady({
        io: opts.io,
        branch: planBranch,
        worktreePath,
      });

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
}): string {
  const specDirBasename = args.specDirBasename ?? args.specName;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  return [
    "",
    "Next steps:",
    `  1. Review the draft PR: ${args.prUrl}`,
    `  2. Edit spec/${specDirBasename}/ on the plan branch as needed (locally or`,
    "     through GitHub), or run `jarvis plan --resume",
    `     spec/${specDirBasename}/index.md\` for another self-review pass.`,
    "  3. After the merge, implement the spec with:",
    `       jarvis run spec/${specDirBasename}/index.md`,
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
function safeMarkPlanPrReady(args: {
  io: PlanIo;
  branch: string;
  worktreePath: string;
}): void {
  try {
    maybeMarkPlanPrReady({
      branch: args.branch,
      cwd: args.worktreePath,
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

/** Count subspec files under `spec/<name>/` matching the `NN-*.md` shape. */
function countSpecFiles(worktreePath: string, name: string): number {
  const specDir = join(worktreePath, "spec", name);
  if (!existsSync(specDir)) {
    return 0;
  }
  // Lazy import to avoid pulling fs at module top for a single helper.
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(specDir).filter((f) => /^\d{2}-.*\.md$/.test(f)).length;
}
