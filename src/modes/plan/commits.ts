import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { pushCurrent } from "../../worktree.ts";

export type CommitPlanInterviewOptions = {
  worktreePath: string;
  name: string;
  mode: "file" | "inline";
  intentPathOrLabel: string;
};

export function commitPlanInterview(opts: CommitPlanInterviewOptions): void {
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
  } else {
    bodyLine = `Seeded from inline`;
  }

  const subject = "plan: interview";
  const baseMessage = `${subject}\n\n${bodyLine}`;
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
  name: string;
  agentLabel: string;
  subspecCount: number;
};

export function commitPlanDraft(opts: CommitPlanDraftOptions): void {
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const subject = "plan: draft";
  const body = `Drafted by ${opts.agentLabel}.
Subspecs: ${opts.subspecCount}`;
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, "");

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
  passNumber: number;
  agentLabel: string;
};

export function commitPlanReview(opts: CommitPlanReviewOptions): void {
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const subject = `plan: review ${opts.passNumber}`;
  const body = `Reviewed by ${opts.agentLabel}.`;
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, "");

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
  agentLabel: string;
};

export function commitPlanBlocker(opts: CommitPlanBlockerOptions): void {
  execFileSync("git", ["add", "-A"], {
    cwd: opts.worktreePath,
    stdio: "pipe",
  });

  const subject = "plan: blocker";
  const body = `Blocker raised by ${opts.agentLabel}.`;
  const baseMessage = `${subject}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, "");

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
