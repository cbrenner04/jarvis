import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PlanRemoteSetup {
  origin: string;
  worktreeRoot: string;
  cleanup: () => void;
}

/**
 * Sets up a git repository with a fake remote (bare repo) and returns
 * the paths and cleanup function. The returned worktreeRoot is where
 * the git worktree will be created.
 */
export function setupPlanRemote(): PlanRemoteSetup {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-"));
  const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-remote-"));

  try {
    // Set up main git repo
    execSync("git init -b main", { cwd: dir });
    execSync("git config user.email 'test@example.com'", { cwd: dir });
    execSync("git config user.name 'Test User'", { cwd: dir });

    // Create initial commit
    writeFileSync(join(dir, "README.md"), "test");
    execSync("git add README.md", { cwd: dir });
    execSync("git commit -m 'initial'", { cwd: dir });

    // Set up fake remote (bare repo)
    execSync("git init --bare -b main", { cwd: remoteDir });
    execSync(`git remote add origin ${remoteDir}`, { cwd: dir });
    execSync("git push -u origin main", { cwd: dir });

    return {
      origin: remoteDir,
      worktreeRoot: dir,
      cleanup: () => {
        rmSync(dir, { recursive: true, force: true });
        rmSync(remoteDir, { recursive: true, force: true });
      },
    };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
    throw new Error("Failed to set up plan remote");
  }
}
