import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentName, AgentResult } from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import { buildDraftPrompt, runDraftPhase, validateDraftOutput } from "../../../src/modes/plan/draft.ts";
import { hasSpecDirChanges, resolvePlanSpecDirPath, snapshotSpecDirFiles } from "../../../src/modes/plan/spec-dir.ts";

class FakeAgent {
  readonly name: AgentName = "claude";
  constructor(private readonly specDir: string) {}
  async run(): Promise<AgentResult> {
    writeFileSync(join(this.specDir, "index.md"), "# Plan\n\n- [ ] [00 - Task](./00-task.md)\n", "utf8");
    writeFileSync(join(this.specDir, "00-task.md"), "## Acceptance criteria\n- [ ] x\n", "utf8");
    return { kind: "ok", stdout: "", stderr: "" };
  }
  attributionLabel(): string {
    return "fake-claude";
  }
}

describe("resolvePlanSpecDirPath", () => {
  test("defaults to worktree spec layout", () => {
    expect(resolvePlanSpecDirPath("/repo", "my-plan")).toBe("/repo/spec/my-plan");
  });

  test("uses configured targetDir for committed specs", () => {
    expect(resolvePlanSpecDirPath("/repo", "my-plan", undefined, "v1/spec")).toBe("/repo/v1/spec/my-plan");
  });

  test("uses explicit external path", () => {
    expect(resolvePlanSpecDirPath("/repo", "my-plan", "/jarvis/specs/my-plan")).toBe("/jarvis/specs/my-plan");
  });
});

describe("snapshotSpecDirFiles", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects new files in external spec dir", () => {
    dir = mkdtempSync(join(tmpdir(), "jarvis-spec-dir-"));
    writeFileSync(join(dir, "intent.md"), "intent\n", "utf8");
    const before = snapshotSpecDirFiles(dir);
    writeFileSync(join(dir, "index.md"), "# Plan\n", "utf8");
    expect(hasSpecDirChanges(dir, before)).toBe(true);
  });
});

describe("buildDraftPrompt flat layout", () => {
  test("uses working-directory write rule for external specs", () => {
    const prompt = buildDraftPrompt({
      name: "my-plan",
      intent: "do thing",
      specGuidance: "guidance",
      flatSpecLayout: true,
      workDirLabel: "/tmp/spec",
    });
    expect(prompt).toContain("Only write files in the working directory");
    expect(prompt).not.toContain("Only write files under `spec/<NAME>/`");
    expect(prompt).toContain("/tmp/spec");
  });
});

