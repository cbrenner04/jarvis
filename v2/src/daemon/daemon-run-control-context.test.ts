import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";

test("createRunControlHandlerContext exposes activeRuns without activeRunForHandler", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    expect(ctx.activeRuns).toBeInstanceOf(Map);
    expect(ctx.activeRuns.size).toBe(0);
  } finally {
    stateStore.close();
  }
});
