import { describe, expect, test } from "bun:test";
import { resolveInvocationEntryRunId } from "./invocation-entry-run.ts";
import type { StateStore } from "./state-store.ts";

type Row = {
  id: string;
  stepId: string;
  workflowSnapshot: { invocationId: string; steps: { stepId: string }[] } | null;
};

function fakeStore(rows: Row[]): Parameters<typeof resolveInvocationEntryRunId>[0] {
  return {
    loadRun: (id: string) => rows.find((row) => row.id === id),
    findRunsByInvocationId: (invocationId: string) =>
      rows.filter((row) => row.workflowSnapshot?.invocationId === invocationId),
  } as unknown as Pick<StateStore, "loadRun" | "findRunsByInvocationId">;
}

const snapshot = { invocationId: "inv-1", steps: [{ stepId: "implement" }, { stepId: "implement-review" }] };

describe("resolveInvocationEntryRunId", () => {
  test("a row with no workflow snapshot is its own entry run", () => {
    const store = fakeStore([{ id: "solo", stepId: "write", workflowSnapshot: null }]);
    expect(resolveInvocationEntryRunId(store, "solo")).toBe("solo");
  });

  test("an unknown run id resolves to itself", () => {
    expect(resolveInvocationEntryRunId(fakeStore([]), "missing")).toBe("missing");
  });

  test("a sibling row resolves to the row whose stepId is the snapshot's first step", () => {
    const store = fakeStore([
      { id: "review", stepId: "implement-review", workflowSnapshot: snapshot },
      { id: "entry", stepId: "implement", workflowSnapshot: snapshot },
    ]);
    expect(resolveInvocationEntryRunId(store, "review")).toBe("entry");
  });

  test("a linked implement invocation resolves to its earliest-created row", () => {
    const store = fakeStore([
      { id: "link-0", stepId: "implement~link-0", workflowSnapshot: snapshot },
      { id: "shrink", stepId: "implement~shrink", workflowSnapshot: snapshot },
      { id: "review", stepId: "implement-review", workflowSnapshot: snapshot },
    ]);
    expect(resolveInvocationEntryRunId(store, "review")).toBe("link-0");
  });
});
