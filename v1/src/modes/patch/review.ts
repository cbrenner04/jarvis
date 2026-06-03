import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Agent } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { postPrComment } from "../../gh.ts";
import { pushCurrent } from "../../worktree.ts";
import { updatePrBody } from "./pr.ts";
import { buildReviewPrompt } from "./prompt.ts";

export function getSpecFilesToProtect(specPath: string): string[] {
  // Return a list of spec files that should not be edited during review
  const specDir = dirname(specPath);
  const specFiles: string[] = [];

  try {
    // Get all .md files in the spec directory recursively
    const walkDir = (dir: string) => {
      const fs = require("fs");
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith(".md")) {
          specFiles.push(fullPath);
        }
      }
    };

    walkDir(specDir);
  } catch {
    // If we can't read the directory, just return empty list
  }

  return specFiles;
}

export function detectSpecTreeEdits(
  specDir: string,
  cwd: string,
): string[] {
  // Return list of spec files that were modified since last commit
  try {
    const output = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    const modifiedFiles = output.trim().split("\n").filter((f) => f.length > 0);
    const specRelPath = dirname(specDir).substring(cwd.length).replace(/^\//, "");

    return modifiedFiles.filter((file) => file.startsWith(specRelPath));
  } catch {
    return [];
  }
}

export function revertSpecTreeEdits(
  specDir: string,
  cwd: string,
): void {
  const editedFiles = detectSpecTreeEdits(specDir, cwd);
  if (editedFiles.length === 0) {
    return;
  }

  try {
    for (const file of editedFiles) {
      execFileSync("git", ["checkout", "HEAD", file], {
        cwd,
        stdio: "pipe",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to revert spec-tree edits: ${message}`);
  }
}

export function detectNewBlockerInSpec(
  specPath: string,
  cwd: string,
): string | null {
  // Check if a blocker section was added to the spec
  try {
    const output = execFileSync("git", ["diff", "HEAD", specPath], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    // Simple check: if we see "## Blocker" in the diff as an addition
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && line.includes("## Blocker")) {
        // Extract blocker content
        const blockerIndex = lines.indexOf(line);
        const blockerLines: string[] = [];
        for (let i = blockerIndex + 1; i < lines.length; i++) {
          if (lines[i]?.startsWith("+")) {
            blockerLines.push(lines[i]!.substring(1));
          } else if (!lines[i]?.startsWith("-")) {
            break;
          }
        }
        return blockerLines.join("\n").trim();
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

export function commitReviewPass(
  passNumber: number,
  agentLabel: string,
  cwd: string,
): void {
  // Check if there are any changes to commit
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  if (porcelain === "") {
    // No changes, skip commit
    return;
  }

  // Stage all changes
  execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });

  // Create commit message
  const commitMessage = appendAgentTrailer(
    `review: pass ${passNumber}`,
    agentLabel,
  );

  // Commit
  execFileSync("git", ["commit", "-F", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  // Push
  pushCurrent({ cwd, firstPush: false });
}

export async function runReviewPhase(opts: {
  specPath: string;
  agentWorkingDir: string;
  branch: string;
  base: string;
  agents: Agent[];
  reviewPasses: number;
  cwd: string;
}): Promise<{ exitCode: number; reason: string }> {
  if (opts.reviewPasses === 0 || opts.agents.length === 0) {
    return { exitCode: 0, reason: "review-skipped" };
  }

  for (let pass = 1; pass <= opts.reviewPasses; pass++) {
    const agent = opts.agents[0];
    if (agent === undefined) {
      return { exitCode: 2, reason: "quota-exhausted" };
    }

    const prompt = buildReviewPrompt({
      specPath: opts.specPath,
      cwd: opts.cwd,
      passNumber: pass,
      totalPasses: opts.reviewPasses,
    });

    // Run the review pass
    // TODO: implement agent execution and handle results

    // For now, return a placeholder
  }

  return { exitCode: 0, reason: "review-complete" };
}
