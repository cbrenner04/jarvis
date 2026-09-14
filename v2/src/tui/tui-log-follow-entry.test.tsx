import { describe, expect, test } from "bun:test";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import { runTuiLogFollow as runTuiLogFollowImpl } from "./tui-log-follow-entry.tsx";
import { formatLogFollowLine } from "./tui-log-follow-lines.ts";
import type { RunTuiLogFollowDeps, TuiLogFollowControls, TuiLogFollowViewHost } from "./tui-log-follow-types.ts";
import type { TuiLogTailClient } from "./tui-log-tail-client.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";
import type { DaemonRevisionReadOutcome } from "./tui-revision-follow.ts";
import { type PerformTuiRevisionReexecParams, TUI_REEXEC_REVISION_ENV } from "./tui-revision-reexec.ts";

// Every test unrelated to revision-follow gets a fast no-op default (no real subprocess/socket I/O)
// for the new revision-follow seams; the revision-follow tests below override them explicitly.
function runTuiLogFollow(runId: string, deps: RunTuiLogFollowDeps): Promise<number> {
  return runTuiLogFollowImpl(runId, {
    resolveTuiRevision: async () => "unknown",
    readTuiDaemonRevision: async () => ({ kind: "failure" }),
    ...deps,
  });
}

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
          : eventKind === "token_reprompt"
            ? {
                kind: "token_reprompt" as const,
                attemptId: `attempt-${seq}`,
                responseText: "prose without a token",
              }
            : eventKind === "invalid_token_detail"
              ? {
                  kind: "invalid_token_detail" as const,
                  attemptId: `attempt-${seq}`,
                  tokenText: "prose without a token",
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

/** This test process's own `[node executable, script path]`, narrowed for `noUncheckedIndexedAccess`. */
function currentNodeAndScript(): [string, string] {
  const [nodeExecutable, scriptPath] = process.argv;
  if (nodeExecutable === undefined || scriptPath === undefined) {
    throw new Error("test environment process.argv too short");
  }
  return [nodeExecutable, scriptPath];
}

/** Wraps a fixed sequence of daemon revision-read outcomes; the last entry repeats once exhausted. */
function revisionReadSequence(reads: readonly (string | "failure")[]): () => Promise<DaemonRevisionReadOutcome> {
  let index = 0;
  return async () => {
    const read = reads[Math.min(index, reads.length - 1)] ?? "failure";
    index += 1;
    if (read === "failure") return { kind: "failure" };
    return { kind: "success", loadedRevision: read };
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
  if (event.kind === "token_reprompt") {
    expect(line).toContain(`attemptId=${event.attemptId}`);
    expect(line).toContain(`responseText=${JSON.stringify(event.responseText)}`);
  }
  if (event.kind === "invalid_token_detail") {
    expect(line).toContain(`attemptId=${event.attemptId}`);
    expect(line).toContain(`tokenText=${JSON.stringify(event.tokenText)}`);
  }
}

describe("formatLogFollowLine", () => {
  test("projects per-kind fields from decisions", () => {
    const records: PersistedRecord[] = [
      logRecord(1, "iteration_started"),
      logRecord(2, "boundary_committed"),
      logRecord(3, "loop_finished"),
      logRecord(4, "run_execution_failed"),
      logRecord(5, "token_reprompt"),
      logRecord(6, "invalid_token_detail"),
      {
        runId: "run-123",
        seq: 7,
        ts: "2026-06-28T03:27:07.000Z",
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
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: async () => {
        openedTail = true;
        throw new RpcConnectionError("cannot connect");
      },
      tailRetry: { maxAttempts: 0 },
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
      socketPath: "/tmp/test.sock",
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
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: async () => blocking.client,
      tailRetry: { maxAttempts: 0 },
    });
    await view.waitUntilOpen();
    await waitForLines(view.lines, 1);
    view.quit();
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
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: async () => blocking.client,
      tailRetry: { maxAttempts: 0 },
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
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: async () => tail,
      tailRetry: { maxAttempts: 0 },
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
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: async () => tail,
      tailRetry: { maxAttempts: 0 },
    });

    expect(code).toBe(1);
    expect(view.lines).toHaveLength(1);
    expect(view.feedbackStates).toEqual([
      { kind: "rpc-error", code: "tail_resume_exhausted", message: "tail stream failed: follow failed" },
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
      socketPath: "/tmp/test.sock",
      connectTuiLogTail: async () => tail,
      inkRender: ink.inkRender,
      tailRetry: { maxAttempts: 0 },
    });

    expect(code).toBe(1);
    const text = ink.lastRenderText();
    expect(text).toContain("seq=1 kind=iteration_started attemptId=attempt-1");
    expect(text).toContain("tail_resume_exhausted: tail stream failed: follow failed");
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
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        connectTuiLogTail: async () => tail,
        tailRetry: { maxAttempts: 0 },
      }),
    ).rejects.toThrow("unexpected tail failure");
  });

  test("passes provided socket path to connectTuiLogTail", async () => {
    let seenPath: string | undefined;
    const tail = immediateTail();

    await runTuiLogFollow("run-123", {
      socketPath: "/tmp/injected.sock",
      viewHost: createViewHost().host,
      connectTuiLogTail: async (_runId, options) => {
        seenPath = options.socketPath;
        return tail;
      },
      tailRetry: { maxAttempts: 0 },
    });

    expect(seenPath).toBe("/tmp/injected.sock");
  });

  test("mid-stream transport loss triggers tail resume with live socket reconnection", async () => {
    const view = createViewHost();
    const initialRecords = [logRecord(1, "iteration_started"), logRecord(2, "boundary_committed")];
    const resumeRecord = logRecord(3, "loop_finished");

    let reconnectAttempt = 0;
    const connectMock = async (_runId: string, options: { socketPath: string; afterSeq?: number }) => {
      reconnectAttempt += 1;
      if (reconnectAttempt === 1) {
        // First connection: return initial records, then fail mid-stream.
        return {
          records() {
            return {
              async *[Symbol.asyncIterator]() {
                for (const record of initialRecords) {
                  yield record;
                }
                throw new RpcConnectionError("connection lost");
              },
            };
          },
          close() {},
        } as TuiLogTailClient;
      }
      // Second connection (resume): return records after seq 2.
      expect(options.afterSeq).toBe(2);
      return immediateTail([resumeRecord]);
    };

    const code = await runTuiLogFollow("run-123", {
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: connectMock,
      tailRetry: { maxAttempts: 2, initialDelayMs: 1 },
    });

    expect(code).toBe(0);
    expect(reconnectAttempt).toBe(2);
    expect(view.lines).toHaveLength(3);
    expect(view.feedbackStates).toEqual([]);
  });

  test("resume passes afterSeq equal to last appended record seq, avoiding duplicates", async () => {
    const view = createViewHost();
    const initialRecords = [logRecord(1, "iteration_started"), logRecord(2, "boundary_committed")];
    const newRecord = logRecord(3, "loop_finished");

    const connectMock = async (_runId: string, options: { socketPath: string; afterSeq?: number }) => {
      if (options.afterSeq === undefined || options.afterSeq === 0) {
        return {
          records() {
            return {
              async *[Symbol.asyncIterator]() {
                for (const record of initialRecords) {
                  yield record;
                }
                throw new RpcConnectionError("connection lost");
              },
            };
          },
          close() {},
        } as TuiLogTailClient;
      }
      // Resume with afterSeq=2 should skip the duplicate and only get seq=3.
      return immediateTail([newRecord]);
    };

    const code = await runTuiLogFollow("run-123", {
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: connectMock,
      tailRetry: { maxAttempts: 2, initialDelayMs: 1 },
    });

    expect(code).toBe(0);
    expect(view.lines).toHaveLength(3);
    expect(view.lines[0]).toContain("seq=1");
    expect(view.lines[1]).toContain("seq=2");
    expect(view.lines[2]).toContain("seq=3");
  });

  test("retries are bounded and exhaust after configured attempt limit", async () => {
    const view = createViewHost();
    const records = [logRecord(1, "iteration_started")];

    let connectAttempts = 0;
    const connectMock = async () => {
      connectAttempts += 1;
      return {
        records() {
          return {
            async *[Symbol.asyncIterator]() {
              if (connectAttempts === 1) {
                yield records[0];
              }
              throw new RpcConnectionError("connection lost");
            },
          };
        },
        close() {},
      } as TuiLogTailClient;
    };

    const code = await runTuiLogFollow("run-123", {
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: connectMock,
      tailRetry: { maxAttempts: 3, initialDelayMs: 1 },
    });

    expect(code).toBe(1);
    expect(connectAttempts).toBe(4); // Initial + 3 retries
    expect(view.feedbackStates).toHaveLength(1);
    expect(view.feedbackStates[0]).toEqual({
      kind: "rpc-error",
      code: "tail_resume_exhausted",
      message: "connection lost",
    });
  });

  test("on exhaustion tail_resume_exhausted appears in rendered ink output", async () => {
    const ink = createInkCapture();
    const records = [logRecord(1, "iteration_started")];

    const connectMock = async () => {
      return {
        records() {
          return {
            async *[Symbol.asyncIterator]() {
              yield records[0];
              throw new RpcConnectionError("connection lost");
            },
          };
        },
        close() {},
      } as TuiLogTailClient;
    };

    const code = await runTuiLogFollow("run-123", {
      socketPath: "/tmp/test.sock",
      connectTuiLogTail: connectMock,
      inkRender: ink.inkRender,
      tailRetry: { maxAttempts: 2, initialDelayMs: 1 },
    });

    expect(code).toBe(1);
    const text = ink.lastRenderText();
    expect(text).toContain("tail_resume_exhausted");
  });

  test("operator quit during retry wait returns 0 with no tail_resume_exhausted message", async () => {
    const view = createViewHost();
    const records = [logRecord(1, "iteration_started")];

    const connectMock = async () => {
      return {
        records() {
          return {
            async *[Symbol.asyncIterator]() {
              yield records[0];
              throw new RpcConnectionError("connection lost");
            },
          };
        },
        close() {},
      } as TuiLogTailClient;
    };

    const pending = runTuiLogFollow("run-123", {
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: connectMock,
      tailRetry: { maxAttempts: 5, initialDelayMs: 100 },
    });
    await view.waitUntilOpen();
    await waitForLines(view.lines, 1);
    view.quit();
    const code = await pending;

    expect(code).toBe(0);
    expect(view.feedbackStates).toEqual([]);
  });

  test("existing unavailable-daemon path unchanged: initial-open failure records unavailable feedback", async () => {
    const view = createViewHost();
    let openedTail = false;

    const code = await runTuiLogFollow("run-123", {
      socketPath: "/tmp/test.sock",
      viewHost: view.host,
      connectTuiLogTail: async () => {
        openedTail = true;
        throw new RpcConnectionError("cannot connect");
      },
      tailRetry: { maxAttempts: 5, initialDelayMs: 1 },
    });

    expect(code).toBe(1);
    expect(openedTail).toBe(true);
    expect(view.feedbackStates).toEqual([{ kind: "unavailable" }]);
    expect(view.lines).toEqual([]);
  });

  test("existing unexpected-consume-error path unchanged: non-RpcConnectionError still propagates", async () => {
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
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        connectTuiLogTail: async () => tail,
        tailRetry: { maxAttempts: 5, initialDelayMs: 1 },
      }),
    ).rejects.toThrow("unexpected tail failure");
  });

  describe("revision-follow re-exec", () => {
    test("re-execs with explicit `tui log <run-id>` argv on a stable mismatch at initial connect, without operator input", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];
      let connectedTail = false;

      const code = await runTuiLogFollow("run-123", {
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        resolveTuiRevision: async () => "rev-a",
        readTuiDaemonRevision: revisionReadSequence(["rev-b", "rev-b"]),
        reexecTuiLogFollow: async (params) => {
          reexecCalls.push(params);
        },
        connectTuiLogTail: async () => {
          connectedTail = true;
          return immediateTail();
        },
      });

      expect(code).toBe(0);
      expect(connectedTail).toBe(false);
      expect(reexecCalls).toHaveLength(1);
      expect(reexecCalls[0]?.daemonRevision).toBe("rev-b");
      expect(reexecCalls[0]?.argv).toEqual([...currentNodeAndScript(), "tui", "log", "run-123"]);
    });

    test("re-execs again on a tail-resume reconnect once the daemon's differing revision stabilizes", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];
      let connectAttempts = 0;

      const code = await runTuiLogFollow("run-123", {
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        resolveTuiRevision: async () => "rev-a",
        // Initial connect: rev-a matches (no re-exec). Mid-stream loss, then reconnect check: rev-b stabilizes.
        readTuiDaemonRevision: revisionReadSequence(["rev-a", "rev-a", "rev-b", "rev-b"]),
        reexecTuiLogFollow: async (params) => {
          reexecCalls.push(params);
        },
        connectTuiLogTail: async () => {
          connectAttempts += 1;
          return {
            records() {
              return {
                async *[Symbol.asyncIterator]() {
                  yield logRecord(1, "iteration_started");
                  throw new RpcConnectionError("connection lost");
                },
              };
            },
            close() {},
          } as TuiLogTailClient;
        },
        tailRetry: { maxAttempts: 2, initialDelayMs: 1 },
      });

      expect(code).toBe(0);
      expect(connectAttempts).toBe(1);
      expect(reexecCalls).toHaveLength(1);
      expect(reexecCalls[0]?.daemonRevision).toBe("rev-b");
    });

    test("matching monitor and daemon revisions never re-exec; tailing continues", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];
      const records = [logRecord(1, "iteration_started")];

      const code = await runTuiLogFollow("run-123", {
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        resolveTuiRevision: async () => "rev-a",
        readTuiDaemonRevision: revisionReadSequence(["rev-a", "rev-a"]),
        reexecTuiLogFollow: async (params) => {
          reexecCalls.push(params);
        },
        connectTuiLogTail: async () => immediateTail(records),
      });

      expect(code).toBe(0);
      expect(reexecCalls).toHaveLength(0);
      expect(view.lines).toHaveLength(1);
    });

    test("an unknown daemon-reported revision never re-execs; tailing continues", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];

      const code = await runTuiLogFollow("run-123", {
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        resolveTuiRevision: async () => "rev-a",
        readTuiDaemonRevision: revisionReadSequence(["unknown", "unknown"]),
        reexecTuiLogFollow: async (params) => {
          reexecCalls.push(params);
        },
        connectTuiLogTail: async () => immediateTail(),
      });

      expect(code).toBe(0);
      expect(reexecCalls).toHaveLength(0);
    });

    test("an unknown loaded (local) revision never re-execs; tailing continues", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];

      const code = await runTuiLogFollow("run-123", {
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        resolveTuiRevision: async () => "unknown",
        readTuiDaemonRevision: revisionReadSequence(["rev-b", "rev-b"]),
        reexecTuiLogFollow: async (params) => {
          reexecCalls.push(params);
        },
        connectTuiLogTail: async () => immediateTail(),
      });

      expect(code).toBe(0);
      expect(reexecCalls).toHaveLength(0);
    });

    test("a failed status read never re-execs; tailing continues", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];

      const code = await runTuiLogFollow("run-123", {
        socketPath: "/tmp/test.sock",
        viewHost: view.host,
        resolveTuiRevision: async () => "rev-a",
        readTuiDaemonRevision: revisionReadSequence(["failure", "rev-b"]),
        reexecTuiLogFollow: async (params) => {
          reexecCalls.push(params);
        },
        connectTuiLogTail: async () => immediateTail(),
      });

      expect(code).toBe(0);
      expect(reexecCalls).toHaveLength(0);
    });

    test("an already-re-exec'd marker for the daemon's current stable revision never re-execs again", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];
      const originalMarker = process.env[TUI_REEXEC_REVISION_ENV];
      process.env[TUI_REEXEC_REVISION_ENV] = "rev-b";
      try {
        const code = await runTuiLogFollow("run-123", {
          socketPath: "/tmp/test.sock",
          viewHost: view.host,
          resolveTuiRevision: async () => "rev-a",
          readTuiDaemonRevision: revisionReadSequence(["rev-b", "rev-b"]),
          reexecTuiLogFollow: async (params) => {
            reexecCalls.push(params);
          },
          connectTuiLogTail: async () => immediateTail(),
        });

        expect(code).toBe(0);
        expect(reexecCalls).toHaveLength(0);
      } finally {
        if (originalMarker === undefined) delete process.env[TUI_REEXEC_REVISION_ENV];
        else process.env[TUI_REEXEC_REVISION_ENV] = originalMarker;
      }
    });

    test("propagates when process.argv is too short to build re-exec argv", async () => {
      const view = createViewHost();
      const originalArgv = process.argv;
      process.argv = ["/usr/bin/node"];
      try {
        await expect(
          runTuiLogFollow("run-123", {
            socketPath: "/tmp/test.sock",
            viewHost: view.host,
            resolveTuiRevision: async () => "rev-a",
            readTuiDaemonRevision: revisionReadSequence(["rev-b", "rev-b"]),
            connectTuiLogTail: async () => immediateTail(),
          }),
        ).rejects.toThrow("cannot re-exec: process.argv is too short");
      } finally {
        process.argv = originalArgv;
      }
    });

    test("in-process entry from the monitor's log action re-execs with `tui log <run-id>` argv, not the monitor's own argv", async () => {
      const view = createViewHost();
      const reexecCalls: PerformTuiRevisionReexecParams[] = [];
      const originalArgv = process.argv;
      // Simulates process.argv as the monitor's own invocation left it (`jarvis tui`, no `log`/run id) —
      // the shape `runTuiLogFollow` sees when entered in-process from the monitor's `log` action.
      process.argv = ["/usr/bin/node", "/path/to/jarvis/v2/src/cli.ts", "tui"];
      try {
        const code = await runTuiLogFollow("run-456", {
          socketPath: "/tmp/test.sock",
          viewHost: view.host,
          resolveTuiRevision: async () => "rev-a",
          readTuiDaemonRevision: revisionReadSequence(["rev-b", "rev-b"]),
          reexecTuiLogFollow: async (params) => {
            reexecCalls.push(params);
          },
          connectTuiLogTail: async () => immediateTail(),
        });

        expect(code).toBe(0);
        expect(reexecCalls).toHaveLength(1);
        expect(reexecCalls[0]?.argv).toEqual([
          "/usr/bin/node",
          "/path/to/jarvis/v2/src/cli.ts",
          "tui",
          "log",
          "run-456",
        ]);
      } finally {
        process.argv = originalArgv;
      }
    });
  });
});
