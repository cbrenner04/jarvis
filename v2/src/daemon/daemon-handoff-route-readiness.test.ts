import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHandler } from "../ipc/server.ts";
import type { LogReader, LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { listRunsDirect, mockWriteLoopInput } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, shouldShutdownNow, startDaemonRuntime } from "./daemon.ts";
import { type DrainObserver, observePredecessorDrain, type SchedulePollLoop } from "./daemon-drain-observer.ts";
import {
  createRouteReadinessGate,
  gateRunControlHandler,
  gateStreamHandler,
  hasRoutedResponsibility,
  type RouteCandidate,
  resolveRouteOwnership,
  routeReadinessGateIsPending,
  type ScheduleReadinessDeadline,
} from "./daemon-handoff-route-readiness.ts";

function requestFrame(
  id: string,
  method: string,
  params?: unknown,
): { kind: "request"; id: string; method: string; params?: unknown } {
  return { kind: "request", id, method, params };
}

const signal = () => new AbortController().signal;

/** `Record<string, RpcHandler>` reads as possibly-`undefined` under `noUncheckedIndexedAccess`. */
function requireHandler(handlers: Record<string, RpcHandler>, method: string): RpcHandler {
  const handler = handlers[method];
  if (!handler) throw new Error(`missing handler for method ${method}`);
  return handler;
}

function routingUnavailableError() {
  return { kind: "error" as const, code: "run_routing_unavailable", message: expect.any(String) };
}

function fakeReader(): LogReader {
  return { tail: () => [], async *follow() {} };
}

function fakeSink(): LogSink {
  return { append: () => undefined, close: () => undefined };
}

/**
 * Drives an `observePredecessorDrain` poll loop by hand instead of racing a real timer, matching
 * `daemon-drain-observer.test.ts`'s helper.
 */
function manualPollLoop(): { schedulePollLoop: SchedulePollLoop; tick: () => Promise<void> } {
  let onTick: (() => Promise<void>) | undefined;
  return {
    schedulePollLoop: (fn) => {
      onTick = fn;
      return { clear: () => undefined };
    },
    tick: async () => {
      if (onTick === undefined) throw new Error("poll loop was never scheduled");
      await onTick();
    },
  };
}

/** A never-settling observer with a manually resolvable `firstSettlement`. */
function manuallySettledObserver(): { observer: DrainObserver; settle: () => void } {
  let resolveSettlement: (() => void) | undefined;
  const firstSettlement = new Promise<void>((resolve) => {
    resolveSettlement = resolve;
  });
  return {
    observer: { liveRunIds: () => new Set<string>(), stop: () => undefined, firstSettlement },
    settle: () => resolveSettlement?.(),
  };
}

// --- resolveRouteOwnership -------------------------------------------------

test("resolveRouteOwnership: the direct predecessor wins over a legacy duplicate regardless of candidate order", () => {
  const predecessor: RouteCandidate = { kind: "predecessor", socketPath: "/pred.sock", runId: "run-a" };
  const legacy: RouteCandidate = { kind: "legacy", socketPath: "/legacy.sock", runId: "run-a" };

  expect(resolveRouteOwnership([legacy, predecessor]).get("run-a")).toEqual({
    kind: "predecessor",
    socketPath: "/pred.sock",
  });
  expect(resolveRouteOwnership([predecessor, legacy]).get("run-a")).toEqual({
    kind: "predecessor",
    socketPath: "/pred.sock",
  });
});

test("resolveRouteOwnership: a duplicate within the same hop kind resolves deterministically by socket path, not input order", () => {
  const first: RouteCandidate = { kind: "legacy", socketPath: "/legacy-a.sock", runId: "run-a" };
  const second: RouteCandidate = { kind: "legacy", socketPath: "/legacy-b.sock", runId: "run-a" };

  expect(resolveRouteOwnership([first, second]).get("run-a")?.socketPath).toBe("/legacy-a.sock");
  expect(resolveRouteOwnership([second, first]).get("run-a")?.socketPath).toBe("/legacy-a.sock");
});

test("resolveRouteOwnership: distinct run ids each keep their own owning hop", () => {
  const owners = resolveRouteOwnership([
    { kind: "predecessor", socketPath: "/pred.sock", runId: "run-a" },
    { kind: "legacy", socketPath: "/legacy.sock", runId: "run-b" },
  ]);
  expect(owners.get("run-a")).toEqual({ kind: "predecessor", socketPath: "/pred.sock" });
  expect(owners.get("run-b")).toEqual({ kind: "legacy", socketPath: "/legacy.sock" });
});

