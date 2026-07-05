import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { hasUpstream, pushCurrent } from "../../worktree.ts";

/** Injectable seam for the git operations commits.ts needs (add/commit/push/upstream/status/rev-parse). */
export interface PlanCommitGitOps {
  add(cwd: string): void;
  commit(cwd: string, message: string, opts?: { allowEmpty?: boolean }): void;
  push(cwd: string, opts: { firstPush: boolean }): void;
  hasUpstream(cwd: string): boolean;
  porcelainStatus(cwd: string): string;
  projectRoot(cwd: string): string;
}

export const realPlanCommitGitOps: PlanCommitGitOps = {
  add(cwd) {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
  },
  commit(cwd, message, opts) {
    const commitArgs = ["commit", "-F", "-"];
    if (opts?.allowEmpty) {
      commitArgs.push("--allow-empty");
    }
    execFileSync("git", commitArgs, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: message,
    });
  },
  push(cwd, opts) {
    pushCurrent({ cwd, firstPush: opts.firstPush });
  },
  hasUpstream(cwd) {
    return hasUpstream(cwd);
  },
  porcelainStatus(cwd) {
    return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  },
  projectRoot(cwd) {
    try {
      return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`could not find git root: ${message}`);
    }
  },
};

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

export function commitPlanIntent(opts: CommitPlanIntentOptions, ops: PlanCommitGitOps = realPlanCommitGitOps): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  ops.add(opts.worktreePath);

  const bodyLine = seedSourceLine(opts.mode, opts.worktreePath, opts.intentPathOrLabel, ops);
  const subject = `plan: intent${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, [bodyLine], opts.targetDir);
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  ops.commit(opts.worktreePath, commitMessage);

  try {
    ops.push(opts.worktreePath, { firstPush: true });
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

export function commitPlanRefine(opts: CommitPlanRefineOptions, ops: PlanCommitGitOps = realPlanCommitGitOps): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  ops.add(opts.worktreePath);

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

  ops.commit(opts.worktreePath, commitMessage);

  try {
    ops.push(opts.worktreePath, { firstPush: !ops.hasUpstream(opts.worktreePath) });
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

export function commitPlanDraft(opts: CommitPlanDraftOptions, ops: PlanCommitGitOps = realPlanCommitGitOps): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  ops.add(opts.worktreePath);

  const subject = `plan: draft${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(
    specDirBasename,
    [`Drafted by ${opts.agentLabel}.`, `Subspecs: ${opts.subspecCount}`],
    opts.targetDir,
  );
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  ops.commit(opts.worktreePath, commitMessage);

  try {
    ops.push(opts.worktreePath, { firstPush: !ops.hasUpstream(opts.worktreePath) });
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

export function commitPlanReview(opts: CommitPlanReviewOptions, ops: PlanCommitGitOps = realPlanCommitGitOps): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  ops.add(opts.worktreePath);

  const subject = opts.reviewLabel
    ? `plan: ${opts.reviewLabel}${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`
    : `plan: review ${opts.passNumber}${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, [`Reviewed by ${opts.agentLabel}.`], opts.targetDir);
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  ops.commit(opts.worktreePath, commitMessage);

  try {
    ops.push(opts.worktreePath, { firstPush: false });
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

export function commitPlanBlocker(opts: CommitPlanBlockerOptions, ops: PlanCommitGitOps = realPlanCommitGitOps): void {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  if (specDirBasename === undefined) {
    throw new Error("specDirBasename is required");
  }
  ops.add(opts.worktreePath);

  const porcelain = ops.porcelainStatus(opts.worktreePath);

  const subject = `plan: blocker${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(
    specDirBasename,
    [`Blocked by ${opts.reason}`, `Spec files to date: ${opts.specFilesCount}`, `Raised by ${opts.agentLabel}.`],
    opts.targetDir,
  );
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  ops.commit(opts.worktreePath, commitMessage, { allowEmpty: porcelain === "" });

  try {
    ops.push(opts.worktreePath, { firstPush: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

function seedSourceLine(
  mode: CommitPlanIntentOptions["mode"],
  worktreePath: string,
  intentPathOrLabel: string,
  ops: PlanCommitGitOps,
): string {
  if (mode === "file") {
    const projectRoot = ops.projectRoot(worktreePath);
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
