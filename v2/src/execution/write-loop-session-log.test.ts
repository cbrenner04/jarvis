import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWrite as realExecuteWrite } from "./write.ts";
import { executeWriteLoop } from "./write-loop.ts";

const { roots } = trackedTempRoots();

function restoreExecuteWrite(): void {
  mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
}

async function runLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  artifactPath?: string;
  signal?: AbortSignal;
  sessionsDir?: string;
  clock?: () => Date;
  iterationTimeoutMs?: number;
}) {
  roots.push(join(args.jarvisRoot, ".."));
  const store = openStateStore(args.stateDbPath);
  restoreExecuteWrite();
  try {
    return await executeWriteLoop({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot: args.jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: args.artifactPath ?? "proof.txt",
      bindings: args.bindings,
      stateStore: store,
      withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
      ...(args.maxIterations !== undefined ? { maxIterations: args.maxIterations } : {}),
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
      ...(args.sessionsDir !== undefined ? { sessionsDir: args.sessionsDir } : {}),
      ...(args.clock !== undefined ? { clock: args.clock } : {}),
      ...(args.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: args.iterationTimeoutMs } : {}),
    });
  } finally {
    store.close();
  }
}

function progressThenDone(n: number): InvocationBinding[] {
  let calls = 0;
  return [
    {
      id: "agent",
      invoke: async ({ cwd }) => {
        calls += 1;
        if (calls <= n) return { kind: "ok", stdout: "progress", stderr: "" };
        writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    },
  ];
}

function defaultSessionsDir(jarvisRoot: string): string {
  return join(jarvisRoot, "sessions");
}

function hangingBindings(): InvocationBinding[] {
  return [
    {
      id: "hang",
      metadata: { agent: "sim", model: "sim" },
      invoke: () => new Promise<never>(() => undefined),
    },
  ];
}

describe.serial("write loop session logs", () => {
  beforeEach(() => {
    restoreExecuteWrite();
  });

  afterEach(() => {
    restoreExecuteWrite();
  });

  test("a completed iteration writes harness, outbound, inbound, and outcome=completed", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sessionsDir = defaultSessionsDir(jarvisRoot);
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      sessionsDir,
      maxIterations: 1,
    });

    const files = readdirSync(sessionsDir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(sessionsDir, files[0] ?? ""), "utf8");
    expect(content).toContain(`run=${result.runId}`);
    expect(content).toContain("spec=spec.md");
    expect(content).toContain("iteration=1");
    expect(content).toContain("[outbound]");
    expect(content).toContain("[inbound_stdout]");
    expect(content).toContain("done");
    expect(content).toContain("outcome=completed");
  });

  test("harness and outbound are on disk before the binding settles", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sessionsDir = defaultSessionsDir(jarvisRoot);
    let logPath: string | undefined;
    const bindings: InvocationBinding[] = [
      {
        id: "stall",
        metadata: { agent: "sim", model: "sim" },
        invoke: async ({ cwd }) => {
          const files = readdirSync(sessionsDir);
          expect(files).toHaveLength(1);
          logPath = join(sessionsDir, files[0] ?? "");
          const mid = readFileSync(logPath, "utf8");
          expect(mid).toContain("[harness]");
          expect(mid).toContain(`run=`);
          expect(mid).toContain("[outbound]");
          expect(mid).not.toContain("outcome=");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings,
      sessionsDir,
      maxIterations: 1,
      artifactPath: "proof.txt",
    });

    expect(logPath).toBeDefined();
    const finalContent = readFileSync(logPath as string, "utf8");
    expect(finalContent).toContain("outcome=completed");
  });

  test("two iterations in the same second write distinct session log files", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sessionsDir = defaultSessionsDir(jarvisRoot);
    let tick = 0;
    const clock = () => new Date(`2026-07-12T22:00:00.${String(tick++).padStart(3, "0")}Z`);

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: progressThenDone(1),
      sessionsDir,
      clock,
    });

    expect(result.iterationsConsumed).toBe(2);
    const files = readdirSync(sessionsDir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).not.toBe(files[1]);
    const secondPrefix = `${result.runId}-2026-07-12T22-00-00.`;
    expect(files[0]?.startsWith(secondPrefix)).toBe(true);
    expect(files[1]?.startsWith(secondPrefix)).toBe(true);
    expect(files[0]?.slice(secondPrefix.length)).not.toBe(files[1]?.slice(secondPrefix.length));
  });

  test("a timed-out iteration closes its log with outcome=timeout", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sessionsDir = defaultSessionsDir(jarvisRoot);

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: hangingBindings(),
      sessionsDir,
      iterationTimeoutMs: 10,
      maxIterations: 1,
    });

    expect(result.kind).toBe("iteration_timeout");
    const files = readdirSync(sessionsDir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(sessionsDir, files[0] ?? ""), "utf8");
    expect(content).toContain(`run=${result.runId}`);
    expect(content).toContain("[outbound]");
    expect(content).toContain("outcome=timeout");
  });

  test("an aborted iteration closes its log with outcome=abort", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sessionsDir = defaultSessionsDir(jarvisRoot);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: hangingBindings(),
      sessionsDir,
      signal: controller.signal,
      iterationTimeoutMs: 40,
      maxIterations: 1,
    });

    expect(result.kind).toBe("progress");
    const content = readFileSync(join(sessionsDir, readdirSync(sessionsDir)[0] ?? ""), "utf8");
    expect(content).toContain(`run=${result.runId}`);
    expect(content).toContain("[outbound]");
    expect(content).toContain("outcome=abort");
  });

  test("executeWrite throw closes its log with outcome=error", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sessionsDir = defaultSessionsDir(jarvisRoot);
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    mock.module("./write.ts", () => ({
      executeWrite: async () => {
        throw new Error("write exploded");
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "session-throw", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir,
      });

      expect(result.kind).toBe("invocation_failure");
      const content = readFileSync(join(sessionsDir, readdirSync(sessionsDir)[0] ?? ""), "utf8");
      expect(content).toContain(`run=${result.runId}`);
      expect(content).toContain("outcome=error");
    } finally {
      store.close();
      restoreExecuteWrite();
    }
  });
});
