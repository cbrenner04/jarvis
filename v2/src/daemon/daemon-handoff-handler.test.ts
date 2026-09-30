import { expect, test } from "bun:test";
import { DaemonSocketInUseError } from "../ipc/server.ts";
import {
  createHandoffHandlers,
  isLiveSuccessorPublicBindRefusal,
  recordSupersedeForRollbackAdmission,
} from "./daemon.ts";

function requestFrame(method: string, params?: unknown) {
  return { kind: "request" as const, id: "1", method, params };
}

const baseDeps = {
  getPrivateSocketPath: () => "/tmp/daemon-priv.sock",
  recordRetireTrigger: () => {},
  closePublicServer: async () => {},
  bindPublicServer: async () => {},
  probePublicServer: async () => false,
};

function eaddrInUseError() {
  return Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function pendingHandoffId(handlers: ReturnType<typeof createHandoffHandlers>) {
  const changeover = await handlers.changeover(requestFrame("changeover"), new AbortController().signal);
  if (changeover.kind !== "response") throw new Error("expected changeover response");
  await flushMicrotasks();
  return (changeover.result as { handoffId: string }).handoffId;
}

function makeHandlers() {
  let retiring = true;
  const supersedeAdmissionState = { blocksRollbackReopen: false };
  const handlers = createHandoffHandlers({
    ...baseDeps,
    setRetiring: () => {
      retiring = true;
    },
    setAdmitting: () => {
      retiring = false;
    },
    rollbackBlocksReopenAdmission: () => supersedeAdmissionState.blocksRollbackReopen,
    fallbackMs: 60_000,
  });
  const supersede = (fromHandoffSuccessor?: boolean) => {
    recordSupersedeForRollbackAdmission(supersedeAdmissionState, {
      handoffPending: handlers.isPending(),
      ...(fromHandoffSuccessor === undefined ? {} : { fromHandoffSuccessor }),
    });
    retiring = true;
  };
  return { handlers, supersede, isRetiring: () => retiring };
}

type FakeTimer = { callback: () => void; dueAt: number; cleared: boolean };

function makeFallbackClock() {
  const clock = { now: 0 };
  const timers: FakeTimer[] = [];
  const scheduleAfter = (callback: () => void, delayMs: number) => {
    const timer = { callback, dueAt: clock.now + delayMs, cleared: false };
    timers.push(timer);
    return timer;
  };
  const advance = (ms: number) => {
    clock.now += ms;
    for (const timer of [...timers]) {
      if (timer.cleared || timer.dueAt > clock.now) continue;
      timer.cleared = true;
      timer.callback();
    }
  };
  return { scheduleAfter, advance };
}

async function runFallbackTicks(advance: (ms: number) => void, count: number) {
  for (let i = 0; i < count; i += 1) {
    advance(10);
    await flushMicrotasks();
  }
}

test("isLiveSuccessorPublicBindRefusal is true for EADDRINUSE and live-socket classification", () => {
  expect(isLiveSuccessorPublicBindRefusal(eaddrInUseError())).toBe(true);
  expect(isLiveSuccessorPublicBindRefusal(new DaemonSocketInUseError("/tmp/daemon.sock"))).toBe(true);
  expect(isLiveSuccessorPublicBindRefusal(new Error("rebind failed"))).toBe(false);
});

test("recordSupersedeForRollbackAdmission blocks rollback reopen for external supersede", () => {
  const state = { blocksRollbackReopen: false };
  recordSupersedeForRollbackAdmission(state, { handoffPending: false });
  expect(state.blocksRollbackReopen).toBe(true);
});

test("recordSupersedeForRollbackAdmission does not block when pending and from the handoff successor", () => {
  const state = { blocksRollbackReopen: false };
  recordSupersedeForRollbackAdmission(state, { handoffPending: true, fromHandoffSuccessor: true });
  expect(state.blocksRollbackReopen).toBe(false);
});

test("recordSupersedeForRollbackAdmission blocks when pending but not from the handoff successor", () => {
  const state = { blocksRollbackReopen: false };
  recordSupersedeForRollbackAdmission(state, { handoffPending: true, fromHandoffSuccessor: false });
  expect(state.blocksRollbackReopen).toBe(true);
});

test("handoff rollback reopens admission after changeover and handoff-origin supersede", async () => {
  const { handlers, supersede, isRetiring } = makeHandlers();
  const handoffId = await pendingHandoffId(handlers);
  supersede(true);
  expect(isRetiring()).toBe(true);
  const rollback = await handlers.handoff_rollback(
    requestFrame("handoff_rollback", { handoffId }),
    new AbortController().signal,
  );
  expect(rollback).toEqual({ kind: "response", result: { ok: true, state: "rolled_back" } });
  expect(isRetiring()).toBe(false);
});

test("handoff rollback stays non-admitting after supersede from a non-successor peer during pending", async () => {
  const { handlers, supersede, isRetiring } = makeHandlers();
  const handoffId = await pendingHandoffId(handlers);
  supersede(false);
  const rollback = await handlers.handoff_rollback(
    requestFrame("handoff_rollback", { handoffId }),
    new AbortController().signal,
  );
  expect(rollback).toEqual({ kind: "response", result: { ok: true, state: "rolled_back" } });
  expect(isRetiring()).toBe(true);
});

test("fallback rollback retries after EADDRINUSE then reopens admission", async () => {
  const { scheduleAfter, advance } = makeFallbackClock();
  let retiring = true;
  let bindCalls = 0;
  const probeResults = [false, false, false];
  const handlers = createHandoffHandlers({
    ...baseDeps,
    setRetiring: () => {
      retiring = true;
    },
    setAdmitting: () => {
      retiring = false;
    },
    rollbackBlocksReopenAdmission: () => false,
    bindPublicServer: async () => {
      bindCalls += 1;
      if (bindCalls === 1) throw eaddrInUseError();
    },
    probePublicServer: async () => probeResults.shift() ?? false,
    fallbackMs: 10,
    scheduleAfter,
  });
  const handoffId = await pendingHandoffId(handlers);
  await runFallbackTicks(advance, 3);
  const settled = await handlers.handoff_commit(
    requestFrame("handoff_commit", { handoffId }),
    new AbortController().signal,
  );
  expect(settled).toEqual({ kind: "response", result: { ok: true, state: "rolled_back" } });
  expect(bindCalls).toBe(2);
  expect(retiring).toBe(false);
  expect(handlers.isPending()).toBe(false);
});

test("fallback rollback defers competing rebind while a live successor holds the public address", async () => {
  const { scheduleAfter, advance } = makeFallbackClock();
  let bindCalls = 0;
  const probeResults = [false, false, true];
  let settled: "committed" | "rolled_back" | undefined;
  const handlers = createHandoffHandlers({
    ...baseDeps,
    setRetiring: () => {},
    setAdmitting: () => {},
    rollbackBlocksReopenAdmission: () => false,
    bindPublicServer: async () => {
      bindCalls += 1;
      throw eaddrInUseError();
    },
    probePublicServer: async () => probeResults.shift() ?? true,
    fallbackMs: 10,
    scheduleAfter,
  });
  const handoffId = await pendingHandoffId(handlers);
  for (let tick = 0; tick < 3; tick += 1) {
    await runFallbackTicks(advance, 1);
    const commit = await handlers.handoff_commit(
      requestFrame("handoff_commit", { handoffId }),
      new AbortController().signal,
    );
    if (commit.kind === "response") {
      const state = (commit.result as { state?: string }).state;
      if (state === "committed" || state === "rolled_back") settled = state;
    }
  }
  expect(bindCalls).toBe(1);
  expect(settled).toBe("committed");
});
