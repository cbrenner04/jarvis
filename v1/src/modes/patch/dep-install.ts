import { execFileSync } from "node:child_process";
import { existsSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

type DepInstallResult = {
  kind: "ok";
} | {
  kind: "error";
  message: string;
};

export function detectDepChange(cwd: string): boolean {
  try {
    // Check if the last commit touched package.json or bun.lock
    const diffOutput = execFileSync("git", ["diff", "HEAD~1", "HEAD", "--name-only"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    const changedFiles = diffOutput.trim().split("\n");
    return changedFiles.includes("package.json") || changedFiles.includes("bun.lock");
  } catch {
    // On first commit or error, no dep change detected
    return false;
  }
}

export function installDeps(cwd: string, installCommand: string): DepInstallResult {
  const nodeModulesPath = join(cwd, "node_modules");

  // Remove the symlink if it exists to allow the install command to create a real directory
  if (existsSync(nodeModulesPath)) {
    try {
      readlinkSync(nodeModulesPath);
      // It's a symlink, remove it
      rmSync(nodeModulesPath, { recursive: true, force: true });
    } catch {
      // Not a symlink; it's already a real directory, which is fine
    }
  }

  try {
    // Run the install command in the worktree
    execFileSync("sh", ["-c", installCommand], {
      cwd,
      stdio: "pipe",
      env: process.env,
    });

    return { kind: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}

export function commitLockfileChanges(
  cwd: string,
  agentLabel: string,
): void {
  try {
    // Check if there are changes to commit
    const statusOutput = execFileSync("git", ["status", "--porcelain", "--", "package.json", "bun.lock"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    if (statusOutput === "") {
      // No changes to commit
      return;
    }

    // Stage the lockfile changes
    execFileSync("git", ["add", "package.json", "bun.lock"], {
      cwd,
      stdio: "pipe",
    });

    // Create and commit with agent trailer
    const msg = ["harness: regenerate lockfile after dep install", "", `Jarvis-Agent: ${agentLabel}`].join("\n");
    execFileSync("git", ["commit", "-m", msg], {
      cwd,
      stdio: "pipe",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to commit lockfile changes: ${message}`);
  }
}
