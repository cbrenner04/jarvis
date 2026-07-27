import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

const { roots } = trackedTempRoots();

/** git-inits the worktree path the fake `withExternalWorktree` hands the loop. */
function initWorktreeRepo(jarvisRoot: string): string {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
  mkdirSync(worktreePath, { recursive: true });
  execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
  writeFileSync(join(worktreePath, "seed.txt"), "seed\n");
  execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
  return worktreePath;
}

async function runLoop(
  jarvisRoot: string,
  stateDbPath: string,
  committer: NonNullable<WriteLoopInput["completionCommitter"]>,
) {
  roots.push(join(jarvisRoot, ".."));
  const store = openStateStore(stateDbPath);
  try {
    return await executeWriteLoop({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      stateStore: store,
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
      completionCommitter: committer,
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    });
  } finally {
    store.close();
  }
}

describe("completion boundary over a dirty worktree", () => {
  test("no checkpoint sha with changed work fails before the terminal boundary", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    initWorktreeRepo(jarvisRoot);

    const result = await runLoop(jarvisRoot, stateDbPath, async () => ({}));

    expect(result.kind).toBe("iteration_commit_failed");
  });

  test("a commit sha still completes", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    initWorktreeRepo(jarvisRoot);

    const result = await runLoop(jarvisRoot, stateDbPath, async () => ({ commitSha: "abc123", filesChanged: 1 }));

    expect(result.kind).toBe("complete");
  });
});
