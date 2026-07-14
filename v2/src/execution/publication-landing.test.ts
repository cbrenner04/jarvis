import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landPublication } from "./publication-landing.ts";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "jarvis-publication-landing-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "base"), "base\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

describe("publication landing hooks", () => {
  test("lands intent-stage output and returns its durable path", async () => {
    const root = repo();
    mkdirSync(join(root, ".jarvis-intent-stage"));
    writeFileSync(join(root, ".jarvis-intent-stage", "one.md"), "---\nname: one\n---\n\n## Prerequisites\n");
    const result = await landPublication(
      { kind: "intent-stage", output: { durableDir: "ready-intents" }, stagingDir: ".jarvis-intent-stage", invocationId: "i", baseRef: "HEAD" },
      root,
    );
    expect(result.specPath).toBe("ready-intents");
    expect(existsSync(join(root, ".jarvis-intent-stage"))).toBe(false);
  });

  test("lands a complete plan tree atomically", async () => {
    const root = repo();
    mkdirSync(join(root, ".jarvis-plan-stage"));
    writeFileSync(join(root, ".jarvis-plan-stage", "index.md"), "# Plan\n");
    writeFileSync(join(root, ".jarvis-plan-stage", "00-first.md"), "# First\n");
    const result = await landPublication({ kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: "v2/spec/tree" }, root);
    expect(result.specPath).toBe("v2/spec/tree");
    expect(readFileSync(join(root, "v2/spec/tree/index.md"), "utf8")).toContain("Plan");
  });

  test("retains staged plans on shape failure and rejects differing collisions", async () => {
    const root = repo();
    mkdirSync(join(root, ".jarvis-plan-stage"));
    writeFileSync(join(root, ".jarvis-plan-stage", "index.md"), "# Plan\n");
    await expect(
      landPublication({ kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: "v2/spec/tree" }, root),
    ).rejects.toThrow("invalid shape");
    writeFileSync(join(root, ".jarvis-plan-stage", "00-first.md"), "# staged\n");
    mkdirSync(join(root, "v2/spec/tree"), { recursive: true });
    writeFileSync(join(root, "v2/spec/tree/index.md"), "# different\n");
    await expect(
      landPublication({ kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: "v2/spec/tree" }, root),
    ).rejects.toThrow("different contents");
    expect(existsSync(join(root, ".jarvis-plan-stage"))).toBe(true);
  });

  test("none does not touch the filesystem", async () => {
    const root = repo();
    const result = await landPublication({ kind: "none" }, root);
    expect(result).toEqual({ specPath: "", files: [] });
  });
});
