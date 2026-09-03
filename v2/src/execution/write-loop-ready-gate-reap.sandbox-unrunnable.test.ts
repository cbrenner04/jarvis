// Proves a killed run's ready-gate process group is reaped: a real, long-lived, SIGTERM-ignoring
// child spawned via the production `bun run ready` group-mode path is gone after the run's
// termination signal fires mid-gate — via the same abort-listener path production takes, not a
// pre-spawn `signal.aborted` short-circuit. Also proves the group id lands on the owning run's
// durable row while the gate is in flight and is cleared once it settles. Real spawn/kill is the
// seam under test, so this stays sandbox-unrunnable.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createReadyFinalizer } from "./ready-finalize.ts";
import { executeWriteLoop } from "./write-loop.ts";

const TRAP_MARKER = ".ready-gate-trap-installed";
// Bounded well past the marker and reap deadlines below (so real reaping always beats it) but
// well under the test's own timeout, so a run of the keystone mutation — where nothing ever
// signals the gate — still exits on its own and never leaves a survivor.
const FIXTURE_LIFETIME_SECONDS = 90;

/** Polls until nothing in `pgid` remains, or throws once `deadlineMs` elapses without that. */
async function waitForGroupReaped(pgid: number, deadlineMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    if (Date.now() - start >= deadlineMs) {
      throw new Error(`process group ${pgid} still alive after ${deadlineMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Polls until `path` exists, or throws once `deadlineMs` elapses without that. */
async function waitForFileToExist(path: string, deadlineMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (existsSync(path)) return;
    if (Date.now() - start >= deadlineMs) {
      throw new Error(`${path} did not appear after ${deadlineMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("terminating a run mid-gate kills the ready gate process group", async () => {
  // @mutate v2/src/execution/ready-finalize.ts "[\"run\", \"ready\"], worktreePath, { env, signal: gateOptions?.signal, processGroup });" -> "[\"run\", \"ready\"], worktreePath, { env });"
  const { jarvisRoot, stateDbPath } = createJarvisHome();
  const branchName = "ready-gate-reap";
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(worktreePath, { recursive: true });
  // Ignores SIGTERM, so the group can only be reaped via the SIGKILL escalation. Writes a marker
  // after the trap is installed, and self-exits after a bound, so no path through this test —
  // including the keystone mutation, where nothing ever signals it — can leave it running.
  writeFileSync(
    join(worktreePath, "package.json"),
    JSON.stringify(
      {
        name: "ready-gate-reap-fixture",
        scripts: {
          ready: `sh -c "trap '' TERM; touch ${TRAP_MARKER}; i=0; while [ \\$i -lt ${FIXTURE_LIFETIME_SECONDS} ]; do sleep 1; i=\\$((i+1)); done"`,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  let pgid: number | undefined;
  let runId: string | undefined;
  let midFlightPgid: number | null | undefined;
  let markerWaitError: Error | undefined;
  const controller = new AbortController();
  const store = openStateStore(stateDbPath);
  // Captures the real group id, then — once the fixture has demonstrably installed its SIGTERM
  // trap — aborts the run's own signal asynchronously, so production takes its abort *listener*
  // path (the one it actually uses on kill/abandon) rather than the synchronous `signal.aborted`
  // pre-check, and the SIGKILL escalation is what's genuinely exercised.
  const runner: AsyncSubprocessRunner = {
    async runAsync(cmd, args, cwd, options) {
      if (options?.processGroup === undefined) {
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd, options);
      }
      return realAsyncSubprocessRunner.runAsync(cmd, args, cwd, {
        ...options,
        processGroup: {
          onGroupId: (id) => {
            // Chain to production's own recorder first, so the durable-store assertions below
            // observe the real write, not a bypassed one.
            options.processGroup?.onGroupId?.(id);
            pgid = id;
            void waitForFileToExist(join(worktreePath, TRAP_MARKER), 45_000)
              .then(() => {
                if (runId !== undefined) {
                  midFlightPgid = store.loadRun(runId)?.readyGatePgid ?? null;
                }
                controller.abort();
              })
              .catch((error) => {
                markerWaitError = error instanceof Error ? error : new Error(String(error));
                controller.abort();
              });
          },
        },
      });
    },
  };
  const readyFinalizer = createReadyFinalizer({ asyncSubprocessRunner: runner, ghReadyFlip: async () => {} });

  try {
    const result = await executeWriteLoop({
      worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      stateStore: store,
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
      signal: controller.signal,
      onRunCreated: (id) => {
        runId = id;
      },
      completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
      completionPublisher: async () => ({}),
      readyFinalizer,
    });

    expect(result.kind).toBe("progress");
    expect(result.resumable).toBe(true);
    expect(markerWaitError).toBeUndefined();
    expect(pgid).toBeDefined();
    expect(midFlightPgid).toBe(pgid ?? null);
    if (pgid !== undefined) {
      await waitForGroupReaped(pgid, 30_000);
    }
    expect(runId).toBeDefined();
    if (runId !== undefined) {
      expect(store.loadRun(runId)?.readyGatePgid ?? null).toBeNull();
    }
  } finally {
    store.close();
    if (pgid !== undefined) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    rmSync(join(jarvisRoot, ".."), { recursive: true, force: true });
  }
}, 150_000);