describe("runDraftPhase external spec dir", () => {
  let repoDir: string;
  let specDir: string;

  afterEach(() => {
    if (repoDir) {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("reads intent and validates output from Jarvis-owned storage", async () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-plan-ext-"));
    specDir = join(repoDir, "external-spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "---\nname: my-plan\n---\n", "utf8");

    const config = {
      modes: {
        plan: {
          agentOrder: [{ agent: "claude", model: "sonnet" }],
        },
      },
    } as Config;

    const out = await runDraftPhase({
      worktreePath: repoDir,
      name: "my-plan",
      specDirPath: specDir,
      agentCwd: specDir,
      config,
      createAgent: () => new FakeAgent(specDir),
    });

    expect(out.result.kind).toBe("ok");
    expect(out.subspecCount).toBe(1);

    const validation = validateDraftOutput(repoDir, "my-plan", "---\nname: my-plan\n---\n", specDir);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toEqual([]);
  });
});

describe("plan draft boundary normalization", () => {
  let repoDir: string;

  afterEach(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  for (const layout of ["fresh", "recovery"] as const) {
    test(`${layout} validation normalizes a non-blocked multi-boundary draft`, () => {
      repoDir = mkdtempSync(join(tmpdir(), "jarvis-boundary-normalization-"));
      const specDir = layout === "fresh" ? join(repoDir, "spec", "draft") : join(repoDir, "durable-output");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: draft\n---\n", "utf8");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00 - Runtime surfaces](./00-runtime-surfaces.md)\n", "utf8");
      writeFileSync(
        join(specDir, "00-runtime-surfaces.md"),
        "# Draft\n\n## Acceptance criteria\n\n- [ ] The state-store persists the draft.\n- [ ] The CLI prints the draft.\n",
        "utf8",
      );

      const result = validateDraftOutput(repoDir, "draft", undefined, layout === "recovery" ? specDir : undefined);

      expect(result.valid).toBe(true);
      expect(readdirSync(specDir).sort()).toEqual(["00-persistence.md", "01-cli.md", "index.md", "intent.md"]);
    });
  }
});

describe("anchor grounding in validateDraftOutput", () => {
  let repoDir: string;
  let specDir: string;

  afterEach(() => {
    if (repoDir) {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("warns when behavioral AC lacks anchor", () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-anchor-test-"));
    specDir = join(repoDir, "spec", "test-plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "intent", "utf8");
    writeFileSync(
      join(specDir, "00-task.md"),
      "# Task\n\n## Acceptance criteria\n\n- [ ] plan stops on a hard error\n",
      "utf8",
    );
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00-task](./00-task.md)\n", "utf8");

    const validation = validateDraftOutput(repoDir, "test-plan");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.includes("plan stops on a hard error"))).toBe(true);
  });

  test("does not warn when behavioral AC has test file anchor", () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-anchor-test-"));
    specDir = join(repoDir, "spec", "test-plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "intent", "utf8");
    writeFileSync(
      join(specDir, "00-task.md"),
      "# Task\n\n## Acceptance criteria\n\n- [ ] `plan-draft-hard-error-continue.test.ts` stays green\n",
      "utf8",
    );
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00-task](./00-task.md)\n", "utf8");

    const validation = validateDraftOutput(repoDir, "test-plan");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.every((w) => !w.includes("stays green"))).toBe(true);
  });

  test("does not warn when behavioral AC has source path anchor", () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-anchor-test-"));
    specDir = join(repoDir, "spec", "test-plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "intent", "utf8");
    writeFileSync(
      join(specDir, "00-task.md"),
      "# Task\n\n## Acceptance criteria\n\n- [ ] code in `v1/src/commands/plan.ts` stays unchanged\n",
      "utf8",
    );
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00-task](./00-task.md)\n", "utf8");

    const validation = validateDraftOutput(repoDir, "test-plan");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.every((w) => !w.includes("stays unchanged"))).toBe(true);
  });

  test("warns when trigger AC has only non-path backtick span", () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-anchor-test-"));
    specDir = join(repoDir, "spec", "test-plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "intent", "utf8");
    writeFileSync(
      join(specDir, "00-task.md"),
      '# Task\n\n## Acceptance criteria\n\n- [ ] `patch_phase: "shrink"` is preserved\n',
      "utf8",
    );
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00-task](./00-task.md)\n", "utf8");

    const validation = validateDraftOutput(repoDir, "test-plan");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.includes('patch_phase: "shrink"'))).toBe(true);
  });

  test("does not warn for non-trigger behavioral AC", () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-anchor-test-"));
    specDir = join(repoDir, "spec", "test-plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "intent", "utf8");
    writeFileSync(
      join(specDir, "00-task.md"),
      "# Task\n\n## Acceptance criteria\n\n- [ ] X returns invalid when a subspec lacks AC\n",
      "utf8",
    );
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00-task](./00-task.md)\n", "utf8");

    const validation = validateDraftOutput(repoDir, "test-plan");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.every((w) => !w.includes("returns invalid"))).toBe(true);
  });

  test("draft still commits with anchor warnings", () => {
    repoDir = mkdtempSync(join(tmpdir(), "jarvis-anchor-test-"));
    specDir = join(repoDir, "spec", "test-plan");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "intent", "utf8");
    writeFileSync(
      join(specDir, "00-task.md"),
      "# Task\n\n## Acceptance criteria\n\n- [ ] plan stops on a hard error\n",
      "utf8",
    );
    writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00-task](./00-task.md)\n", "utf8");

    const validation = validateDraftOutput(repoDir, "test-plan");
    expect(validation.valid).toBe(true);
    expect(validation.error).toBeNull();
    expect(validation.warnings.length).toBeGreaterThan(0);
  });
});
