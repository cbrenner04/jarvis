import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { type AcceptanceCriterion, parseSpec } from "../../../../shared/spec-parser.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { GIT_SUBPROCESS_OPTS } from "./git-subprocess.ts";

export type { AcceptanceCriterion };

/** Injectable seam for the git operations subspec.ts needs (add/stage-check/commit/show/root). */
export interface SubspecGitOps {
  add(cwd: string): void;
  hasStagedChanges(cwd: string): boolean;
  commit(cwd: string, message: string): void;
  showCommitted(cwd: string, relativePath: string): string;
  gitRoot(cwd: string): string;
}

export const realSubspecGitOps: SubspecGitOps = {
  add(cwd) {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe", ...GIT_SUBPROCESS_OPTS });
  },
  hasStagedChanges(cwd) {
    const diffResult = spawnSync("git", ["diff", "--cached", "--quiet"], {
      cwd,
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    });
    if (diffResult.status === 0) {
      return false;
    }
    if (diffResult.status !== 1) {
      throw new Error(`git diff --cached --quiet failed${getErrorDetail(diffResult.stderr, diffResult.stdout)}`);
    }
    return true;
  },
  commit(cwd, message) {
    try {
      execFileSync("git", ["commit", "-F", "-"], {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        input: message,
        ...GIT_SUBPROCESS_OPTS,
      });
    } catch (err) {
      let errorMessage = err instanceof Error ? err.message : String(err);
      const stderr =
        err instanceof Error && "stderr" in err && Buffer.isBuffer((err as { stderr: unknown }).stderr)
          ? (err as { stderr: Buffer }).stderr
          : undefined;
      const stdout =
        err instanceof Error && "stdout" in err && Buffer.isBuffer((err as { stdout: unknown }).stdout)
          ? (err as { stdout: Buffer }).stdout
          : undefined;
      errorMessage += getErrorDetail(stderr, stdout);
      throw new Error(errorMessage);
    }
  },
  showCommitted(cwd, relativePath) {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    });
  },
  gitRoot(cwd) {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    }).trim();
  },
};

