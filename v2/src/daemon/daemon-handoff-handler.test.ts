import { expect, test } from "bun:test";
import { createHandoffHandlers, recordSupersedeForRollbackAdmission, rollbackBlocksReopenAdmission } from "./daemon.ts";

function requestFrame(method: string, params?: unknown) {
  return { kind: "request" as const, id: "1", method, params };
}

function makeHandlers() {
  let retiring = true;
  let publicBound = true;
  const supersedeAdmissionState = { blocksRollbackReopen: false };
  const handlers = createHandoffHandlers({
    getPrivateSocketPath: () => "/tmp/daemon-priv.sock",
    setRetiring: () => {
      retiring = true;
    },
    setAdmitting: () => {
      retiring = false;
    },
    rollbackBlocksReopenAdmission: () => rollbackBlocksReopenAdmission(supersedeAdmissionState),
    recordRetireTrigger: () => {},
    closePublicServer: async () => {
      publicBound = false;
    },
    bindPublicServer: async () => {
      publicBound = true;
    },
    probePublicServer: async () => false,
    fallbackMs: 60_000,
  });
  const supersede = (fromHandoffSuccessor?: boolean) => {
    recordSupersedeForRollbackAdmission(supersedeAdmissionState, {
      handoffPending: handlers.isPending(),
      ...(fromHandoffSuccessor === undefined ? {} : { fromHandoffSuccessor }),
    });
    retiring = true;
  };
  return { handlers, supersede, isRetiring: () => retiring, isPublicBound: () => publicBound };
}

test("recordSupersedeForRollbackAdmission blocks rollback reopen for external supersede", () => {
  const state = { blocksRollbackReopen: false };
  recordSupersedeForRollbackAdmission(state, { handoffPending: false });
  expect(rollbackBlocksReopenAdmission(state)).toBe(true);
});

test("recordSupersedeForRollbackAdmission does not block when pending and from the handoff successor", () => {
  const state = { blocksRollbackReopen: false };
  recordSupersedeForRollbackAdmission(state, { handoffPending: true, fromHandoffSuccessor: true });
  expect(rollbackBlocksReopenAdmission(state)).toBe(false);
});

test("recordSupersedeForRollbackAdmission blocks when pending but not from the handoff successor", () => {
  const state = { blocksRollbackReopen: false };
  recordSupersedeForRollbackAdmission(state, { handoffPending: true, fromHandoffSuccessor: false });
  expect(rollbackBlocksReopenAdmission(state)).toBe(true);
});

test("handoff rollback reopens admission after changeover and handoff-origin supersede", async () => {
  const { handlers, supersede, isRetiring } = makeHandlers();
  const changeover = await handlers.changeover(requestFrame("changeover"), new AbortController().signal);
  if (changeover.kind !== "response") throw new Error("expected changeover response");
  const handoffId = (changeover.result as { handoffId: string }).handoffId;
  await new Promise((resolve) => setImmediate(resolve));

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
  const changeover = await handlers.changeover(requestFrame("changeover"), new AbortController().signal);
  if (changeover.kind !== "response") throw new Error("expected changeover response");
  const handoffId = (changeover.result as { handoffId: string }).handoffId;
  await new Promise((resolve) => setImmediate(resolve));

  supersede(false);
  const rollback = await handlers.handoff_rollback(
    requestFrame("handoff_rollback", { handoffId }),
    new AbortController().signal,
  );
  expect(rollback).toEqual({ kind: "response", result: { ok: true, state: "rolled_back" } });
  expect(isRetiring()).toBe(true);
});
