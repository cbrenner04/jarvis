import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path"; // Used in bindings closure
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { executeWriteLoop } from "./write-loop.ts";
import { openStateStore } from "./state-store.ts";
import { simulatedBindings } from "./testing/bindings.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function setupRepo(): { repoRoot: string; jarvisRoot: string; stateDbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-loop-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");
  const stateDbPath = join(jarvisRoot, "state", "v2.sqlite");

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], {
    stdio: "pipe",
  });
  writeFileSync(join(repoRoot, "spec.md"), "- [ ] work\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "spec.md"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], {
    stdio: "pipe",
  });

  return { repoRoot, jarvisRoot, stateDbPath };
}

async function runLoop(args: {
  repoRoot: string;
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  artifactPath?: string;
  signal?: AbortSignal;
}) {
  const store = openStateStore(args.stateDbPath);
  const loopInput: any = {
    worktree: {
      projectRoot: args.repoRoot,
      projectName: "demo",
      branchName: "write-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    projectId: "demo",
    specRef: "HEAD",
    branch: "write-run",
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    stateStore: store,
  };
  if (args.maxIterations !== undefined) {
    loopInput.maxIterations = args.maxIterations;
  }
  if (args.signal !== undefined) {
    loopInput.signal = args.signal;
  }
  const result = await executeWriteLoop(loopInput);
  store.close();
  return result;
}

describe("write loop", () => {
  test("loop module exists and calls executeWrite repeatedly until terminal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let callCount = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          callCount += 1;
          if (callCount <= 2) {
            return { kind: "ok", stdout: "progress", stderr: "" };
          }
          // Write artifact to the worktree cwd
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
  });

  test("progress loops again and artifact contract not checked mid-loop", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
      maxIterations: 3,
    });

    // Progress doesn't check contract, so we loop until budget exhausted
    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(3);
  });

  test("done with passing artifact contract ends loop successfully", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["done"], {
      artifactPath: "proof.txt",
      emitArtifact: true,
    });

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("no-work with passing artifact contract ends loop successfully", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["no-work"], {
      artifactPath: "proof.txt",
      emitArtifact: true,
    });

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("done/no-work with failing contract appends blocker and stops", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["done"], {
      artifactPath: "proof.txt",
      emitArtifact: false, // No artifact, contract will fail
    });

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("contract_miss");
    expect(result.iterationsConsumed).toBe(1);

    // Blocker should be appended to spec in the worktree
    const worktreeSpecPath = join(jarvisRoot, "worktrees", "demo", "write-run", "spec.md");
    const spec = readFileSync(worktreeSpecPath, "utf8");
    expect(spec).toContain("## Blocker");
    expect(spec).toContain("artifact.exists");
  });

  test("blocked stops immediately with distinct outcome", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["blocked"]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
  });

  test("budget exhausted while progress yields soft-stop outcome", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["progress", "progress", "progress"]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
      maxIterations: 2,
    });

    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("invocation_failure is terminal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings(["quota", "quota"]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(false);
  });

  test("max iterations per-invocation with default constant", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const bindings = simulatedBindings([
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "done",
    ]);

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    expect(result.iterationsConsumed).toBe(10); // Default max
    expect(result.kind).toBe("budget-exhausted");
  });

  test("cancellation propagates via AbortSignal", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    const controller = new AbortController();
    const callCounts: number[] = [];
    const bindings: InvocationBinding[] = [
      {
        id: "track",
        invoke: async () => {
          callCounts.push(1);
          if (callCounts.length > 1) {
            controller.abort();
          }
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
      signal: controller.signal,
    });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("each iteration persists through state store boundary", async () => {
    const { repoRoot, jarvisRoot, stateDbPath } = setupRepo();
    let callCount = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          callCount += 1;
          if (callCount <= 2) {
            return { kind: "ok", stdout: "progress", stderr: "" };
          }
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      repoRoot,
      jarvisRoot,
      stateDbPath,
      bindings,
    });

    const store = openStateStore(stateDbPath);
    const run = store.loadRun(result.runId);
    store.close();

    expect(run).not.toBeNull();
    expect(run?.attempts.length).toBe(3);
  });
});
