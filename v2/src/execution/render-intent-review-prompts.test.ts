import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIntentReviewActuatorPrompt, renderIntentReviewCriticPrompt } from "./render-intent-review-prompts.ts";

function stage(): { stagingDir: string; verdictPath: string } {
  const root = mkdtempSync(join(tmpdir(), "intent-review-render-"));
  const stagingDir = join(root, ".jarvis-intent-stage");
  mkdirSync(stagingDir);
  writeFileSync(join(stagingDir, "z-last.md"), "# Last intent", "utf8");
  writeFileSync(join(stagingDir, "a-first.md"), "# First intent", "utf8");
  return { stagingDir, verdictPath: join(root, ".jarvis-intent-review-verdict.md") };
}

describe("intent review prompt rendering", () => {
  test("renders layered critic prompt from every staged intent", () => {
    const context = stage();
    const prompt = renderIntentReviewCriticPrompt(context);

    expect(prompt).toContain("Before editing code, read the relevant durable docs/specs");
    expect(prompt).toContain("# First intent");
    expect(prompt).toContain("# Last intent");
    expect(prompt.indexOf('name="a-first.md"')).toBeLessThan(prompt.indexOf('name="z-last.md"'));
    expect(prompt).toContain(context.verdictPath);
    expect(prompt).not.toBe("intent.prompt.review");
  });

  test("renders the unchanged verdict in the actuator prompt", () => {
    const context = stage();
    const verdict = "  tighten prerequisites\n";
    const prompt = renderIntentReviewActuatorPrompt(context, verdict);

    expect(prompt).toContain("# First intent");
    expect(prompt).toContain("# Last intent");
    expect(prompt).toContain(verdict);
    expect(prompt).toContain("<<<VERDICT_BEGIN>>>");
  });
});
