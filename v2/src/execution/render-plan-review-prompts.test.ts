import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPlanReviewActuatorPrompt as renderActuatorPrompt, renderPlanReviewCriticPrompt as renderCriticPrompt } from "../../../shared/prompts/review-plan.ts";

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
