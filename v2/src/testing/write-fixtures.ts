import { afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalWorktree, WithExternalWorktreeResult } from "../execution/external-worktree.ts";

/**
 * Create a Jarvis home with state DB path.
 * Returns both jarvisRoot and stateDbPath (unopened path under jarvisRoot).
 */
export function createJarvisHome(): { jarvisRoot: string; stateDbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-"));
  const jarvisRoot = join(root, "jarvis-home");
  const stateDbPath = join(jarvisRoot, "state", "v2.sqlite");
  return { jarvisRoot, stateDbPath };
}

/**
 * Create a fake withExternalWorktree implementation with `.reused` marker tracking.
 * Takes optional default jarvisRoot; individual invocations can override via args.
 */
export function createFakeWithExternalWorktree(defaultJarvisRoot?: string) {
  return async function fakeWithExternalWorktree<T>(
    args: { branchName: string; projectName: string; jarvisRoot?: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> {
    const jarvisRoot = args.jarvisRoot ?? defaultJarvisRoot ?? join(tmpdir(), "jarvis-fake");
    const worktreePath = join(jarvisRoot, "worktrees", args.projectName, args.branchName);
    mkdirSync(worktreePath, { recursive: true });
    if (!existsSync(join(worktreePath, "spec.md"))) {
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
    }
    const reused = existsSync(join(worktreePath, ".reused"));
    const value = await run({ path: worktreePath, reused });
    mkdirSync(join(worktreePath, ".."), { recursive: true });
    writeFileSync(join(worktreePath, ".reused"), "true\n", "utf8");
    return {
      worktree: { path: worktreePath, reused: existsSync(join(worktreePath, ".reused")) },
      lock: { kind: "acquired" },
      value,
    };
  };
}

/**
 * Register cleanup for temp directories created during test execution.
 * Call this once at the top level of a test file; it automatically registers
 * afterEach handler. Return value can be used to manually push roots if needed.
 */
export function trackedTempRoots(): { roots: string[]; cleanup: () => void } {
  const roots: string[] = [];

  const cleanup = () => {
    for (const root of roots.splice(0, roots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  };

  afterEach(cleanup);

  return { roots, cleanup };
}
