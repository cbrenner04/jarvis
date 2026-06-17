import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { hasUpstream, pushCurrent } from "../../worktree.ts";

export type CommitPlanIntentOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  mode: "file" | "inline" | "interactive";
  intentPathOrLabel: string;
  agentLabel: string;
  subjectSuffix?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
};

export function commitPlanIntent(opts: CommitPlanIntentOptions): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const bodyLine = seedSourceLine(opts.mode, opts.worktreePath, opts.intentPathOrLabel);
  const subject = `plan: intent${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, [bodyLine], opts.targetDir);
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  execFileSync("git", ["commit", "-F", "-"], {
    cwd: opts.worktreePath,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  try {
    pushCurrent({ cwd: opts.worktreePath, firstPush: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

export type CommitPlanRefineOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  mode: "file" | "inline" | "interactive";
  intentPathOrLabel: string;
  completedTurns?: number;
  subjectSuffix?: string;
  resumedBy?: string;
  /** When set, records explicit skip / blocker / refined in the commit body for reviewability. */
  refineOutcome?: "refined" | "skipped" | "blocker";
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
};

/**
 * Build the body for a plan-mode commit. Every plan commit body's first
 * non-empty line is `Spec: <targetDir>/<name>/intent.md`, matching the AGENTS.md
 * convention used by `renderAttribution` to filter PR-attribution-eligible
 * commits. Additional body lines follow the spec marker.
 */
function buildPlanBody(specDirBasename: string, lines: string[], targetDir: string = "spec"): string {
  const specLine = `Spec: ${targetDir}/${specDirBasename}/intent.md`;
  return [specLine, "", ...lines].join("\n");
}

export function commitPlanRefine(opts: CommitPlanRefineOptions): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const turns = opts.completedTurns ?? 0;
  const bodyLines =
    opts.resumedBy === undefined ? [`Turns: ${turns}`] : [`Resumed by ${opts.resumedBy}.`, `Turns: ${turns}`];

  if (opts.refineOutcome === "skipped") {
    bodyLines.push("Outcome: explicit skip");
  } else if (opts.refineOutcome === "blocker") {
    bodyLines.push("Outcome: blocker");
  }

  const subject = `plan: refine${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, bodyLines, opts.targetDir);
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, "");

  execFileSync("git", ["commit", "-F", "-"], {
    cwd: opts.worktreePath,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  try {
    pushCurrent({ cwd: opts.worktreePath, firstPush: !hasUpstream(opts.worktreePath) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

export type CommitPlanDraftOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  agentLabel: string;
  subspecCount: number;
  subjectSuffix?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
};

export function commitPlanDraft(opts: CommitPlanDraftOptions): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const subject = `plan: draft${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(
    specDirBasename,
    [`Drafted by ${opts.agentLabel}.`, `Subspecs: ${opts.subspecCount}`],
    opts.targetDir,
  );
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  execFileSync("git", ["commit", "-F", "-"], {
    cwd: opts.worktreePath,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  try {
    pushCurrent({ cwd: opts.worktreePath, firstPush: !hasUpstream(opts.worktreePath) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

export type CommitPlanReviewOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  passNumber: number;
  agentLabel: string;
  subjectSuffix?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
  /** Role-specific review label (e.g., "review: adversary"). */
  reviewLabel?: string;
};

export function commitPlanReview(opts: CommitPlanReviewOptions): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const subject = opts.reviewLabel
    ? `plan: ${opts.reviewLabel}${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`
    : `plan: review ${opts.passNumber}${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, [`Reviewed by ${opts.agentLabel}.`], opts.targetDir);
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  execFileSync("git", ["commit", "-F", "-"], {
    cwd: opts.worktreePath,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  try {
    pushCurrent({ cwd: opts.worktreePath, firstPush: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

export type CommitPlanBlockerOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  agentLabel: string;
  /** First-line summary of the blocker reason (typically the first line of the agent's `## Blocker` body). */
  reason: string;
  /** Number of generated subspec files at the time the blocker was raised. */
  specFilesCount: number;
  subjectSuffix?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
};

export function commitPlanBlocker(opts: CommitPlanBlockerOptions): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: opts.worktreePath,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  const commitArgs = ["commit", "-F", "-"];
  if (porcelain === "") {
    commitArgs.push("--allow-empty");
  }

  const subject = `plan: blocker${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(
    specDirBasename,
    [`Blocked by ${opts.reason}`, `Spec files to date: ${opts.specFilesCount}`, `Raised by ${opts.agentLabel}.`],
    opts.targetDir,
  );
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  execFileSync("git", commitArgs, {
    cwd: opts.worktreePath,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  try {
    pushCurrent({ cwd: opts.worktreePath, firstPush: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

function seedSourceLine(
  mode: CommitPlanIntentOptions["mode"],
  worktreePath: string,
  intentPathOrLabel: string,
): string {
  if (mode === "file") {
    const projectRoot = getProjectRoot(worktreePath);
    const resolvedIntentPath = resolve(intentPathOrLabel);
    const resolvedProjectRoot = resolve(projectRoot);
    const relativePath = relative(resolvedProjectRoot, resolvedIntentPath);

    if (relativePath.startsWith("..")) {
      return `Seeded from ${intentPathOrLabel.split("/").pop()}`;
    }
    return `Seeded from ${relativePath}`;
  }
  if (mode === "inline") {
    return "Seeded from inline";
  }
  return "Seeded from interactive";
}

function getProjectRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not find git root: ${message}`);
  }
}
