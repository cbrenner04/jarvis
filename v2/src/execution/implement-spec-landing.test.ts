import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landImplementSpecTreeFromReadRoot } from "./implement-spec-landing.ts";

describe("landImplementSpecTreeFromReadRoot", () => {
  const roots: string[] = [];

  function track(path: string): string {
    roots.push(path);
    return path;
  }

  test("copies the spec tree from specReadRoot into the implement worktree", () => {
    const planWorktree = track(mkdtempSync(join(tmpdir(), "plan-worktree-")));
    const implementWorktree = track(mkdtempSync(join(tmpdir(), "implement-worktree-")));
    const specDir = join(planWorktree, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "- [x] [Work](./00-work.md)\n", "utf8");
    writeFileSync(join(specDir, "00-work.md"), "# Work\n\n## Acceptance criteria\n\n- [x] Work\n", "utf8");

    const result = landImplementSpecTreeFromReadRoot({
      worktreePath: implementWorktree,
      specReadRoot: planWorktree,
      specPath: join(specDir, "index.md"),
    });

    expect(result).toEqual({ ok: true, specPath: "spec/feature/index.md" });
    expect(readFileSync(join(implementWorktree, "spec/feature/index.md"), "utf8")).toContain("- [x]");
    expect(readFileSync(join(implementWorktree, "spec/feature/00-work.md"), "utf8")).toContain("- [x] Work");
    expect(existsSync(join(planWorktree, "spec/feature/index.md"))).toBe(true);
  });

  test("returns the existing worktree-relative spec path when read root matches the worktree", () => {
    const worktree = track(mkdtempSync(join(tmpdir(), "implement-worktree-same-")));
    const specDir = join(worktree, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "- [ ] [Work](./00-work.md)\n", "utf8");

    const result = landImplementSpecTreeFromReadRoot({
      worktreePath: worktree,
      specReadRoot: worktree,
      specPath: "spec/feature/index.md",
    });

    expect(result).toEqual({ ok: true, specPath: "spec/feature/index.md" });
  });

  test("fails when the source spec tree is missing", () => {
    const planWorktree = track(mkdtempSync(join(tmpdir(), "plan-worktree-missing-")));
    const implementWorktree = track(mkdtempSync(join(tmpdir(), "implement-worktree-missing-")));

    const result = landImplementSpecTreeFromReadRoot({
      worktreePath: implementWorktree,
      specReadRoot: planWorktree,
      specPath: join(planWorktree, "spec/feature/index.md"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("implement.spec_landing_missing");
  });

  test("copies verdict-patch.md beside the landed index", () => {
    const planWorktree = track(mkdtempSync(join(tmpdir(), "plan-worktree-verdict-")));
    const implementWorktree = track(mkdtempSync(join(tmpdir(), "implement-worktree-verdict-")));
    const specDir = join(planWorktree, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "- [ ] [Work](./00-work.md)\n", "utf8");
    writeFileSync(join(specDir, "00-work.md"), "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
    writeFileSync(join(specDir, "verdict-patch.md"), "# Verdict\n", "utf8");

    const result = landImplementSpecTreeFromReadRoot({
      worktreePath: implementWorktree,
      specReadRoot: planWorktree,
      specPath: join(specDir, "index.md"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(join(implementWorktree, "spec/feature/verdict-patch.md"), "utf8")).toBe("# Verdict\n");
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
