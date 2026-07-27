import { describe, expect, test } from "bun:test";
import { workflowInvocationIsLive } from "./daemon.ts";

describe("workflowInvocationIsLive", () => {
  test("is live when the entry promise is tracked and a workflow row is active", () => {
    expect(workflowInvocationIsLive(true, [{ kind: "workflow" }])).toBe(true);
  });

  test("is not live when only a write-loop row is active", () => {
    // The kind comparison must be an equality check: treating a write-loop row as a workflow row
    // reports a settled workflow entry as still running.
    expect(workflowInvocationIsLive(true, [{ kind: "write-loop" }])).toBe(false);
  });

  test("is live when a workflow row is active alongside a write-loop row", () => {
    expect(workflowInvocationIsLive(true, [{ kind: "write-loop" }, { kind: "workflow" }])).toBe(true);
  });

  test("is not live when no rows are active", () => {
    expect(workflowInvocationIsLive(true, [])).toBe(false);
  });

  test("is not live when the entry promise is untracked, whatever is active", () => {
    expect(workflowInvocationIsLive(false, [{ kind: "workflow" }])).toBe(false);
  });
});
