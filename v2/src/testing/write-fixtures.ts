import { afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalWorktree, WithExternalWorktreeResult } from "../execution/external-worktree.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";

/** Opens an in-memory state store for `callback`, closing it in `finally`. */
export async function withStateStore<T>(callback: (store: StateStore) => Promise<T> | T): Promise<T> {
  const store = openStateStore(":memory:");
  try {
    return await callback(store);
  } finally {
    store.close();
  }
}

/** stateDbPath is an unopened path under jarvisRoot, safe to ignore if unused. */
export function createJarvisHome(): { jarvisRoot: string; stateDbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-"));
  const jarvisRoot = join(root, "jarvis-home");
  const stateDbPath = join(jarvisRoot, "state", "v2.sqlite");
  return { jarvisRoot, stateDbPath };
}

/** Fake withExternalWorktree; tracks `reused` via an on-disk `.reused` marker. */
export function createFakeWithExternalWorktree(defaultJarvisRoot?: string) {
  return async function fakeWithExternalWorktree<T>(
    args: { branchName: string; projectName: string; jarvisRoot?: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> {
    const jarvisRoot = args.jarvisRoot ?? defaultJarvisRoot ?? join(tmpdir(), "jarvis-fake");
    const worktreePath = join(jarvisRoot, "worktrees", args.projectName, args.branchName);
    mkdirSync(worktreePath, { recursive: true });
    const gitignorePath = join(worktreePath, ".gitignore");
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, ".reused\n", "utf8");
    } else if (!readFileSync(gitignorePath, "utf8").includes(".reused")) {
      writeFileSync(gitignorePath, `${readFileSync(gitignorePath, "utf8").trimEnd()}\n.reused\n`, "utf8");
    }
    if (!existsSync(join(worktreePath, "spec.md"))) {
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
    }
    const reused = existsSync(join(worktreePath, ".reused"));
    const value = await run({ path: worktreePath, reused });
    writeFileSync(join(worktreePath, ".reused"), "true\n", "utf8");
    return {
      worktree: { path: worktreePath, reused: existsSync(join(worktreePath, ".reused")) },
      lock: { kind: "acquired" },
      value,
    };
  };
}

/** Call once per test file; push allocated temp roots and they're rmSync'd in afterEach. */
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
