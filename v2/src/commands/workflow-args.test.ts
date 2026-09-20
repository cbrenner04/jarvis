import { describe, expect, test } from "bun:test";
import { parseImplementWorkflowArgs } from "./workflow-args.ts";

const BASE = ["--base", "main", "--spec", "spec.md"];

describe("parseImplementWorkflowArgs reset-despite flags", () => {
  test("--reset-despite-continuable sets resetDespiteContinuable only", () => {
    const parsed = parseImplementWorkflowArgs([...BASE, "--reset-despite-continuable"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.resetDespiteContinuable).toBe(true);
    expect(parsed.resetDespiteDirty).toBeUndefined();
    expect(parsed.resetDespiteLandedCriteria).toBeUndefined();
  });

  test("omitting --reset-despite-continuable leaves resetDespiteContinuable unset", () => {
    const parsed = parseImplementWorkflowArgs(BASE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("resetDespiteContinuable" in parsed).toBe(false);
  });
});