// --- hasRoutedResponsibility -------------------------------------------------

test("hasRoutedResponsibility: true when routed run ownership is nonzero, even with no forwarded requests", () => {
  expect(hasRoutedResponsibility(1, 0)).toBe(true);
});

test("hasRoutedResponsibility: true when a forwarded request is in flight, even with no routed ownership", () => {
  expect(hasRoutedResponsibility(0, 1)).toBe(true);
});

test("hasRoutedResponsibility: false when neither routed ownership nor a forwarded request is present", () => {
  expect(hasRoutedResponsibility(0, 0)).toBe(false);
});

test("shouldShutdownNow: an intermediate stays alive, retiring and locally idle, while it owns a routed run reachable only through it", () => {
  const owners = resolveRouteOwnership([{ kind: "predecessor", socketPath: "/a-private.sock", runId: "run-a" }]);
  const hasRoutedWork = hasRoutedResponsibility(owners.size, 0);
  expect(hasRoutedWork).toBe(true);
  // Retiring + locally idle would exit without the routed-work extension (see
  // `daemon-retire-superseded.test.ts`'s direct guard-inversion coverage).
  expect(shouldShutdownNow(false, true, false, false, hasRoutedWork)).toBe(false);
});

// --- routeReadinessGateIsPending / createRouteReadinessGate -----------------

test("routeReadinessGateIsPending: both truth directions", () => {
  expect(routeReadinessGateIsPending("pending")).toBe(true);
  expect(routeReadinessGateIsPending("ready")).toBe(false);
  expect(routeReadinessGateIsPending("unavailable")).toBe(false);
});

test("createRouteReadinessGate: no predecessor is trivially ready", () => {
  const gate = createRouteReadinessGate(undefined, undefined);
  expect(gate.current()).toBe("ready");
});

test("createRouteReadinessGate: pending until the predecessor's first settlement lands, then ready", async () => {
  const { observer, settle } = manuallySettledObserver();
  const gate = createRouteReadinessGate("/pred.sock", observer.firstSettlement);
  expect(gate.current()).toBe("pending");
  settle();
  await observer.firstSettlement;
  expect(gate.current()).toBe("ready");
});

test("createRouteReadinessGate: unavailable once the deadline fires before the predecessor ever settles", () => {
  let fireDeadline: (() => void) | undefined;
  const scheduleDeadline: ScheduleReadinessDeadline = (onTimeout) => {
    fireDeadline = onTimeout;
    return { clear: () => undefined };
  };
  const neverSettles = new Promise<void>(() => undefined);
  const gate = createRouteReadinessGate("/pred.sock", neverSettles, 999_999, scheduleDeadline);
  expect(gate.current()).toBe("pending");
  fireDeadline?.();
  expect(gate.current()).toBe("unavailable");
});

test("createRouteReadinessGate: a settlement after the deadline already fired does not revive it", async () => {
  let fireDeadline: (() => void) | undefined;
  const scheduleDeadline: ScheduleReadinessDeadline = (onTimeout) => {
    fireDeadline = onTimeout;
    return { clear: () => undefined };
  };
  const { observer, settle } = manuallySettledObserver();
  const gate = createRouteReadinessGate("/pred.sock", observer.firstSettlement, 999_999, scheduleDeadline);
  fireDeadline?.();
  expect(gate.current()).toBe("unavailable");
  settle();
  await observer.firstSettlement;
  expect(gate.current()).toBe("unavailable");
});

test("createRouteReadinessGate: a deadline firing after settlement already landed does not regress it to unavailable", async () => {
  let fireDeadline: (() => void) | undefined;
  const clearCalls: number[] = [];
  const scheduleDeadline: ScheduleReadinessDeadline = (onTimeout) => {
    fireDeadline = onTimeout;
    return { clear: () => clearCalls.push(1) };
  };
  const { observer, settle } = manuallySettledObserver();
  const gate = createRouteReadinessGate("/pred.sock", observer.firstSettlement, 999_999, scheduleDeadline);
  settle();
  await observer.firstSettlement;
  expect(gate.current()).toBe("ready");
  expect(clearCalls.length).toBe(1);
  // Simulates a deadline callback that was already scheduled before settlement cleared it; a
  // production timer cannot fire after `clearTimeout`, but the guard itself must still hold.
  fireDeadline?.();
  expect(gate.current()).toBe("ready");
});

