import { describe, expect, test } from "bun:test";
import { resolveSpecsHome } from "./specs-home.ts";

describe("resolveSpecsHome", () => {
  test("defaults to external when specs is absent", () => {
    expect(resolveSpecsHome({}, {})).toEqual({ ok: true, specsHome: "external" });
    expect(resolveSpecsHome(undefined, undefined)).toEqual({ ok: true, specsHome: "external" });
  });

  test("honors specs: repo", () => {
    expect(resolveSpecsHome({ specs: "repo" }, {})).toEqual({ ok: true, specsHome: "repo" });
  });

  test("honors specs: external", () => {
    expect(resolveSpecsHome({ specs: "external" }, {})).toEqual({ ok: true, specsHome: "external" });
  });

  test("rejects an unrecognized specs value, naming specs", () => {
    const result = resolveSpecsHome({ specs: "worktree" }, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("specs");
  });

  test("rejects project plan.commit, naming specs", () => {
    const result = resolveSpecsHome({ plan: { commit: false } }, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("specs");
  });

  test("rejects machine modes.plan.commit, naming specs", () => {
    const result = resolveSpecsHome({}, { commit: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("specs");
  });
});
