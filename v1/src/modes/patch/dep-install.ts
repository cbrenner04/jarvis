import { execFileSync } from "node:child_process";
import { existsSync, readlinkSync, rmSync, renameSync, copyFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type DepInstallResult =
  | {
      kind: "ok";
    }
  | {
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
  const packageJsonPath = join(cwd, "package.json");
  const bunLockPath = join(cwd, "bun.lock");

  // Create a temp directory for the install
  let tempDir: string;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "jarvis-install-"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message: `failed to create temp directory: ${message}` };
  }

  try {
    // Copy package.json to temp directory
    if (existsSync(packageJsonPath)) {
      copyFileSync(packageJsonPath, join(tempDir, "package.json"));
    }

    // Copy bun.lock to temp directory if it exists
    if (existsSync(bunLockPath)) {
      copyFileSync(bunLockPath, join(tempDir, "bun.lock"));
    }

    // Run the install command in the temp directory
    execFileSync("sh", ["-c", installCommand], {
      cwd: tempDir,
      stdio: "pipe",
      env: process.env,
    });

    // Copy the regenerated bun.lock back to the original location
    const tempBunLockPath = join(tempDir, "bun.lock");
    if (existsSync(tempBunLockPath)) {
      copyFileSync(tempBunLockPath, bunLockPath);
    }

    // Remove the old symlink or directory if it exists
    if (existsSync(nodeModulesPath)) {
      try {
        rmSync(nodeModulesPath, { recursive: true, force: true });
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Move the temp node_modules into place
    const tempNodeModules = join(tempDir, "node_modules");
    renameSync(tempNodeModules, nodeModulesPath);

    return { kind: "ok" };
  } catch (err) {
    // Clean up temp directory on failure
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}

export function commitLockfileChanges(cwd: string, agentLabel: string): void {
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

    // Stage the lockfile changes (only files that exist)
    const filesToAdd: string[] = [];
    if (existsSync(join(cwd, "package.json"))) {
      filesToAdd.push("package.json");
    }
    if (existsSync(join(cwd, "bun.lock"))) {
      filesToAdd.push("bun.lock");
    }

    if (filesToAdd.length === 0) {
      // No files to add, exit
      return;
    }

    execFileSync("git", ["add", ...filesToAdd], {
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
