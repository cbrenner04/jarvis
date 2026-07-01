import { describe, expect, test } from "bun:test";
import type { PersistedRecord } from "./log-stream.ts";
import { TUI_DAEMON_SOCKET_DISPLAY, TuiDaemonConnectionError } from "./tui-daemon-errors.ts";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
import { runTuiLogFollow } from "./tui-log-follow-entry.tsx";
import type { TuiLogFollowControls, TuiLogFollowViewHost } from "./tui-log-follow-types.ts";
import type { TuiLogTailClient } from "./tui-log-tail-client.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";

function logRecord(
  seq: number,
  eventKind: PersistedRecord["event"]["kind"],
  overrides: Partial<PersistedRecord["event"]> = {},
): PersistedRecord {
  const base =
    eventKind === "iteration_started"
      ? { kind: "iteration_started" as const, attemptId: `attempt-${seq}` }
      : eventKind === "boundary_committed"
        ? {
            kind: "boundary_committed" as const,
            attemptId: `attempt-${seq}`,
            outcomeKind: "progress" as const,
            runStatus: "in-progress" as const,
          }
        : eventKind === "loop_finished"
          ? {
              kind: "loop_finished" as const,
              loopOutcomeKind: "complete" as const,
              iterationsConsumed: 1,
              resumable: false,
            }
          : { kind: "run_execution_failed" as const };

  return {
    runId: "run-123",
    seq,
    ts: `2026-06-28T03:27:0${seq}.000Z`,
    event: { ...base, ...overrides } as PersistedRecord["event"],
  };
}

function immediateTail(records: readonly PersistedRecord[] = []): TuiLogTailClient & { closed: boolean } {
  let closed = false;
  return {
    records() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const record of records) {
            yield record;
          }
        },
      };
    },
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
  };
}

function createBlockingTail(initial: readonly PersistedRecord[] = []) {
  const pending = [...initial];
  let streamEnded = false;
  let closed = false;
  let pushResolve: (() => void) | undefined;

  const notify = (): void => {
    pushResolve?.();
    pushResolve = undefined;
  };

  const client: TuiLogTailClient & { closed: boolean } = {
    records() {
      return {
        async *[Symbol.asyncIterator]() {
          while (!streamEnded) {
            while (pending.length > 0) {
              const record = pending.shift();
              if (record !== undefined) yield record;
            }
            if (streamEnded) return;
            await new Promise<void>((resolve) => {
              pushResolve = resolve;
            });
          }
        },
      };
    },
    close() {
      closed = true;
      streamEnded = true;
      notify();
    },
    get closed() {
      return closed;
    },
  };

  return {
    client,
    push(record: PersistedRecord) {
      pending.push(record);
      notify();
    },
    endStream() {
      streamEnded = true;
      notify();
    },
  };
}

