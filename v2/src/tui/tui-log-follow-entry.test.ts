import { describe, expect, test } from "bun:test";
import { runTuiLogFollow } from "./tui-log-follow-entry.tsx";
import type { RunTuiLogFollowDeps, TuiLogFollowViewHost } from "./tui-log-follow-types.ts";
import type { DaemonRevisionReadOutcome } from "./tui-revision-follow.ts";
import type { PerformTuiRevisionReexecParams } from "./tui-revision-reexec.ts";

// Exact-stem `.test.ts` sibling for the diff-derived mutation verifier: direct-import discovery and
// co-located resolution only recognize `.test.ts`, not the JSX-suited `.test.tsx` suite that covers
// this module's other behavior — see tui-log-follow-entry.test.tsx. These two tests isolate the
// `tuiLogFollowReexecArgv` guard: a defined `process.argv[0]`/`[1]` pair must build argv without
// throwing, and a short `process.argv` (missing index 1) must throw before any re-exec.

function createViewHost(): TuiLogFollowViewHost {
  return {
    show() {},
    async openLogFollow() {
      return {
        appendLine() {},
        showFeedback() {},
        waitUntilExit() {
          return new Promise<void>(() => {});
        },
        close() {},
      };
    },
  };
}

function revisionReadSequence(reads: readonly (string | "failure")[]): () => Promise<DaemonRevisionReadOutcome> {
  let index = 0;
  return async () => {
    const read = reads[Math.min(index, reads.length - 1)] ?? "failure";
    index += 1;
    if (read === "failure") return { kind: "failure" };
    return { kind: "success", loadedRevision: read };
  };
}

const deps = (reexecTuiLogFollow: (params: PerformTuiRevisionReexecParams) => Promise<void>): RunTuiLogFollowDeps => ({
  socketPath: "/tmp/test.sock",
  viewHost: createViewHost(),
  resolveTuiRevision: async () => "rev-a",
  readTuiDaemonRevision: revisionReadSequence(["rev-b", "rev-b"]),
  reexecTuiLogFollow,
});

describe("tuiLogFollowReexecArgv guard", () => {
  test("builds re-exec argv without throwing when process.argv[0] and [1] are both defined", async () => {
    const reexecCalls: PerformTuiRevisionReexecParams[] = [];
    const [nodeExecutable, scriptPath] = process.argv;
    if (nodeExecutable === undefined || scriptPath === undefined) {
      throw new Error("test environment process.argv too short");
    }

    const code = await runTuiLogFollow(
      "run-123",
      deps(async (params) => void reexecCalls.push(params)),
    );

    expect(code).toBe(0);
    expect(reexecCalls).toHaveLength(1);
    expect(reexecCalls[0]?.argv).toEqual([nodeExecutable, scriptPath, "tui", "log", "run-123"]);
  });

  test("throws before re-exec when process.argv is too short to supply both indices", async () => {
    const originalArgv = process.argv;
    process.argv = ["/usr/bin/node"];
    try {
      await expect(
        runTuiLogFollow(
          "run-123",
          deps(async () => {}),
        ),
      ).rejects.toThrow("cannot re-exec: process.argv is too short");
    } finally {
      process.argv = originalArgv;
    }
  });
});