// --- gateRunControlHandler / gateStreamHandler ------------------------------

test("gateRunControlHandler: fails closed with run_routing_unavailable while pending, passes through once ready", async () => {
  const stub: RpcHandler = () => ({ kind: "response", result: { ok: true } });
  const { observer, settle } = manuallySettledObserver();
  const gate = createRouteReadinessGate("/pred.sock", observer.firstSettlement);
  const gated = gateRunControlHandler(stub, gate);

  const pending = await gated(requestFrame("1", "wait", {}), signal());
  expect(pending).toEqual({
    kind: "error",
    code: "run_routing_unavailable",
    message: expect.any(String),
  });

  settle();
  await observer.firstSettlement;
  const ready = await gated(requestFrame("2", "wait", {}), signal());
  expect(ready).toEqual({ kind: "response", result: { ok: true } });
});

test("gateRunControlHandler: fails closed with run_routing_unavailable once route setup conclusively fails", async () => {
  let fireDeadline: (() => void) | undefined;
  const scheduleDeadline: ScheduleReadinessDeadline = (onTimeout) => {
    fireDeadline = onTimeout;
    return { clear: () => undefined };
  };
  const stub: RpcHandler = () => ({ kind: "response", result: { ok: true } });
  const gate = createRouteReadinessGate("/pred.sock", new Promise<void>(() => undefined), 999_999, scheduleDeadline);
  const gated = gateRunControlHandler(stub, gate);

  fireDeadline?.();
  const response = await gated(requestFrame("1", "kill", { runId: "r", force: true }), signal());
  expect(response).toEqual({ kind: "error", code: "run_routing_unavailable", message: expect.any(String) });
});

test("gateStreamHandler: throws while not ready, passes through once ready", async () => {
  const calls: string[] = [];
  const stub = async (): Promise<void> => {
    calls.push("called");
  };
  const { observer, settle } = manuallySettledObserver();
  const gate = createRouteReadinessGate("/pred.sock", observer.firstSettlement);
  const gated = gateStreamHandler(stub, gate);

  await expect(
    gated(
      "s1",
      {},
      () => undefined,
      () => undefined,
      signal(),
    ),
  ).rejects.toThrow("run_routing_unavailable");
  expect(calls).toEqual([]);

  settle();
  await observer.firstSettlement;
  await gated(
    "s1",
    {},
    () => undefined,
    () => undefined,
    signal(),
  );
  expect(calls).toEqual(["called"]);
});

// --- daemon integration: immediate post-changeover admission fails closed --

test("daemon: start, resume, wait, and kill --force fail closed until route readiness settles, then pass through", async () => {
  const stateStorePath = join(tmpdir(), `jarvis-route-readiness-${process.pid}-${Date.now()}.db`);
  const stateStore = openStateStore(stateStorePath);
  const capturedHandlers = new Map<string, Record<string, RpcHandler>>();
  const { observer, settle } = manuallySettledObserver();

  const runtime = await startDaemonRuntime("/fake/public.sock", stateStore, fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: async (socketPath, handlers) => {
      if (handlers) capturedHandlers.set(socketPath, handlers);
      return { socketPath, close: async () => undefined };
    },
    enumerateOtherDaemonSockets: () => [],
    predecessorSocketPath: "/fake/predecessor.sock",
    observePredecessorDrain: () => observer,
    writeLoopExecutor: async () => undefined,
    hasMemoryHeadroom: () => true,
  });

  try {
    const handlers = capturedHandlers.get("/fake/public.sock");
    if (!handlers) throw new Error("handlers were not captured");
    const start = requireHandler(handlers, "start");
    const resume = requireHandler(handlers, "resume");
    const wait = requireHandler(handlers, "wait");
    const kill = requireHandler(handlers, "kill");

    expect(await start(requestFrame("s1", "start", { input: mockWriteLoopInput() }), signal())).toEqual(
      routingUnavailableError(),
    );
    expect(await resume(requestFrame("r1", "resume", { runId: "missing" }), signal())).toEqual(
      routingUnavailableError(),
    );
    expect(await wait(requestFrame("w1", "wait", { runId: "missing" }), signal())).toEqual(routingUnavailableError());
    expect(await kill(requestFrame("k1", "kill", { runId: "missing", force: true }), signal())).toEqual(
      routingUnavailableError(),
    );

    settle();
    await observer.firstSettlement;

    const started = await start(requestFrame("s2", "start", { input: mockWriteLoopInput() }), signal());
    expect(started.kind).toBe("response");
  } finally {
    await runtime.close();
    stateStore.close();
  }
});

