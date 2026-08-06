import { describe, expect, test } from "bun:test";
import { maybeResetStaleWorkspace, STALE_RESET_WORKFLOWS } from "./stale-reset-workspace.ts";

describe("stale-reset-workspace exports", () => {
  test("maybeResetStaleWorkspace and STALE_RESET_WORKFLOWS are importable", () => {
    expect(typeof maybeResetStaleWorkspace).toBe("function");
    expect(STALE_RESET_WORKFLOWS.has("intent")).toBe(true);
  });
});
