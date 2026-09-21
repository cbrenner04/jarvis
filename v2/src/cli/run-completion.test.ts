import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "../daemon/daemon.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { type LogSink, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { captureIo, makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { waitForRunCompletion } from "./run-completion.ts";

const WAIT_REQUEST_ID = "00000000-0000-4000-8000-000000000010";

const failureRecord = {
  expectation: "plan artifact",
  observation: "line one\nline two",
  retryable: false,
  referencedPaths: [{ path: "v2/spec/x.md", origin: "operator-repository" }],
};

async function wait(result: unknown) {
  const cap = captureIo();
  const code = await withFixedUuid(WAIT_REQUEST_ID, () =>
    waitForRunCompletion(makeIpcClient([{ kind: "response", id: WAIT_REQUEST_ID, result }]), "run-1", cap.io),
  );
  const { stdout, stderr } = cap.read();
  return { code, stdout, stderr, payload: JSON.parse(stdout.trimEnd()) as Record<string, unknown> };
}

describe("waitForRunCompletion failure presentation", () => {
  test("a canonical failure adds failure and failureText to the payload and the block to stderr", async () => {
    const { code, payload, stderr } = await wait({ runStatus: "failed", failure: failureRecord });
    const block = [
      "failure:",
      "  expectation: plan artifact",
      "  observation: line one\\nline two",
      "  reissue can help: no",
      "  path (operator-repository): v2/spec/x.md",
    ].join("\n");
    expect(code).toBe(3);
    expect(payload.failure).toEqual(failureRecord);
    expect(payload.failureText).toBe(block);
    expect(stderr).toBe(`${block}\n`);
  });

  test("no failure leaves the payload without failure keys and stderr empty", async () => {
    const { payload, stderr } = await wait({ runStatus: "failed" });
    expect("failure" in payload).toBe(false);
    expect("failureText" in payload).toBe(false);
    expect(stderr).toBe("");
  });
});

let stateStore: StateStore;
let logSink: LogSink;
let logsPath: string;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  stateStore = openStateStore(join(tmpdir(), `jarvis-run-completion-state-${unique}.db`));
  logsPath = join(tmpdir(), `jarvis-run-completion-logs-${unique}.jsonl`);
  logSink = openLogSink(logsPath);
  handlers = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async () => undefined,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(() => {
  handlers.close();
  logSink.close();
  stateStore.close();
  rmSync(logsPath, { force: true });
});

/** IPC client whose `wait` requests are answered by the real daemon wait handler. */
function daemonBackedClient(): IpcClient {
  const replies: IpcFrame[] = [];
  let notify: (() => void) | undefined;
  return {
    send(frame) {
      const request = frame as Parameters<typeof handlers.wait>[0];
      void Promise.resolve(handlers.wait(request, new AbortController().signal)).then((reply) => {
        replies.push({ ...reply, id: request.id } as IpcFrame);
        notify?.();
      });
    },
    async nextFrame() {
      while (replies.length === 0) await new Promise<void>((resolve) => (notify = resolve));
      return replies.shift() as IpcFrame;
    },
    close() {},
  };
}

async function settleAndWait(status: RunStatus): Promise<{ code: number; stdout: string }> {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: `test-branch-${crypto.randomUUID()}`,
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.commitTerminalRunSettlement({ runId, status, terminalCause: "completion_commit_failed" });
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  let stdout = "";
  const code = await waitForRunCompletion(daemonBackedClient(), runId, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: () => undefined,
  });
  return { code, stdout };
}

test("waitForRunCompletion renders a completed row with a stale publication cause as success", async () => {
  const { code, stdout } = await settleAndWait("completed");
  expect(code).toBe(0);
  const payload = JSON.parse(stdout) as Record<string, unknown>;
  expect(payload.runStatus).toBe("completed");
  expect(payload.loopOutcomeKind).toBe("complete");
  expect(payload).not.toHaveProperty("error");
});

test("waitForRunCompletion renders a failed completion_commit_failed row as a failure exit", async () => {
  const { code, stdout } = await settleAndWait("failed");
  expect(code).toBe(1);
  const payload = JSON.parse(stdout) as { runStatus: string; error?: { reason: string } };
  expect(payload.runStatus).toBe("failed");
  expect(payload.error?.reason).toBe("completion_commit_failed");
});
