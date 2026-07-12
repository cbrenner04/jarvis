import { describe, expect, test } from "bun:test";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import { runTuiLogFollow } from "./tui-log-follow-entry.tsx";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
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
        showFeedback(state) {
          feedbackStates.push(state);
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

function collectInkText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectInkText).join("");
  if (typeof node === "object") {
    const element = node as { type?: unknown; props?: Record<string, unknown> };
    if (typeof element.type === "function") {
      return collectInkText(element.type(element.props ?? {}));
    }
    if ("props" in element) {
      return collectInkText(element.props?.children);
    }
  }
  return "";
}

function createInkCapture() {
  const renders: unknown[] = [];
  const inkRender = ((element: unknown) => {
    renders.push(element);
    return {
      rerender(next: unknown) {
        renders.push(next);
      },
      unmount() {},
      waitUntilExit: async () => {},
      cleanup() {},
      clear() {},
      waitUntilRenderFlush: async () => {},
    };
  }) as import("./tui-ink-feedback.tsx").InkRender;

  return {
    inkRender,
    lastRenderText() {
      return collectInkText(renders.at(-1));
    },
  };
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
    const records: PersistedRecord[] = [
      logRecord(1, "iteration_started"),
      logRecord(2, "boundary_committed"),
      logRecord(3, "loop_finished"),
      logRecord(4, "run_execution_failed"),
      {
        runId: "run-123",
        seq: 5,
        ts: "2026-06-28T03:27:05.000Z",
        event: { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" },
      },
    ];
    for (const record of records) {
      assertLineShape(formatLogFollowLine(record), record);
    }
  });

  test("omits absent per-kind fields from partial payloads", () => {
    const boundary = {
      runId: "run-123",
      seq: 2,
      ts: "2026-06-28T03:27:02.000Z",
      event: { kind: "boundary_committed", attemptId: "attempt-2" } as PersistedRecord["event"],
    };
    const loopFinished = {
      runId: "run-123",
      seq: 3,
      ts: "2026-06-28T03:27:03.000Z",
      event: { kind: "loop_finished", loopOutcomeKind: "complete" } as PersistedRecord["event"],
    };

    expect(formatLogFollowLine(boundary)).toBe("seq=2 kind=boundary_committed attemptId=attempt-2");
    expect(formatLogFollowLine(loopFinished)).toBe("seq=3 kind=loop_finished loopOutcomeKind=complete");
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
        throw new RpcConnectionError("cannot connect");
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
    for (const [index, record] of records.entries()) {
      const line = view.lines[index];
      if (line === undefined) throw new Error(`missing line at index ${index}`);
      assertLineShape(line, record);
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
    const secondLine = view.lines[1];
    if (secondLine === undefined) throw new Error("missing second line");
    assertLineShape(secondLine, live);
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
            throw new RpcConnectionError("tail stream failed: follow failed");
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

  test("production path shows mid-session tail failure on the active ink session", async () => {
    const ink = createInkCapture();
    const tail: TuiLogTailClient = {
      records() {
        return {
          async *[Symbol.asyncIterator]() {
            yield logRecord(1, "iteration_started");
            throw new RpcConnectionError("tail stream failed: follow failed");
          },
        };
      },
      close() {},
    };

    const code = await runTuiLogFollow("run-123", {
      connectTuiLogTail: async () => tail,
      inkRender: ink.inkRender,
    });

    expect(code).toBe(1);
    const text = ink.lastRenderText();
    expect(text).toContain("seq=1 kind=iteration_started attemptId=attempt-1");
    expect(text).toContain("daemon_error: tail stream failed: follow failed");
  });

  test("unexpected consume errors propagate instead of exiting 0", async () => {
    const view = createViewHost();
    const tail: TuiLogTailClient = {
      records() {
        return {
          async *[Symbol.asyncIterator]() {
            yield logRecord(1, "iteration_started");
            throw new Error("unexpected tail failure");
          },
        };
      },
      close() {},
    };

    await expect(
      runTuiLogFollow("run-123", {
        viewHost: view.host,
        connectTuiLogTail: async () => tail,
      }),
    ).rejects.toThrow("unexpected tail failure");
  });

  test("production path renders through ink when the view host is omitted", async () => {
    const ink = createInkCapture();
    const tail = immediateTail([logRecord(1, "iteration_started")]);

    const code = await runTuiLogFollow("run-123", {
      connectTuiLogTail: async () => tail,
      inkRender: ink.inkRender,
    });

    expect(code).toBe(0);
    expect(ink.lastRenderText()).toContain("seq=1 kind=iteration_started attemptId=attempt-1");
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