// --- three-generation chain: C routes A-owned work through B, never addressing A directly --

test("daemon: a C -> B -> A chain routes A-owned work through B without C ever addressing A's socket", async () => {
  const bStorePath = join(tmpdir(), `jarvis-route-readiness-b-${process.pid}-${Date.now()}.db`);
  const bStore = openStateStore(bStorePath);
  const bExecutor = createFakeWriteLoopExecutor();
  const runAId = bStore.createRun({
    project: "p",
    specRef: "ref",
    worktreePath: "/tmp/wt-a",
    branch: "a-branch",
    specPath: "/tmp/wt-a/spec.md",
    status: "in-progress",
  });
  // B is already draining A: its own drain observation reports A's run live.
  const bHandlers = createRunControlHandlers({
    stateStore: bStore,
    writeLoopExecutor: bExecutor.executor,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    externalLiveRunIds: () => new Set([runAId]),
  });

  const loop = manualPollLoop();
  const observedByC: string[] = [];
  const capturedHandlers = new Map<string, Record<string, RpcHandler>>();
  const cStorePath = join(tmpdir(), `jarvis-route-readiness-c-${process.pid}-${Date.now()}.db`);
  const cStore = openStateStore(cStorePath);

  const runtime = await startDaemonRuntime("/fake/public-c.sock", cStore, fakeReader(), {
    openLogSink: () => fakeSink(),
    startIpcServer: async (socketPath, handlers) => {
      if (handlers) capturedHandlers.set(socketPath, handlers);
      return { socketPath, close: async () => undefined };
    },
    enumerateOtherDaemonSockets: () => [],
    predecessorSocketPath: "/fake/b-private.sock",
    observePredecessorDrain: (socketPath) => {
      observedByC.push(socketPath);
      // Stands in for the real socket: C's only channel to B is `list`, and B's own response
      // already carries A's run merged in via B's own drain observation — the existing
      // mechanism this subspec reuses rather than having C address A directly.
      return observePredecessorDrain(socketPath, {
        schedulePollLoop: loop.schedulePollLoop,
        probeLiveness: async () => "live",
        listLiveRunIds: async () => {
          const rows = await listRunsDirect(bHandlers);
          return (rows ?? []).filter((row) => row.isLive).map((row) => row.runId);
        },
      });
    },
    writeLoopExecutor: async () => undefined,
    hasMemoryHeadroom: () => true,
  });

  try {
    await loop.tick();

    // C only ever opened a route to its direct predecessor B — never A's socket.
    expect(observedByC).toEqual(["/fake/b-private.sock"]);

    const handlers = capturedHandlers.get("/fake/public-c.sock");
    if (!handlers) throw new Error("handlers were not captured");
    const wait = requireHandler(handlers, "wait");
    const waited = await wait(requestFrame("w1", "wait", { runId: runAId }), signal());
    // Route readiness settled from B's response alone: the gate no longer fails closed, even
    // though the run it is asking about is owned three hops back at A.
    expect(waited).not.toEqual(routingUnavailableError());
  } finally {
    await runtime.close();
    bStore.close();
    bExecutor.abortAll();
    cStore.close();
  }
});

// --- wire-compatibility: readiness needs nothing beyond the predecessor's list RPC --

test("readiness settles from a predecessor that only answers list, no new RPC or stream-open form required", async () => {
  const methodCalls: string[] = [];
  const observer = observePredecessorDrain("/legacy-shaped-predecessor.sock", {
    probeLiveness: async () => {
      methodCalls.push("probe");
      return "live";
    },
    listLiveRunIds: async () => {
      methodCalls.push("list");
      return ["run-a"];
    },
    schedulePollLoop: (onTick) => {
      void onTick();
      return { clear: () => undefined };
    },
  });
  try {
    const gate = createRouteReadinessGate("/legacy-shaped-predecessor.sock", observer.firstSettlement);
    await observer.firstSettlement;
    expect(gate.current()).toBe("ready");
    // No handoff-specific RPC beyond the existing liveness probe and `list` was ever needed.
    expect(methodCalls).toEqual(["probe", "list"]);
  } finally {
    observer.stop();
  }
});
