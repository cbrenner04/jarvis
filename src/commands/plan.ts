import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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

function derivePlanName(inv: PlanInvocation): string | null {
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
      return null;
  }
}

const RESERVED_NAMES = new Set(["index", "intent"]);

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

export async function deriveSpecName(
  inv: PlanInvocation,
  projectRoot: string,
): Promise<string> {
  const candidateName = derivePlanName(inv);
  // Note: derivePlanName returns null for interactive mode, but interactive mode
  // is filtered out in planCommand before calling deriveSpecName, so candidateName
  // is always a string here
  if (candidateName === null) {
    throw new Error("deriveSpecName called with interactive mode");
  }

  let name = candidateName;

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

export type SeedIntentFileMode = "file" | "inline";

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
  const processCwd = opts.cwd ?? process.cwd();
  const result = parsePlanArgs(args, processCwd);
  if (!result.ok) {
    opts.io.stderr(`${result.message}\n`);
    return result.exitCode;
  }
  opts.io.stderr(`${describePlanInvocation(result.invocation)}\n`);

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

  const project = entry.resolution.resolved.project;
  opts.io.stderr(
    `plan mode: target project=${project.key} root=${project.root}\n`,
  );

  // For interactive mode, keep falling through to stub exit
  const planName = derivePlanName(inv);
  if (planName === null) {
    opts.io.stderr(PLAN_STUB_MESSAGE);
    return 2;
  }

  // Derive the spec name with collision handling
  const specName = await deriveSpecName(inv, project.root);
  opts.io.stderr(`plan mode: spec name=${specName}\n`);

  // Create worktree for file or inline mode (only if it's a git repo and gh is available)
  const isGitRepo = existsSync(join(project.root, ".git"));
  let worktreePath: string | null = null;
  if (!opts.skipGhCheck && isGitRepo) {
    try {
      worktreePath = await createPlanWorktree({
        projectRoot: project.root,
        name: specName,
      });
      const cfg = loadConfig(opts.config);
      createWorktreeSymlinks(project.root, worktreePath, cfg.worktreeSymlinks);
      opts.io.stderr(`plan mode: worktree created at ${worktreePath}\n`);
    } catch (err) {
      const message = (err as Error).message;
      // Handle local-only branch collision with a specific error message
      if (message.includes("already exists") && message.includes(".worktree")) {
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
      }
    } catch (err) {
      opts.io.stderr(`failed to seed intent file: ${(err as Error).message}\n`);
      return 1;
    }

    // Create plan: interview commit and push
    try {
      const intentPathOrLabel =
        inv.mode === "file"
          ? (inv as Extract<typeof inv, { mode: "file" }>).intentPath
          : (inv as Extract<typeof inv, { mode: "inline" }>).intentText;
      commitPlanInterview({
        worktreePath,
        name: specName,
        mode: inv.mode as "file" | "inline",
        intentPathOrLabel,
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
      const cfg = loadConfig(opts.config);

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
      opts.io.stderr(`plan: boundary violation detected before draft commit\n`);
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
          const boundaryCheck = assertPlanWriteBoundary(worktreePath, specName);
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

    // Remove the SIGINT handler
    process.removeListener("SIGINT", onSigint);

    return 0;
  }

  // Remove the SIGINT handler
  process.removeListener("SIGINT", onSigint);

  // This path is reached when `skipGhCheck` is true (test seam) or when the
  // target is not a git repo: no worktree is created, no commits are made,
  // and plan mode falls through to the not-yet-implemented stub. The
  // interactive case is handled earlier when `planName` is null.
  opts.io.stderr(PLAN_STUB_MESSAGE);
  return 2;
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
