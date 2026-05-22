import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { pushCurrent } from "../../worktree.ts";

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
};

/**
 * Build the body for a plan-mode commit. Every plan commit body's first
 * non-empty line is `Spec: spec/<name>/intent.md`, matching the AGENTS.md
 * convention used by `renderAttribution` to filter PR-attribution-eligible
 * commits. Additional body lines follow the spec marker.
 */
function buildPlanBody(specDirBasename: string, lines: string[]): string {
  const specLine = `Spec: spec/${specDirBasename}/intent.md`;
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

  let bodyLine: string;
  if (opts.mode === "file") {
    // Check if the path is within the project root
    const projectRoot = getProjectRoot(opts.worktreePath);
    const resolvedIntentPath = resolve(opts.intentPathOrLabel);
    const resolvedProjectRoot = resolve(projectRoot);
    const relativePath = relative(resolvedProjectRoot, resolvedIntentPath);

    if (relativePath.startsWith("..")) {
      // Path is outside project root, use basename only
      bodyLine = `Seeded from ${opts.intentPathOrLabel.split("/").pop()}`;
    } else {
      // Path is within project root, use relative path
      bodyLine = `Seeded from ${relativePath}`;
    }
  } else if (opts.mode === "inline") {
    bodyLine = `Seeded from inline`;
  } else {
    bodyLine = `Seeded from interactive`;
  }

  const turns = opts.completedTurns ?? 0;
  const bodyLines =
    opts.resumedBy === undefined
      ? [bodyLine, `Turns: ${turns}`]
      : [`Resumed by ${opts.resumedBy}.`, `Turns: ${turns}`];

  if (opts.refineOutcome === "skipped") {
    bodyLines.push("Outcome: explicit skip");
  } else if (opts.refineOutcome === "blocker") {
    bodyLines.push("Outcome: blocker");
  }

  const subject = `plan: refine${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, bodyLines);
  const baseMessage = `${subject}\n\n${body}`;
  // No agent attribution for the refine commit (no agent involved yet).
  const commitMessage = appendAgentTrailer(baseMessage, "");

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

export type CommitPlanDraftOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  agentLabel: string;
  subspecCount: number;
  subjectSuffix?: string;
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
  const body = buildPlanBody(specDirBasename, [
    `Drafted by ${opts.agentLabel}.`,
    `Subspecs: ${opts.subspecCount}`,
  ]);
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

export type CommitPlanReviewOptions = {
  worktreePath: string;
  specDirBasename?: string;
  name?: string;
  passNumber: number;
  agentLabel: string;
  subjectSuffix?: string;
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

  const subject = `plan: review ${opts.passNumber}${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, [
    `Reviewed by ${opts.agentLabel}.`,
  ]);
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

  const subject = `plan: blocker${opts.subjectSuffix ? ` ${opts.subjectSuffix}` : ""}`;
  const body = buildPlanBody(specDirBasename, [
    `Blocked by ${opts.reason}`,
    `Spec files to date: ${opts.specFilesCount}`,
    `Raised by ${opts.agentLabel}.`,
  ]);
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
