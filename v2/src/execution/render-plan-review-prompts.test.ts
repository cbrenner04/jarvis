import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  executePlanReviewCycle,
  renderActuatorPrompt,
  renderCriticPrompt,
} from "./render-plan-review-prompts.ts";

function binding(
  id: string,
  invoke: InvocationBinding["invoke"],
): InvocationBinding {
  return { id, invoke, metadata: { agent: id, model: id } };
}

describe("renderCriticPrompt", () => {
  test("renders critic prompt with materialized spec context", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "render-critic-"));
    const specDir = join(tmpDir, "spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "Test intent content", "utf8");
    writeFileSync(join(specDir, "index.md"), "# Test Index\n\n- [ ] Item 1", "utf8");
    writeFileSync(join(specDir, "01-test.md"), "# Test Subspec", "utf8");

    const prompt = renderCriticPrompt({
      worktreePath: tmpDir,
      specPath: specDir,
    });

    expect(prompt).toContain("You are conducting an **editorial review**");
    expect(prompt).toContain("Test intent content");
    expect(prompt).toContain("# Test Index");
    expect(prompt).toContain("# Test Subspec");
    expect(prompt).toContain(tmpDir);
  });
});

describe("renderActuatorPrompt", () => {
  test("renders actuator prompt with verdict and materialized spec", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "render-actuator-"));
    const specDir = join(tmpDir, "spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "Test intent", "utf8");
    writeFileSync(join(specDir, "index.md"), "# Index", "utf8");

    const verdict = "Please fix section 1";
    const prompt = renderActuatorPrompt(
      {
        worktreePath: tmpDir,
        specPath: specDir,
      },
      verdict,
    );

    expect(prompt).toContain("You are applying a review verdict");
    expect(prompt).toContain(verdict);
    expect(prompt).toContain("Test intent");
  });
});

describe("executePlanReviewCycle", () => {
  test("persists verdict and applies actuator edits on a positive pass", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan-review-cycle-"));
    const specDir = join(root, "spec", "2026-test-plan");
    mkdirSync(specDir, { recursive: true });
    const subspecPath = join(specDir, "01-test.md");
    writeFileSync(join(specDir, "intent.md"), "Intent", "utf8");
    writeFileSync(join(specDir, "index.md"), "# Index", "utf8");
    writeFileSync(subspecPath, "# Before", "utf8");
    const verdictPath = join(specDir, "verdict-plan.md");

    const result = await executePlanReviewCycle({
      context: { worktreePath: root, specPath: specDir },
      cwd: root,
      verdictPath,
      maxCycles: 1,
      bindings: {
        critic: [
          binding("critic", async () => ({ kind: "ok", stdout: "Tighten acceptance criteria", stderr: "" })),
        ],
        actuator: [
          binding("actuator", async () => {
            writeFileSync(subspecPath, "# After review", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }),
        ],
      },
    });

    expect(result.cycles).toEqual([{ kind: "completed", verdict: "Tighten acceptance criteria", actuatorRan: true }]);
    expect(readFileSync(verdictPath, "utf8")).toBe("Tighten acceptance criteria");
    expect(readFileSync(subspecPath, "utf8")).toBe("# After review");
  });

  test("rejects critic filesystem writes and leaves the spec tree unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan-review-critic-ro-"));
    const specDir = join(root, "spec", "2026-test-plan");
    mkdirSync(specDir, { recursive: true });
    const subspecPath = join(specDir, "01-test.md");
    writeFileSync(join(specDir, "intent.md"), "Intent", "utf8");
    writeFileSync(join(specDir, "index.md"), "# Index", "utf8");
    writeFileSync(subspecPath, "# Before", "utf8");
    const verdictPath = join(specDir, "verdict-plan.md");

    const result = await executePlanReviewCycle({
      context: { worktreePath: root, specPath: specDir },
      cwd: root,
      verdictPath,
      maxCycles: 1,
      bindings: {
        critic: [
          binding("critic", async () => {
            writeFileSync(subspecPath, "# Critic edit", "utf8");
            return { kind: "ok", stdout: "verdict", stderr: "" };
          }),
        ],
        actuator: [binding("actuator", async () => ({ kind: "ok", stdout: "done", stderr: "" }))],
      },
    });

    expect(result.cycles[0]).toMatchObject({ kind: "role_failed", failedRole: "critic", failureKind: "error" });
    expect(readFileSync(subspecPath, "utf8")).toBe("# Before");
    if (existsSync(verdictPath)) {
      expect(readFileSync(verdictPath, "utf8")).toBe("");
    }
  });
});
