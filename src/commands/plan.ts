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
  commitPlanInterview,
  commitPlanReview,
} from "../modes/plan/commits.ts";
import { runDraftPhase, validateDraftOutput } from "../modes/plan/draft.ts";
import { runInterviewPhase } from "../modes/plan/interview.ts";
import { runNameOnlyPhase } from "../modes/plan/name-only.ts";
import { buildPlanPrHeader } from "../modes/plan/pr.ts";
import {
  hasWorkingTreeChanges,
  runReviewPass,
  validateReviewOutput,
} from "../modes/plan/review.ts";
import { ensureDraftPr, renderAttribution, updatePrBody } from "../pr.ts";
import type { resolveTargetRepo } from "../repo.ts";
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

export const PLAN_USAGE = `Usage: jarvis plan [--interview-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [<intent-file|"inline text">]
                            Generate a spec tree from an intent. (planning behavior arrives in later specs)
`;

const PLAN_STUB_MESSAGE =
  "jarvis plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n";

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatShortTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}${minute}`;
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
      return `interactive-${formatShortTimestamp(new Date())}`;
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
  name: string;
  worktreePath: string;
  nextResumeIndex: number;
  nextReviewIndex: number;
};

const RESUME_SUBJECT_RE = /^plan: (interview|review \d+|blocker)(?: r(\d+))?$/;
const REVIEW_SUBJECT_RE = /^plan: review (\d+)(?: r\d+)?$/;

function assertResumeIndexPath(specPath: string): string {
  const resolved = resolve(specPath);
  const base = basename(resolved);
  if (base !== "index.md") {
    throw new Error(`--resume requires an index.md path; got ${specPath}`);
  }
  return basename(dirname(resolved));
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
  const name = assertResumeIndexPath(args.specPath);
  const worktreePath = join(args.projectRoot, ".worktree", `plan-${name}`);
  if (!existsSync(worktreePath)) {
    throw new Error(`plan worktree missing at ${worktreePath}`);
  }
  const branch = `plan/${name}`;
  if (currentBranch(worktreePath) !== branch) {
    throw new Error(`${worktreePath} is not checked out on ${branch}`);
  }
  if (!existsSync(join(worktreePath, "spec", name, "index.md"))) {
    throw new Error(`missing spec/${name}/index.md in ${worktreePath}`);
  }
  if (!existsSync(join(worktreePath, "spec", name, "intent.md"))) {
    throw new Error(`missing spec/${name}/intent.md in ${worktreePath}`);
  }
  if (!isWorktreeClean(worktreePath)) {
    throw new Error(
      `the worktree is not clean; inspect with \`jarvis triage plan-${name}\` and re-run`,
    );
  }
  if (!remoteSpecBranchExists(args.projectRoot, name)) {
    throw new Error(`plan branch plan/${name} is not on origin; cannot resume`);
  }
  const counters = computeResumeCounters(worktreePath);
  return {
    name,
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
      "# Intent\n\n(Interactive session — no seed text. The interview will gather\nthe intent.)\n";
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
    opts.io.stderr(`${describePlanInvocation(result.invocation)}\n`);

    const inv = result.invocation;
    if (inv.mode === "interactive") {
      opts.io.stderr("plan mode: interactive session started\n");
    }
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

    const project = entry.resolution.resolved.project;
    opts.io.stderr(
      `plan mode: target project=${project.key} root=${project.root}\n`,
    );

    if (inv.mode === "interactive" && (inv.interviewTurns ?? 3) === 0) {
      opts.io.stderr(
        "plan: --interview-turns 0 is incompatible with interactive mode\n(no intent text was provided)\n",
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
      const interviewTurns = inv.interviewTurns ?? 0;
      if (reviewPasses === 0 && interviewTurns === 0) {
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

      const branch = `plan/${resume.name}`;
      const suffix = `r${resume.nextResumeIndex}`;
      let nextReviewIndex = resume.nextReviewIndex;
      opts.io.stderr(`plan mode: resume ${suffix} started\n`);

      const cfg = loadConfig(opts.config);
      if (interviewTurns > 0) {
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          return 130;
        }
        try {
          const interviewResult = await runInterviewPhase({
            worktreePath: resume.worktreePath,
            name: resume.name,
            config: cfg,
            interviewTurns,
          });
          if (interviewResult.result.kind !== "ok") {
            if (interviewResult.result.kind === "quota") {
              opts.io.stderr(`plan: quota exhausted\n`);
              return 2;
            }
            if (interviewResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan mode: model configuration error\n${interviewResult.result.stderr}`,
              );
              return 3;
            }
            opts.io.stderr(
              `plan mode: interview phase failed\n${interviewResult.result.stderr}`,
            );
            return 1;
          }
          if (interrupted) {
            opts.io.stderr(`plan: interrupted\n`);
            return 130;
          }
          if (hasWorkingTreeChanges(resume.worktreePath)) {
            commitPlanInterview({
              worktreePath: resume.worktreePath,
              name: resume.name,
              mode: "interactive",
              intentPathOrLabel: "interactive",
              completedTurns: interviewResult.completedTurns,
              subjectSuffix: suffix,
              resumedBy: interviewResult.agentLabel ?? "unknown",
            });
          }
          if (interviewResult.blocker !== undefined) {
            commitPlanBlocker({
              worktreePath: resume.worktreePath,
              name: resume.name,
              agentLabel: interviewResult.agentLabel ?? "unknown",
              reason: firstNonEmptyLine(interviewResult.blocker),
              specFilesCount: countSpecFiles(resume.worktreePath, resume.name),
              subjectSuffix: suffix,
            });
            safeUpdatePrBody({
              io: opts.io,
              branch,
              base: getCurrentBranch(project.root),
              worktreePath: resume.worktreePath,
              name: resume.name,
            });
            opts.io.stderr(`plan: blocked\n`);
            opts.io.stderr(`\n## Blocker\n\n${interviewResult.blocker}\n`);
            return 1;
          }
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          return 1;
        }
      }

      for (let pass = 1; pass <= reviewPasses; pass += 1) {
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          return 130;
        }
        const intentPath = join(
          resume.worktreePath,
          "spec",
          resume.name,
          "intent.md",
        );
        const intentBefore = readFileSync(intentPath, "utf8");
        const result = await runReviewPass({
          worktreePath: resume.worktreePath,
          name: resume.name,
          config: cfg,
          passNumber: nextReviewIndex,
          totalPasses: nextReviewIndex + reviewPasses - pass,
        });
        if (result.result.kind !== "ok") {
          if (result.result.kind === "quota") {
            opts.io.stderr(`plan: quota exhausted\n`);
            return 2;
          }
          if (result.result.kind === "model_config") {
            opts.io.stderr(
              `plan mode: model configuration error: ${result.result.stderr}\n`,
            );
            return 3;
          }
          opts.io.stderr(
            `plan mode: review pass ${nextReviewIndex} failed: ${result.result.stderr}\n`,
          );
          return 1;
        }
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          return 130;
        }

        if (!hasWorkingTreeChanges(resume.worktreePath)) {
          nextReviewIndex += 1;
          continue;
        }

        const validation = validateReviewOutput(
          resume.worktreePath,
          resume.name,
          intentBefore,
        );
        if (!validation.valid) {
          opts.io.stderr(
            `plan mode: review pass ${nextReviewIndex} validation failed: ${validation.error}\n`,
          );
          return 1;
        }
        if (validation.blocker !== undefined) {
          commitPlanBlocker({
            worktreePath: resume.worktreePath,
            name: resume.name,
            agentLabel: result.agentLabel ?? "unknown",
            reason: firstNonEmptyLine(validation.blocker),
            specFilesCount: countSpecFiles(resume.worktreePath, resume.name),
            subjectSuffix: suffix,
          });
          safeUpdatePrBody({
            io: opts.io,
            branch,
            base: getCurrentBranch(project.root),
            worktreePath: resume.worktreePath,
            name: resume.name,
          });
          opts.io.stderr(`plan: blocked\n`);
          opts.io.stderr(`\n## Blocker\n\n${validation.blocker}\n`);
          return 1;
        }

        commitPlanReview({
          worktreePath: resume.worktreePath,
          name: resume.name,
          passNumber: nextReviewIndex,
          agentLabel: result.agentLabel ?? "unknown",
          subjectSuffix: suffix,
        });
        safeUpdatePrBody({
          io: opts.io,
          branch,
          base: getCurrentBranch(project.root),
          worktreePath: resume.worktreePath,
          name: resume.name,
        });
        nextReviewIndex += 1;
      }

      opts.io.stderr(`plan: complete (resume ${suffix})\n`);
      return 0;
    }

    const tempId = crypto.randomUUID().slice(0, 8);
    const tempPlanName = `${TEMP_PLAN_PREFIX}${tempId}`;
    let specName = tempPlanName;
    opts.io.stderr(`plan mode: temporary plan name=${tempPlanName}\n`);

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
        opts.io.stderr(`plan mode: worktree created at ${worktreePath}\n`);
      } catch (err) {
        const message = (err as Error).message;
        // Handle local-only branch collision with a specific error message
        if (
          message.includes("already exists") &&
          message.includes(".worktree")
        ) {
          opts.io.stderr(
            `plan: local branch plan/${specName} already exists; delete it with \`git branch -D plan/${specName}\` and re-run\n`,
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
            name: specName,
            mode: "file",
            intentPath: inv.intentPath,
          });
        } else if (inv.mode === "inline") {
          seedIntentFile({
            worktreePath,
            name: specName,
            mode: "inline",
            intentText: inv.intentText,
          });
        } else {
          seedIntentFile({
            worktreePath,
            name: specName,
            mode: "interactive",
          });
        }
      } catch (err) {
        opts.io.stderr(
          `failed to seed intent file: ${(err as Error).message}\n`,
        );
        return 1;
      }

      // Load config once for use in interview and draft phases
      const cfg = loadConfig(opts.config);

      // Run interview phase
      let interviewCompletedTurns = 0;
      let interviewBlocker: string | undefined;
      let interviewAgentLabel: string | null = null;

      try {
        const interviewBudget = inv.interviewTurns ?? 3;

        if (interviewBudget > 0) {
          const interviewResult = await runInterviewPhase({
            worktreePath,
            name: specName,
            config: cfg,
            interviewTurns: interviewBudget,
          });

          // Handle interview result
          if (interviewResult.result.kind !== "ok") {
            if (interviewResult.result.kind === "quota") {
              opts.io.stderr(`plan: quota exhausted during interview\n`);
              return 2;
            }
            if (interviewResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan mode: model configuration error\n${interviewResult.result.stderr}`,
              );
              return 3;
            }
            // Generic error
            opts.io.stderr(
              `plan mode: interview phase failed\n${interviewResult.result.stderr}`,
            );
            return 1;
          }

          interviewCompletedTurns = interviewResult.completedTurns;
          interviewAgentLabel = interviewResult.agentLabel;
          interviewBlocker = interviewResult.blocker;
        } else if (inv.mode !== "interactive") {
          const namingResult = await runNameOnlyPhase({
            worktreePath,
            name: specName,
            config: cfg,
          });
          if (namingResult.result.kind !== "ok") {
            if (namingResult.result.kind === "quota") {
              opts.io.stderr(
                `plan: quota exhausted during naming-only phase\n`,
              );
              return 2;
            }
            if (namingResult.result.kind === "model_config") {
              opts.io.stderr(
                `plan mode: model configuration error\n${namingResult.result.stderr}`,
              );
              return 3;
            }
            opts.io.stderr(
              `plan mode: naming-only phase failed\n${namingResult.result.stderr}`,
            );
            return 1;
          }
        }
      } catch (err) {
        opts.io.stderr(
          `plan mode: interview phase error: ${(err as Error).message}\n`,
        );
        return 1;
      }

      const tempIntentPath = join(worktreePath, "spec", specName, "intent.md");
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
      specName = await ensureUniquePlanName(project.root, chosenBaseName);
      opts.io.stderr(`plan mode: spec name=${specName}\n`);

      const finalIntentBody = tempIntent.startsWith("---\n")
        ? tempIntent.replace(
            /^---\n[\s\S]*?\n---/,
            `---\nname: ${specName}\n---`,
          )
        : `---\nname: ${specName}\n---\n\n${tempIntent}`;
      writeFileSync(tempIntentPath, finalIntentBody, "utf8");

      try {
        renameSync(
          join(worktreePath, "spec", tempPlanName),
          join(worktreePath, "spec", specName),
        );
      } catch (err) {
        opts.io.stderr(
          `plan mode: failed to rename spec directory: ${(err as Error).message}\n`,
        );
        return 1;
      }

      try {
        execFileSync(
          "git",
          ["branch", "-m", `plan/${tempPlanName}`, `plan/${specName}`],
          {
            cwd: worktreePath,
            stdio: "pipe",
          },
        );
        const nextWorktreePath = join(
          project.root,
          ".worktree",
          `plan-${specName}`,
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
        opts.io.stderr(
          `plan mode: renamed worktree and branch to plan/${specName}\n`,
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
        return 1;
      }

      // Check for interrupt before any commit
      if (interrupted) {
        opts.io.stderr(`plan: interrupted\n`);
        return 130;
      }

      // If a blocker was raised during interview, commit it and stop
      if (interviewBlocker !== undefined) {
        try {
          // Create the interview commit first (with the blocked state)
          const intentPathOrLabel =
            inv.mode === "file"
              ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
              : inv.mode === "inline"
                ? (inv as Extract<typeof inv, { mode: "inline" }>).intentText
                : "interactive";
          commitPlanInterview({
            worktreePath,
            name: specName,
            mode: inv.mode as "file" | "inline" | "interactive",
            intentPathOrLabel,
            completedTurns: interviewCompletedTurns,
          });
          opts.io.stderr(`plan mode: interview commit pushed\n`);

          // Then create the blocker commit
          const agentLabel = interviewAgentLabel ?? "unknown";
          const reason = firstNonEmptyLine(interviewBlocker);

          commitPlanBlocker({
            worktreePath,
            name: specName,
            agentLabel,
            reason,
            specFilesCount: 0,
          });
          opts.io.stderr(`plan mode: blocker commit pushed\n`);

          safeUpdatePrBody({
            io: opts.io,
            branch: `plan/${specName}`,
            base: getCurrentBranch(project.root),
            worktreePath,
            name: specName,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
        if (interviewBlocker) {
          opts.io.stderr(`\n## Blocker\n\n${interviewBlocker}\n`);
        }
        return 1;
      }

      // Create plan: interview commit and push
      try {
        const intentPathOrLabel =
          inv.mode === "file"
            ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
            : inv.mode === "inline"
              ? (inv as Extract<typeof inv, { mode: "inline" }>).intentText
              : "interactive";
        commitPlanInterview({
          worktreePath,
          name: specName,
          mode: inv.mode as "file" | "inline" | "interactive",
          intentPathOrLabel,
          completedTurns: interviewCompletedTurns,
        });
        opts.io.stderr(`plan mode: interview commit pushed\n`);
      } catch (err) {
        opts.io.stderr(`${(err as Error).message}\n`);
        return 1;
      }

      // Run draft phase: invoke agent to generate spec tree
      let draftResult: Awaited<ReturnType<typeof runDraftPhase>>;
      let draftBlocker: string | undefined;
      let draftSpecFilesCount = 0;
      try {
        // Read intent.md before the draft phase
        const intentPath = join(worktreePath, "spec", specName, "intent.md");
        const intentBefore = readFileSync(intentPath, "utf8");

        draftResult = await runDraftPhase({
          worktreePath,
          name: specName,
          config: cfg,
          intentBefore,
        });

        // Check if draft succeeded
        if (draftResult.result.kind !== "ok") {
          if (draftResult.result.kind === "quota") {
            opts.io.stderr(`plan: quota exhausted\n`);
            return 2;
          }
          if (draftResult.result.kind === "model_config") {
            opts.io.stderr(
              `plan mode: model configuration error\n${draftResult.result.stderr}`,
            );
            return 3;
          }
          // Generic error
          opts.io.stderr(
            `plan mode: draft phase failed\n${draftResult.result.stderr}`,
          );
          return 1;
        }

        // Check for interrupt before any commit
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          return 130;
        }

        // Validate output
        const validation = validateDraftOutput(
          worktreePath,
          specName,
          intentBefore,
        );
        if (!validation.valid) {
          opts.io.stderr(
            `plan mode: draft validation failed: ${validation.error}\n`,
          );
          return 1;
        }

        // Check if a blocker was raised
        if (validation.blocker !== undefined) {
          draftBlocker = validation.blocker;
        }

        draftSpecFilesCount = draftResult.subspecCount ?? 0;
        if (draftBlocker === undefined && draftResult.subspecCount === null) {
          opts.io.stderr(`plan mode: could not count subspecs\n`);
          return 1;
        }

        opts.io.stderr(`plan mode: draft phase completed\n`);
      } catch (err) {
        opts.io.stderr(
          `plan mode: draft phase error: ${(err as Error).message}\n`,
        );
        return 1;
      }

      // Cache the base branch once for subsequent gh/git calls.
      const baseBranch = getCurrentBranch(project.root);
      const planBranch = `plan/${specName}`;

      // Check boundary before draft commit
      const boundaryCheck = assertPlanWriteBoundary(worktreePath, specName);
      if (!boundaryCheck.ok) {
        opts.io.stderr(
          `plan: boundary violation detected before draft commit\n`,
        );
        revertPaths(worktreePath, boundaryCheck.offendingPaths);
        appendBoundaryBlocker(
          worktreePath,
          specName,
          boundaryCheck.offendingPaths,
        );
        for (const path of boundaryCheck.offendingPaths) {
          opts.io.stderr(`  - ${path}\n`);
        }

        try {
          const agentLabel = draftResult.agentLabel ?? "unknown";
          commitPlanBlocker({
            worktreePath,
            name: specName,
            agentLabel,
            reason: "write boundary violation",
            specFilesCount: draftSpecFilesCount,
          });
          opts.io.stderr(`plan mode: blocker commit pushed\n`);

          safeUpdatePrBody({
            io: opts.io,
            branch: planBranch,
            base: baseBranch,
            worktreePath,
            name: specName,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
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
          name: specName,
          agentLabel,
          subspecCount: draftSpecFilesCount,
        });
        opts.io.stderr(`plan mode: draft commit pushed\n`);
      } catch (err) {
        opts.io.stderr(`${(err as Error).message}\n`);
        return 1;
      }

      // Open the draft PR now that the first `plan: draft` commit is on the
      // remote. Subsequent commits update the body via `updatePrBody`.
      try {
        const prResult = await ensureDraftPr({
          branch: planBranch,
          base: baseBranch,
          title: `plan: ${specName}`,
          bodyGenerator: async () =>
            buildPlanPrHeader({
              name: specName,
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
        opts.io.stderr(`plan mode: draft PR #${prResult.number} opened\n`);
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
            name: specName,
            agentLabel,
            reason,
            specFilesCount: draftSpecFilesCount,
          });
          opts.io.stderr(`plan mode: blocker commit pushed\n`);

          safeUpdatePrBody({
            io: opts.io,
            branch: planBranch,
            base: baseBranch,
            worktreePath,
            name: specName,
          });
        } catch (err) {
          opts.io.stderr(`${(err as Error).message}\n`);
          return 1;
        }

        opts.io.stderr(`plan: blocked\n`);
        if (draftBlocker) {
          opts.io.stderr(`\n## Blocker\n\n${draftBlocker}\n`);
        }
        return 1;
      }

      // Post-draft body refresh (header now reflects the real index.md).
      safeUpdatePrBody({
        io: opts.io,
        branch: planBranch,
        base: baseBranch,
        worktreePath,
        name: specName,
      });

      // Self-review phase
      const reviewPasses = inv.reviewPasses ?? 2;
      for (let pass = 1; pass <= reviewPasses; pass++) {
        // Honor a pending interrupt before doing any work for this pass.
        if (interrupted) {
          opts.io.stderr(`plan: interrupted\n`);
          return 130;
        }

        opts.io.stderr(
          `plan mode: review pass ${pass}/${reviewPasses} starting\n`,
        );

        try {
          // Read intent.md before the pass so we can validate it wasn't modified
          const intentPath = join(worktreePath, "spec", specName, "intent.md");
          const intentBefore = readFileSync(intentPath, "utf8");

          // Run the review pass
          const reviewResult = await runReviewPass({
            worktreePath,
            name: specName,
            config: cfg,
            passNumber: pass,
            totalPasses: reviewPasses,
          });

          // Handle agent errors
          if (reviewResult.result.kind === "error") {
            opts.io.stderr(
              `plan mode: review pass ${pass} failed: ${reviewResult.result.stderr}\n`,
            );
            return 1;
          }

          if (reviewResult.result.kind === "model_config") {
            opts.io.stderr(
              `plan mode: model configuration error: ${reviewResult.result.stderr}\n`,
            );
            // Match patch mode (src/modes/patch/run.ts:1080) which exits 3 for
            // model_config errors so a single config typo produces the same
            // exit code regardless of which mode hits it.
            return 3;
          }

          if (reviewResult.result.kind === "quota") {
            opts.io.stderr(`plan: quota exhausted\n`);
            return 2; // Quota exhausted exit code
          }

          // Honor a pending interrupt *before* committing so Ctrl-C during the
          // agent call leaves the worktree, branch, and PR untouched.
          if (interrupted) {
            opts.io.stderr(`plan: interrupted\n`);
            return 130;
          }

          // Check if the pass produced changes
          if (!hasWorkingTreeChanges(worktreePath)) {
            opts.io.stderr(
              `plan mode: review pass ${pass} made no changes; skipping commit\n`,
            );
            continue;
          }

          // Validate the review output
          const validation = validateReviewOutput(
            worktreePath,
            specName,
            intentBefore,
          );
          if (!validation.valid) {
            opts.io.stderr(
              `plan mode: review pass ${pass} validation failed: ${validation.error}\n`,
            );
            return 1;
          }

          // Check if a blocker was raised
          if (validation.blocker !== undefined) {
            // Check boundary before blocker commit
            const boundaryCheck = assertPlanWriteBoundary(
              worktreePath,
              specName,
            );
            if (!boundaryCheck.ok) {
              opts.io.stderr(
                `plan: boundary violation detected before review blocker commit\n`,
              );
              revertPaths(worktreePath, boundaryCheck.offendingPaths);
              appendBoundaryBlocker(
                worktreePath,
                specName,
                boundaryCheck.offendingPaths,
              );
              for (const path of boundaryCheck.offendingPaths) {
                opts.io.stderr(`  - ${path}\n`);
              }

              try {
                const agentLabel = reviewResult.agentLabel ?? "unknown";
                commitPlanBlocker({
                  worktreePath,
                  name: specName,
                  agentLabel,
                  reason: "write boundary violation",
                  specFilesCount: countSpecFiles(worktreePath, specName),
                });
                opts.io.stderr(`plan mode: blocker commit pushed\n`);

                safeUpdatePrBody({
                  io: opts.io,
                  branch: planBranch,
                  base: baseBranch,
                  worktreePath,
                  name: specName,
                });
              } catch (err) {
                opts.io.stderr(`${(err as Error).message}\n`);
                return 1;
              }

              opts.io.stderr(`plan: blocked\n`);
              return 1;
            }

            try {
              const agentLabel = reviewResult.agentLabel ?? "unknown";
              const reason = firstNonEmptyLine(validation.blocker);
              const specFilesCount = countSpecFiles(worktreePath, specName);

              commitPlanBlocker({
                worktreePath,
                name: specName,
                agentLabel,
                reason,
                specFilesCount,
              });
              opts.io.stderr(`plan mode: blocker commit pushed\n`);

              safeUpdatePrBody({
                io: opts.io,
                branch: planBranch,
                base: baseBranch,
                worktreePath,
                name: specName,
              });
            } catch (err) {
              opts.io.stderr(`${(err as Error).message}\n`);
              return 1;
            }

            opts.io.stderr(`plan: blocked\n`);
            if (validation.blocker) {
              opts.io.stderr(`\n## Blocker\n\n${validation.blocker}\n`);
            }
            return 1;
          }

          // Check boundary before review commit
          const boundaryCheck = assertPlanWriteBoundary(worktreePath, specName);
          if (!boundaryCheck.ok) {
            opts.io.stderr(
              `plan: boundary violation detected before review commit\n`,
            );
            revertPaths(worktreePath, boundaryCheck.offendingPaths);
            appendBoundaryBlocker(
              worktreePath,
              specName,
              boundaryCheck.offendingPaths,
            );
            for (const path of boundaryCheck.offendingPaths) {
              opts.io.stderr(`  - ${path}\n`);
            }

            try {
              const agentLabel = reviewResult.agentLabel ?? "unknown";
              commitPlanBlocker({
                worktreePath,
                name: specName,
                agentLabel,
                reason: "write boundary violation",
                specFilesCount: countSpecFiles(worktreePath, specName),
              });
              opts.io.stderr(`plan mode: blocker commit pushed\n`);

              safeUpdatePrBody({
                io: opts.io,
                branch: planBranch,
                base: baseBranch,
                worktreePath,
                name: specName,
              });
            } catch (err) {
              opts.io.stderr(`${(err as Error).message}\n`);
              return 1;
            }

            opts.io.stderr(`plan: blocked\n`);
            return 1;
          }

          // Commit and push this review pass
          try {
            const agentLabel = reviewResult.agentLabel ?? "unknown";

            commitPlanReview({
              worktreePath,
              name: specName,
              passNumber: pass,
              agentLabel,
            });
            opts.io.stderr(
              `plan mode: review pass ${pass} committed and pushed\n`,
            );

            safeUpdatePrBody({
              io: opts.io,
              branch: planBranch,
              base: baseBranch,
              worktreePath,
              name: specName,
            });
          } catch (err) {
            opts.io.stderr(`${(err as Error).message}\n`);
            return 1;
          }
        } catch (err) {
          opts.io.stderr(
            `plan mode: review pass ${pass} error: ${(err as Error).message}\n`,
          );
          return 1;
        }
      }

      opts.io.stderr(`plan: complete\n`);

      // For file/inline mode, commits were successfully created and pushed
      opts.io.stderr(
        `plan mode: commits created and pushed to plan/${specName}\n`,
      );

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
}): void {
  try {
    updatePrBody({
      branch: args.branch,
      base: args.base,
      cwd: args.worktreePath,
      headerBuilder: () =>
        buildPlanPrHeader({
          name: args.name,
          worktreePath: args.worktreePath,
        }),
    });
  } catch (err) {
    args.io.stderr(
      `warning: could not update PR body: ${(err as Error).message}\n`,
    );
  }
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
