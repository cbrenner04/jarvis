import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWrite as realExecuteWrite, type WriteExecuteInput } from "./write.ts";
import { executeWriteLoop } from "./write-loop.ts";

const { roots } = trackedTempRoots();

function loadRunOnce(stateDbPath: string, runId: string) {
  const store = openStateStore(stateDbPath);
  try {
    return store.loadRun(runId);
  } finally {
    store.close();
  }
}

describe("write loop idle-output watchdog", () => {
  test("a healthy iteration with the idle watchdog armed completes without stall or timeout", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "idle-healthy", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: 5_000,
        idleOutputMs: 2_000,
      });

      expect(result.kind).toBe("complete");
    } finally {
      store.close();
    }
  });

  test("a silent agent settles idle_output_timeout well before the iteration wall elapses", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const startedAt = Date.now();
    mock.module("./write.ts", () => ({
      executeWrite: async (input: WriteExecuteInput) => ({
        worktreePath: join(jarvisRoot, "worktrees", "demo", "idle-run"),
        worktreeReused: false,
        lock: { kind: "acquired" as const },
        result: {
          kind: "stall" as const,
          invocation: { attempts: [], final: null, telemetryFailures: [] },
          boundMs: input.idleOutputMs,
          agent: "sim-agent-1",
          model: "sim-model-1",
        },
      }),
    }));

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "idle-run", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: 10_000,
        idleOutputMs: 20,
      });

      const elapsed = Date.now() - startedAt;
      expect(result).toMatchObject({ kind: "idle_output_timeout", iterationsConsumed: 1, resumable: false });
      expect(elapsed).toBeLessThan(2_000);
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts[0]?.outcomeKind).toBe("idle_output_timeout");
      expect(run?.attempts[0]?.invocationFailureDetail?.agent).toBe("sim-agent-1");
      expect(run?.attempts[0]?.invocationFailureDetail?.boundMs).toBe(20);
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test.each([
    {
      label: "plan-draft",
      promptId: "plan.prompt.draft" as const,
      artifactPath: ".jarvis-plan-stage",
      intentSeed: "---\nname: silent\n---\n\n## Prerequisites\n\nnone\n",
    },
    {
      label: "intent-split",
      promptId: "intent.prompt.split" as const,
      artifactPath: ".jarvis-intent-stage",
      promptPlaceholders: { WORKDIR: "/tmp/worktree", SEED_LABEL: "inline", SEED_CONTENT: "Rename the plan flag" },
    },
  ])(
    "a silent agent on the %s write step settles idle_output_timeout, not iteration_timeout",
    async ({ promptId, artifactPath, intentSeed, promptPlaceholders }) => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: `idle-${promptId}`,
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "v2/spec/2099-01-01T00-00-00Z-silent",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: artifactPath,
          promptId,
          ...(intentSeed !== undefined ? { intentSeed } : {}),
          ...(promptPlaceholders !== undefined ? { promptPlaceholders } : {}),
          bindings: simulatedBindings(["stall"]),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          iterationTimeoutMs: 10_000,
          idleOutputMs: 20,
        });

        expect(result.kind).toBe("idle_output_timeout");
        expect(result.agent).toBe("sim-agent-1");
        expect(result.boundMs).toBe(20);
        const run = loadRunOnce(stateDbPath, result.runId);
        expect(run?.attempts[0]?.outcomeKind).toBe("idle_output_timeout");
      } finally {
        store.close();
      }
    },
  );

  test("a disabled watchdog (idleOutputMs omitted) settles a silent iteration on the wall, not idle_output_timeout", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    mock.module("./write.ts", () => ({ executeWrite: () => new Promise<never>(() => undefined) }));

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "idle-disabled", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: 10,
      });

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: false });
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts[0]?.outcomeKind).toBe("iteration_timeout");
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });
});
