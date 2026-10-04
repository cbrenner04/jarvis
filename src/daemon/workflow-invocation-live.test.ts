import { describe, expect, test } from "bun:test";
import { workflowInvocationIsLive } from "./daemon.ts";

describe("workflowInvocationIsLive", () => {
  test("is live when the entry promise is tracked and a workflow row is active", () => {
    expect(workflowInvocationIsLive(true, [{ kind: "workflow" }])).toBe(true);
  });

  test("is not live when no workflow row is active", () => {
    expect(workflowInvocationIsLive(true, [{ kind: "finalization" }])).toBe(false);
  });

  test("is not live when no rows are active", () => {
    expect(workflowInvocationIsLive(true, [])).toBe(false);
  });

  test("is not live when the entry promise is untracked, whatever is active", () => {
    expect(workflowInvocationIsLive(false, [{ kind: "workflow" }])).toBe(false);
  });
});