function createViewHost() {
  const lines: string[] = [];
  const feedbackStates: TuiViewState[] = [];
  let controls: TuiLogFollowControls | undefined;
  let closed = false;
  const opened = deferred<void>();

  const host: TuiLogFollowViewHost = {
    show(state) {
      feedbackStates.push(state);
    },
    async openLogFollow(nextControls) {
      controls = nextControls;
      opened.resolve();
      return {
        appendLine(line) {
          lines.push(line);
        },
        waitUntilExit() {
          return new Promise<void>(() => {});
        },
        close() {
          closed = true;
        },
      };
    },
  };

  return {
    host,
    lines,
    feedbackStates,
    async waitUntilOpen() {
      await opened.promise;
    },
    quit() {
      controls?.quit();
    },
    isClosed() {
      return closed;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForLines(lines: string[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && lines.length < count; attempt += 1) {
    await flush();
  }
  expect(lines).toHaveLength(count);
}

function assertLineShape(line: string, record: PersistedRecord): void {
  expect(line).toContain(`seq=${record.seq}`);
  expect(line).toContain(`kind=${record.event.kind}`);
  const event = record.event;
  if (event.kind === "iteration_started") {
    expect(line).toContain(`attemptId=${event.attemptId}`);
  }
  if (event.kind === "boundary_committed") {
    expect(line).toContain(`attemptId=${event.attemptId}`);
    expect(line).toContain(`outcomeKind=${event.outcomeKind}`);
    expect(line).toContain(`runStatus=${event.runStatus}`);
  }
  if (event.kind === "loop_finished") {
    expect(line).toContain(`loopOutcomeKind=${event.loopOutcomeKind}`);
    expect(line).toContain(`iterationsConsumed=${event.iterationsConsumed}`);
    expect(line).toContain(`resumable=${event.resumable}`);
  }
}

describe("formatLogFollowLine", () => {
  test("projects per-kind fields from decisions", () => {
    const records = [
      logRecord(1, "iteration_started"),
      logRecord(2, "boundary_committed"),
      logRecord(3, "loop_finished"),
      logRecord(4, "run_execution_failed"),
    ];
    for (const record of records) {
      assertLineShape(formatLogFollowLine(record), record);
    }
  });
});

describe("runTuiLogFollow", () => {
  test("unavailable daemon records unavailable feedback, exits 1, and does not open a tail stream", async () => {
    const view = createViewHost();
    let openedTail = false;

    const code = await runTuiLogFollow("run-123", {
      viewHost: view.host,
      connectTuiLogTail: async () => {
        openedTail = true;
        throw new TuiDaemonConnectionError("cannot connect");
      },
    });

    expect(code).toBe(1);
    expect(openedTail).toBe(true);
    expect(view.feedbackStates).toEqual([{ kind: "unavailable" }]);
    expect(TUI_DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
    expect(view.lines).toEqual([]);
  });

  test("replays fixture records in arrival order with per-kind fields", async () => {
    const view = createViewHost();
    const records = [
      logRecord(1, "iteration_started"),
      logRecord(2, "boundary_committed"),
      logRecord(3, "loop_finished"),
    ];
    const tail = immediateTail(records);

    const code = await runTuiLogFollow("run-123", {
      viewHost: view.host,
      connectTuiLogTail: async () => tail,
    });

    expect(code).toBe(0);
    expect(view.lines).toHaveLength(3);
    for (let index = 0; index < records.length; index += 1) {
      assertLineShape(view.lines[index]!, records[index]!);
    }
    expect(tail.closed).toBe(true);
    expect(view.isClosed()).toBe(true);
  });

  test("blocks after replay until injectable quit, then exits 0 and closes the tail client", async () => {
    const view = createViewHost();
    const records = [logRecord(1, "iteration_started")];
    const blocking = createBlockingTail(records);

    const pending = runTuiLogFollow("run-123", {
      viewHost: view.host,
      connectTuiLogTail: async () => blocking.client,
    });
    await view.waitUntilOpen();
    await waitForLines(view.lines, 1);
    view.quit();
    const code = await pending;

    expect(code).toBe(0);
    expect(blocking.client.closed).toBe(true);
  });

  test("benign server stream-end after replay exits 0", async () => {
    const view = createViewHost();
    const records = [logRecord(1, "iteration_started")];
    const blocking = createBlockingTail(records);

    const pending = runTuiLogFollow("run-123", {
      viewHost: view.host,
      connectTuiLogTail: async () => blocking.client,
    });
    await view.waitUntilOpen();
    await waitForLines(view.lines, 1);
    blocking.endStream();
    const code = await pending;

    expect(code).toBe(0);
    expect(blocking.client.closed).toBe(true);
  });

  test("renders a live append after replay before session end", async () => {
    const view = createViewHost();
    const records = [logRecord(1, "iteration_started")];
    const live = logRecord(2, "boundary_committed");
    const blocking = createBlockingTail(records);

    const pending = runTuiLogFollow("run-123", {
      viewHost: view.host,
      connectTuiLogTail: async () => blocking.client,
    });
    await view.waitUntilOpen();
    await waitForLines(view.lines, 1);
    blocking.push(live);
    await waitForLines(view.lines, 2);
    blocking.endStream();
    const code = await pending;

    expect(code).toBe(0);
    expect(view.lines).toHaveLength(2);
    assertLineShape(view.lines[1]!, live);
  });

  test("immediate benign stream-end yields zero event lines and exits 0", async () => {
    const view = createViewHost();
    const tail = immediateTail();

    const code = await runTuiLogFollow("run-missing", {
      viewHost: view.host,
      connectTuiLogTail: async () => tail,
    });

    expect(code).toBe(0);
    expect(view.lines).toEqual([]);
    expect(tail.closed).toBe(true);
  });

  test("mid-session tail failure records operator-visible feedback and exits 1", async () => {
    const view = createViewHost();
    const tail: TuiLogTailClient = {
      records() {
        return {
          async *[Symbol.asyncIterator]() {
            yield logRecord(1, "iteration_started");
            throw new TuiDaemonConnectionError("tail stream failed: follow failed");
          },
        };
      },
      close() {},
    };

    const code = await runTuiLogFollow("run-123", {
      viewHost: view.host,
      connectTuiLogTail: async () => tail,
    });

    expect(code).toBe(1);
    expect(view.lines).toHaveLength(1);
    expect(view.feedbackStates).toEqual([
      { kind: "rpc-error", code: "daemon_error", message: "tail stream failed: follow failed" },
    ]);
  });

  test("production path renders through ink when the view host is omitted", async () => {
    let inkCalled = false;
    const tail = immediateTail([logRecord(1, "iteration_started")]);

    const code = await runTuiLogFollow("run-123", {
      connectTuiLogTail: async () => tail,
      inkRender: ((element) => {
        inkCalled = true;
        void element;
        return {
          rerender() {},
          unmount() {},
          waitUntilExit: async () => {},
          cleanup() {},
          clear() {},
          waitUntilRenderFlush: async () => {},
        } as import("ink").Instance;
      }) as import("./tui-ink-feedback.tsx").InkRender,
    });

    expect(code).toBe(0);
    expect(inkCalled).toBe(true);
  });

  test("defaults socket path to production unless tests inject one", async () => {
    let seenPath: string | undefined;
    const tail = immediateTail();

    await runTuiLogFollow("run-123", {
      viewHost: createViewHost().host,
      socketPath: "/tmp/injected.sock",
      connectTuiLogTail: async (_runId, options) => {
        seenPath = options?.socketPath;
        return tail;
      },
    });

    expect(seenPath).toBe("/tmp/injected.sock");
  });
});