export function commitSubspec(
  subspecPath: string,
  opts: { cwd?: string; agentLabel: string; humanOnlyCount?: number; total?: number },
  ops: SubspecGitOps = realSubspecGitOps,
): void {
  const subspecContent = readFileSync(subspecPath, "utf8");
  const indexPath = getIndexPath(subspecPath);
  const indexContent = readFileSync(indexPath, "utf8");

  const parsed = parseSpec(subspecContent);
  if (!parsed.h1) {
    throw new Error(`Subspec ${subspecPath} is missing H1 heading (# )`);
  }

  const acceptanceCriteriaSection = extractAcceptanceCriteriaSection(subspecContent);
  if (acceptanceCriteriaSection === null) {
    throw new Error(`Subspec ${subspecPath} is missing ## Acceptance criteria section`);
  }

  const subspecName = basename(subspecPath);
  const updatedIndexContent = updateIndexCheckbox(indexContent, subspecName);
  writeFileSync(indexPath, updatedIndexContent);

  const gitRoot = opts.cwd ?? getGitRoot(subspecPath, ops);
  ops.add(gitRoot);
  if (!ops.hasStagedChanges(gitRoot)) {
    return;
  }

  const relativeSpecPath = relative(realpathSync(gitRoot), realpathSync(subspecPath));
  const bodyFirstLine = `Spec: ${relativeSpecPath}`;
  const commitBody = `${bodyFirstLine}\n\n${acceptanceCriteriaSection}`;

  let summary = parsed.h1;
  if (opts.humanOnlyCount !== undefined && opts.total !== undefined && opts.humanOnlyCount > 0) {
    summary = `${parsed.h1} (${opts.total - opts.humanOnlyCount}/${opts.total} automated, ${opts.humanOnlyCount} human-verify)`;
  }

  const baseMessage = `${summary}\n\n${commitBody}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);
  ops.commit(gitRoot, commitMessage);
}

export function snapshotAcceptanceCriteria(subspecPath: string): AcceptanceCriterion[] {
  const parsed = parseSpec(readFileSync(subspecPath, "utf8"));
  return parsed.acceptanceCriteria;
}

export function snapshotCommittedAcceptanceCriteria(
  subspecPath: string,
  opts: { cwd: string },
  ops: SubspecGitOps = realSubspecGitOps,
): AcceptanceCriterion[] {
  try {
    const gitRoot = opts.cwd;
    const relativeSpecPath = relative(realpathSync(gitRoot), realpathSync(subspecPath));
    const committed = ops.showCommitted(gitRoot, relativeSpecPath);
    const parsed = parseSpec(committed);
    return parsed.acceptanceCriteria;
  } catch {
    return [];
  }
}

export function commitWipProgress(
  subspecPath: string,
  opts: {
    cwd: string;
    newlyChecked: AcceptanceCriterion[];
    checkedTotal: number;
    total: number;
    humanOnlyCount?: number;
    agentLabel: string;
  },
  ops: SubspecGitOps = realSubspecGitOps,
): void {
  const subspecContent = readFileSync(subspecPath, "utf8");
  const parsed = parseSpec(subspecContent);
  if (!parsed.h1) {
    throw new Error(`Subspec ${subspecPath} is missing H1 heading (# )`);
  }

  ops.add(opts.cwd);
  if (!ops.hasStagedChanges(opts.cwd)) {
    return;
  }

  const relativeSpecPath = relative(realpathSync(opts.cwd), realpathSync(subspecPath));
  let summary: string;
  if (opts.humanOnlyCount !== undefined && opts.humanOnlyCount > 0) {
    summary = `WIP: ${parsed.h1} (${opts.checkedTotal}/${opts.total} criteria, ${opts.humanOnlyCount} human-verify)`;
  } else {
    summary = `WIP: ${parsed.h1} (${opts.checkedTotal}/${opts.total} criteria)`;
  }
  const body =
    opts.newlyChecked.length === 0
      ? `Spec: ${relativeSpecPath}`
      : `Spec: ${relativeSpecPath}\n\nNewly checked:\n${opts.newlyChecked.map((c) => `- ${c.text}`).join("\n")}`;
  const baseMessage = `${summary}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);
  ops.commit(opts.cwd, commitMessage);
}

export function commitWipProgressWithBlocker(
  subspecPath: string,
  opts: {
    cwd: string;
    newlyChecked: AcceptanceCriterion[];
    checkedTotal: number;
    total: number;
    blockerBody: string;
    agentLabel: string;
  },
  ops: SubspecGitOps = realSubspecGitOps,
): void {
  const subspecContent = readFileSync(subspecPath, "utf8");
  const parsed = parseSpec(subspecContent);
  if (!parsed.h1) {
    throw new Error(`Subspec ${subspecPath} is missing H1 heading (# )`);
  }

  ops.add(opts.cwd);
  if (!ops.hasStagedChanges(opts.cwd)) {
    return;
  }

  const relativeSpecPath = relative(realpathSync(opts.cwd), realpathSync(subspecPath));

  let summary: string;
  let body: string;

  if (opts.newlyChecked.length === 0) {
    summary = `WIP: ${parsed.h1} (blocked)`;
    body = `Spec: ${relativeSpecPath}\n\n## Blocker\n\n${opts.blockerBody}`;
  } else {
    summary = `WIP: ${parsed.h1} (blocked, ${opts.checkedTotal}/${opts.total} criteria)`;
    const checkedList = opts.newlyChecked.map((c) => `- ${c.text}`).join("\n");
    body = `Spec: ${relativeSpecPath}\n\nNewly checked:\n${checkedList}\n\n## Blocker\n\n${opts.blockerBody}`;
  }

  const baseMessage = `${summary}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);
  ops.commit(opts.cwd, commitMessage);
}

/** Commits any staged worktree changes (tracked edits and new untracked files) as a WIP checkpoint. No-op if nothing is staged. */
export function commitCheckpointOnTimeout(
  subspecPath: string | undefined,
  cwd: string,
  agentLabel: string,
  ops: SubspecGitOps = realSubspecGitOps,
): boolean {
  ops.add(cwd);
  if (!ops.hasStagedChanges(cwd)) {
    return false;
  }

  // Flat specs have no active subspec to reference (and get no resume receipt), so
  // their checkpoint message stays the bare subject; subspec checkpoints add the
  // `Spec:` line the resume receipt validates against.
  const subject = "WIP: checkpoint (iteration-timeout)";
  const body =
    subspecPath === undefined
      ? subject
      : `${subject}\n\nSpec: ${relative(realpathSync(ops.gitRoot(cwd)), realpathSync(subspecPath))}`;
  ops.commit(cwd, appendAgentTrailer(body, agentLabel));
  return true;
}

function getGitRoot(subspecPath: string, ops: SubspecGitOps): string {
  try {
    return ops.gitRoot(dirname(subspecPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not find git root for ${subspecPath}: ${message}`);
  }
}

function getErrorDetail(stderr: string | Buffer | undefined, stdout: string | Buffer | undefined): string {
  let errorDetail = "";
  if (stderr) {
    errorDetail += `\nstderr: ${stderr.toString()}`;
  }
  if (stdout) {
    errorDetail += `\nstdout: ${stdout.toString()}`;
  }
  return errorDetail;
}

function getIndexPath(subspecPath: string): string {
  const dir = dirname(subspecPath);
  return `${dir}/index.md`;
}

function basename(path: string): string {
  return path.split("/").pop() || "";
}

function extractAcceptanceCriteriaSection(content: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const headerIndex = lines.indexOf("## Acceptance criteria");
  if (headerIndex === -1) {
    return null;
  }

  const sectionLines = ["## Acceptance criteria"];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^##\s+/.test(line)) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function updateIndexCheckbox(content: string, subspecName: string): string {
  const escapedName = subspecName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uncheckedPattern = new RegExp(`^- \\[ \\] \\[(.+?)\\]\\(\\./${escapedName}\\)$`, "m");
  if (uncheckedPattern.test(content)) {
    return content.replace(uncheckedPattern, (_match, linkText: string) => {
      return `- [x] [${linkText}](./${subspecName})`;
    });
  }

  const checkedPattern = new RegExp(`^- \\[[xX]\\] \\[(.+?)\\]\\(\\./${escapedName}\\)$`, "m");
  if (checkedPattern.test(content)) {
    return content;
  }

  throw new Error(`index.md does not link to ${subspecName}`);
}
