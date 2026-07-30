import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
      {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "i",
        baseRef: "HEAD",
      },
      root,
    );
    expect(result.specPath).toBe("ready-intents/one.md");
    expect(result.specPath).not.toBe("ready-intents");
    expect(existsSync(join(root, ".jarvis-intent-stage"))).toBe(false);
  });

  test("lands every intent before consuming mapped file inputs", async () => {
    const root = repo();
    mkdirSync(join(root, "queue"));
    writeFileSync(join(root, "queue", "one.md"), "one\n");
    writeFileSync(join(root, "queue", "two.md"), "two\n");
    execFileSync("git", ["add", "queue"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "queue"], { cwd: root });
    mkdirSync(join(root, ".jarvis-intent-stage"));
    writeFileSync(join(root, ".jarvis-intent-stage", "one.md"), "---\nname: one\n---\n\n## Prerequisites\n");
    writeFileSync(join(root, ".jarvis-intent-stage", "two.md"), "---\nname: two\n---\n\n## Prerequisites\n");

    const result = await landPublication(
      {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "multi",
        baseRef: "HEAD",
        inputs: {
          sourceRoot: root,
          paths: [join(root, "queue/one.md"), join(root, "queue/two.md")],
          consumeFrom: "worktree",
        },
      },
      root,
    );

    expect(result.specPath).toBe("ready-intents");
    expect(existsSync(join(root, "ready-intents/one.md"))).toBe(true);
    expect(existsSync(join(root, "ready-intents/two.md"))).toBe(true);
    expect(existsSync(join(root, "queue/one.md"))).toBe(false);
    expect(existsSync(join(root, "queue/two.md"))).toBe(false);
  });

  test("consumes safe source inputs only and is idempotent", async () => {
    const source = repo();
    const workspace = repo();
    const external = mkdtempSync(join(tmpdir(), "jarvis-external-input-"));
    mkdirSync(join(source, "queue"));
    writeFileSync(join(source, "queue", "safe.md"), "safe\n");
    writeFileSync(join(external, "outside.md"), "outside\n");
    symlinkSync(join(external, "outside.md"), join(source, "queue", "escaped.md"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"));
    writeFileSync(join(workspace, ".jarvis-intent-stage", "one.md"), "---\nname: one\n---\n\n## Prerequisites\n");
    const landing = {
      kind: "intent-stage" as const,
      output: { durableDir: "ready-intents" },
      stagingDir: ".jarvis-intent-stage",
      invocationId: "safe",
      baseRef: "HEAD",
      inputs: {
        sourceRoot: source,
        paths: [
          join(source, "queue/safe.md"),
          join(source, "queue/escaped.md"),
          join(external, "outside.md"),
          join(source, "missing.md"),
        ],
        consumeFrom: "source" as const,
      },
    };

    await landPublication(landing, workspace);
    await landPublication(landing, workspace);
    expect(existsSync(join(source, "queue/safe.md"))).toBe(false);
    expect(existsSync(join(external, "outside.md"))).toBe(true);
  });

  test("lands a complete plan tree atomically", async () => {
    const root = repo();
    mkdirSync(join(root, ".jarvis-plan-stage"));
    writeFileSync(join(root, ".jarvis-plan-stage", "index.md"), "# Plan\n");
    writeFileSync(join(root, ".jarvis-plan-stage", "intent.md"), "intent\n");
    writeFileSync(join(root, ".jarvis-plan-stage", "00-first.md"), "# First\n");
    const result = await landPublication(
      { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: "v2/spec/tree" },
      root,
    );
    expect(result.specPath).toBe("v2/spec/tree");
    expect(readFileSync(join(root, "v2/spec/tree/index.md"), "utf8")).toContain("Plan");
    expect(readFileSync(join(root, "v2/spec/tree/intent.md"), "utf8")).toBe("intent\n");
  });

  test("lands an optional plan verdict verbatim, including an empty verdict", async () => {
    const root = repo();
    const cases: Array<[string, string]> = [
      ["findings", "final finding\n"],
      ["empty", ""],
    ];
    for (const [name, verdict] of cases) {
      const stage = join(root, `.jarvis-plan-stage-${name}`);
      const durable = `v2/spec/${name}`;
      mkdirSync(stage);
      writeFileSync(join(stage, "index.md"), "# Plan\n");
      writeFileSync(join(stage, "intent.md"), "intent\n");
      writeFileSync(join(stage, "00-first.md"), "# First\n");
      writeFileSync(join(stage, "verdict-plan.md"), verdict);
      await landPublication({ kind: "plan-tree", stagingDir: stage, durablePath: durable }, root);
      expect(readFileSync(join(root, durable, "verdict-plan.md"), "utf8")).toBe(verdict);
    }
  });

  test("retains staged plans on shape failure and rejects differing collisions", async () => {
    const root = repo();
    mkdirSync(join(root, ".jarvis-plan-stage"));
    writeFileSync(join(root, ".jarvis-plan-stage", "index.md"), "# Plan\n");
    await expect(
      landPublication({ kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: "v2/spec/tree" }, root),
    ).rejects.toThrow("invalid shape");
    writeFileSync(join(root, ".jarvis-plan-stage", "intent.md"), "intent\n");
    writeFileSync(join(root, ".jarvis-plan-stage", "00-first.md"), "# staged\n");
    mkdirSync(join(root, "v2/spec/tree"), { recursive: true });
    writeFileSync(join(root, "v2/spec/tree/index.md"), "# different\n");
    await expect(
      landPublication({ kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: "v2/spec/tree" }, root),
    ).rejects.toThrow("different contents");
    expect(existsSync(join(root, ".jarvis-plan-stage"))).toBe(true);
  });

  test("consumes only safe plan inputs after landing and resumes idempotently", async () => {
    const source = repo();
    const workspace = repo();
    const external = mkdtempSync(join(tmpdir(), "jarvis-external-plan-input-"));
    mkdirSync(join(source, "ready-intents"));
    writeFileSync(join(source, "ready-intents/safe.md"), "safe\n");
    writeFileSync(join(external, "outside.md"), "outside\n");
    symlinkSync(join(external, "outside.md"), join(source, "ready-intents/escaped.md"));
    mkdirSync(join(workspace, ".jarvis-plan-stage"));
    writeFileSync(join(workspace, ".jarvis-plan-stage/index.md"), "# Plan\n");
    writeFileSync(join(workspace, ".jarvis-plan-stage/intent.md"), "safe\n");
    writeFileSync(join(workspace, ".jarvis-plan-stage/00-first.md"), "# First\n");
    const landing = {
      kind: "plan-tree" as const,
      stagingDir: ".jarvis-plan-stage",
      durablePath: "v2/spec/tree",
      inputs: {
        sourceRoot: source,
        paths: [
          join(source, "ready-intents/safe.md"),
          join(source, "ready-intents/escaped.md"),
          join(external, "outside.md"),
          join(source, "missing.md"),
        ],
        consumeFrom: "source" as const,
      },
    };

    await landPublication(landing, workspace);
    await landPublication(landing, workspace);
    expect(existsSync(join(source, "ready-intents/safe.md"))).toBe(false);
    expect(existsSync(join(external, "outside.md"))).toBe(true);
  });

  test("none does not touch the filesystem", async () => {
    const root = repo();
    const result = await landPublication({ kind: "none" }, root);
    expect(result).toEqual({ specPath: "", files: [] });
  });
});
