import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { type AcceptanceCriterion, parseSpec } from "../../../../shared/spec-parser.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";

export type { AcceptanceCriterion };

export function commitSubspec(subspecPath: string, opts: { cwd?: string; agentLabel: string }): void {
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

  const gitRoot = opts.cwd ?? getGitRoot(subspecPath);
  execFileSync("git", ["add", "-A"], { cwd: gitRoot, stdio: "pipe" });

  const relativeSpecPath = relative(realpathSync(gitRoot), realpathSync(subspecPath));
  const bodyFirstLine = `Spec: ${relativeSpecPath}`;
  const commitBody = `${bodyFirstLine}\n\n${acceptanceCriteriaSection}`;
  const baseMessage = `${parsed.h1}\n\n${commitBody}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  try {
    execFileSync("git", ["commit", "-F", "-"], {
      cwd: gitRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: commitMessage,
    });
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    const stderr =
      err instanceof Error && "stderr" in err && Buffer.isBuffer((err as { stderr: unknown }).stderr)
        ? (err as { stderr: Buffer }).stderr.toString()
        : "";
    const stdout =
      err instanceof Error && "stdout" in err && Buffer.isBuffer((err as { stdout: unknown }).stdout)
        ? (err as { stdout: Buffer }).stdout.toString()
        : "";
    if (stderr) {
      errorMessage += `\nstderr: ${stderr}`;
    }
    if (stdout) {
      errorMessage += `\nstdout: ${stdout}`;
    }
    throw new Error(errorMessage);
  }
}

export function snapshotAcceptanceCriteria(subspecPath: string): AcceptanceCriterion[] {
  const parsed = parseSpec(readFileSync(subspecPath, "utf8"));
  return parsed.acceptanceCriteria;
}

export function commitWipProgress(
  subspecPath: string,
  opts: {
    cwd: string;
    newlyChecked: AcceptanceCriterion[];
    checkedTotal: number;
    total: number;
    agentLabel: string;
  },
): void {
  const subspecContent = readFileSync(subspecPath, "utf8");
  const parsed = parseSpec(subspecContent);
  if (!parsed.h1) {
    throw new Error(`Subspec ${subspecPath} is missing H1 heading (# )`);
  }

  execFileSync("git", ["add", "-A"], { cwd: opts.cwd, stdio: "pipe" });

  const relativeSpecPath = relative(realpathSync(opts.cwd), realpathSync(subspecPath));
  const summary = `WIP: ${parsed.h1} (${opts.checkedTotal}/${opts.total} criteria)`;
  const body =
    opts.newlyChecked.length === 0
      ? `Spec: ${relativeSpecPath}`
      : `Spec: ${relativeSpecPath}\n\nNewly checked:\n${opts.newlyChecked.map((c) => `- ${c.text}`).join("\n")}`;
  const baseMessage = `${summary}\n\n${body}`;
  const commitMessage = appendAgentTrailer(baseMessage, opts.agentLabel);

  try {
    execFileSync("git", ["commit", "-F", "-"], {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: commitMessage,
    });
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    const stderr =
      err instanceof Error && "stderr" in err && Buffer.isBuffer((err as { stderr: unknown }).stderr)
        ? (err as { stderr: Buffer }).stderr.toString()
        : "";
    const stdout =
      err instanceof Error && "stdout" in err && Buffer.isBuffer((err as { stdout: unknown }).stdout)
        ? (err as { stdout: Buffer }).stdout.toString()
        : "";
    if (stderr) {
      errorMessage += `\nstderr: ${stderr}`;
    }
    if (stdout) {
      errorMessage += `\nstdout: ${stdout}`;
    }
    throw new Error(errorMessage);
  }
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
): void {
  const subspecContent = readFileSync(subspecPath, "utf8");
  const parsed = parseSpec(subspecContent);
  if (!parsed.h1) {
    throw new Error(`Subspec ${subspecPath} is missing H1 heading (# )`);
  }

  execFileSync("git", ["add", "-A"], { cwd: opts.cwd, stdio: "pipe" });

  const diffResult = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: opts.cwd,
    stdio: "pipe",
  });
  if (diffResult.status === 0) {
    return;
  }
  if (diffResult.status !== 1) {
    const stderr = diffResult.stderr ? diffResult.stderr.toString() : "";
    const stdout = diffResult.stdout ? diffResult.stdout.toString() : "";
    let errorDetail = "";
    if (stderr) {
      errorDetail += `\nstderr: ${stderr}`;
    }
    if (stdout) {
      errorDetail += `\nstdout: ${stdout}`;
    }
    throw new Error(`git diff --cached --quiet failed${errorDetail}`);
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

  try {
    execFileSync("git", ["commit", "-F", "-"], {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: commitMessage,
    });
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    const stderr =
      err instanceof Error && "stderr" in err && Buffer.isBuffer((err as { stderr: unknown }).stderr)
        ? (err as { stderr: Buffer }).stderr.toString()
        : "";
    const stdout =
      err instanceof Error && "stdout" in err && Buffer.isBuffer((err as { stdout: unknown }).stdout)
        ? (err as { stdout: Buffer }).stdout.toString()
        : "";
    if (stderr) {
      errorMessage += `\nstderr: ${stderr}`;
    }
    if (stdout) {
      errorMessage += `\nstdout: ${stdout}`;
    }
    throw new Error(errorMessage);
  }
}

function getGitRoot(subspecPath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dirname(subspecPath),
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not find git root for ${subspecPath}: ${message}`);
  }
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
