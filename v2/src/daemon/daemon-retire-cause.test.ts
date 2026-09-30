import { expect, test } from "bun:test";
import {
  createHandoffHandlers,
  createSignalHandler,
  createSupersedeHandler,
  recordRetireCauseOnChangeover,
} from "./daemon.ts";
import { type RetireCause, shouldRetiringSoleOwnerSelfHeal } from "./stable-digest-trigger.ts";

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

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function pendingHandoffId(handlers: ReturnType<typeof createHandoffHandlers>) {
  const changeover = await handlers.changeover(requestFrame("changeover"), new AbortController().signal);
  if (changeover.kind !== "response") throw new Error("expected changeover response");
  await flushMicrotasks();
  return (changeover.result as { handoffId: string }).handoffId;
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

function makeSupersedePair() {
  const supersedeAdmissionState = { blocksRollbackReopen: false };
  const retireCauseState = { cause: null as RetireCause };
  const handlers = createHandoffHandlers({
    ...baseDeps,
    retireCauseState,
    setRetiring: () => {},
    setAdmitting: () => {},
    rollbackBlocksReopenAdmission: () => supersedeAdmissionState.blocksRollbackReopen,
    fallbackMs: 60_000,
  });
  const supersedeHandler = createSupersedeHandler({
    state: supersedeAdmissionState,
    pendingHandoffId: handlers.pendingHandoffId,
    setRetiring: () => {},
    recordRetireTrigger: () => {},
    retireCauseState,
  });
  const supersede = (handoffId?: string) =>
    supersedeHandler(
      requestFrame("supersede", handoffId === undefined ? undefined : { handoffId }),
      new AbortController().signal,
    );
  return { handlers, supersede, supersedeAdmissionState, retireCauseState };
}

test("recordRetireCauseOnChangeover sets handoff_origin only while cause is null", () => {
  const state = { cause: null as RetireCause };
  recordRetireCauseOnChangeover(state);
  expect(state.cause).toBe("handoff_origin");
  recordRetireCauseOnChangeover(state);
  expect(state.cause).toBe("handoff_origin");
  state.cause = "terminal";
  recordRetireCauseOnChangeover(state);
  expect(state.cause).toBe("terminal");
});

test("operator signals record terminal retireCause", () => {
  const retireCauseState = { cause: null as RetireCause };
  const handler = createSignalHandler({
    setShutdownRequested: () => {},
    recordRetireTrigger: () => {},
    retireCauseState,
  });
  handler("SIGTERM");
  expect(retireCauseState.cause).toBe("terminal");
});

test("changeover records handoff_origin; commit records terminal", async () => {
  const { handlers, retireCauseState } = makeSupersedePair();
  const handoffId = await pendingHandoffId(handlers);
  expect(retireCauseState.cause).toBe("handoff_origin");
  await handlers.handoff_commit(requestFrame("handoff_commit", { handoffId }), new AbortController().signal);
  expect(retireCauseState.cause).toBe("terminal");
});

test("non-successor supersede during a pending handoff records terminal", async () => {
  const { handlers, supersede, retireCauseState } = makeSupersedePair();
  await pendingHandoffId(handlers);
  supersede("foreign-id");
  expect(retireCauseState.cause).toBe("terminal");
});

test("successor supersede during a pending handoff keeps handoff_origin", async () => {
  const { handlers, supersede, retireCauseState } = makeSupersedePair();
  const handoffId = await pendingHandoffId(handlers);
  supersede(handoffId);
  expect(retireCauseState.cause).toBe("handoff_origin");
});

test("fallback rollback after changeover does not set terminal before admission reopens", async () => {
  const { scheduleAfter, advance } = makeFallbackClock();
  const retireCauseState = { cause: null as RetireCause };
  const handlers = createHandoffHandlers({
    ...baseDeps,
    retireCauseState,
    setRetiring: () => {},
    setAdmitting: () => {},
    rollbackBlocksReopenAdmission: () => false,
    fallbackMs: 10,
    scheduleAfter,
  });
  await pendingHandoffId(handlers);
  expect(retireCauseState.cause).toBe("handoff_origin");
  await runFallbackTicks(advance, 1);
  expect(retireCauseState.cause).toBe("handoff_origin");
});

test("committed-handoff watch rebind clears retireCause; a later changeover restores handoff_origin for self-heal", async () => {
  const retireCauseState = { cause: null as RetireCause };
  let retiring = false;
  const handlers = createHandoffHandlers({
    ...baseDeps,
    retireCauseState,
    setRetiring: () => {
      retiring = true;
    },
    setAdmitting: () => {
      retireCauseState.cause = null;
      retiring = false;
    },
    rollbackBlocksReopenAdmission: () => false,
    fallbackMs: 5,
  });
  const handoffId = await pendingHandoffId(handlers);
  await handlers.handoff_commit(requestFrame("handoff_commit", { handoffId }), new AbortController().signal);
  expect(retireCauseState.cause).toBe("terminal");
  await new Promise((resolve) => setTimeout(resolve, 15));
  await flushMicrotasks();
  expect(retireCauseState.cause).toBe(null);
  expect(retiring).toBe(false);
  await handlers.changeover(requestFrame("changeover"), new AbortController().signal);
  expect(retireCauseState.cause).toBe("handoff_origin");
  expect(retiring).toBe(true);
  expect(
    shouldRetiringSoleOwnerSelfHeal({
      retiring: true,
      publicBound: true,
      handoffPending: false,
      blocksRollbackReopen: false,
      retireCause: retireCauseState.cause,
    }),
  ).toBe(true);
});

test("stale handoffId supersede blocks rollback reopen and self-heal", async () => {
  const { handlers, supersede, supersedeAdmissionState, retireCauseState } = makeSupersedePair();
  const handoffId = await pendingHandoffId(handlers);
  await handlers.handoff_rollback(requestFrame("handoff_rollback", { handoffId }), new AbortController().signal);
  expect(handlers.isPending()).toBe(false);
  supersede(handoffId);
  expect(supersedeAdmissionState.blocksRollbackReopen).toBe(true);
  expect(retireCauseState.cause).toBe("terminal");
  expect(
    shouldRetiringSoleOwnerSelfHeal({
      retiring: true,
      publicBound: true,
      handoffPending: false,
      blocksRollbackReopen: true,
      retireCause: retireCauseState.cause,
    }),
  ).toBe(false);
});
