import { describe, expect, test } from "bun:test";
import { DEFAULT_WRITE_STEP_RULES } from "../../v2/src/execution/write-loop-input.ts";
import {
  buildIntentSplitPrompt,
  INTENT_SPLIT_BASELINE_BODY_LENGTH,
  INTENT_SPLIT_MAX_BODY_GROWTH,
  INTENT_SPLIT_PROMPT_ID,
  INTENT_SPLIT_SURFACE_PIN,
} from "./intent-split.ts";
import { loadPromptRegistry } from "./registry.ts";

const BASE_OPTS = {
  workdir: "/tmp/worktree",
  seedLabel: "inline",
  seedContent: "Split reporting",
  stagingDir: ".jarvis-intent-stage",
};

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

const HUMAN_ONLY_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.";

describe("buildIntentSplitPrompt", () => {
  test("intent split prompt states landing filename contract", () => {
    const prompt = buildIntentSplitPrompt(BASE_OPTS);

    expect(prompt).toContain("<name>.md");
    expect(prompt).toContain("no `NN-` ordering prefix");
  });

  test("includes governed layering, file output, and optional step rules", () => {
    const prompt = buildIntentSplitPrompt({ ...BASE_OPTS, stepRules: DEFAULT_WRITE_STEP_RULES });

    expect(prompt).toContain("Before editing code, read the relevant durable docs/specs");
    expect(prompt).toContain("Be terse in communication artifacts");
    const terseIndex = prompt.indexOf("Be terse in communication artifacts");
    // @mutate prompts/global/no-hard-wrap.md "behavior: global" -> "behavior: archived"
    const noHardWrapIndex = prompt.indexOf("Do not hard-wrap authored markdown");
    expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
    expect(prompt).toContain("one prerequisite behavior per physical line as `- ...`");
    expect(prompt).toContain("Write the authored intents as markdown files under `.jarvis-intent-stage`");
    const stepRules = prompt.split("## Step completion\n\n")[1];
    expect(stepRules).toBe(DEFAULT_WRITE_STEP_RULES);
    expect(stepRules).toContain(HUMAN_ONLY_STEP_RULES);
    expect(prompt).not.toContain("No planning labels in code.");
    expect(INTENT_SPLIT_PROMPT_ID).toBe("intent.prompt.split");
  });

  test("omits step completion section when stepRules is absent", () => {
    const prompt = buildIntentSplitPrompt(BASE_OPTS);

    expect(prompt).not.toContain("## Step completion");
  });

  test("intent split prompt pins surface fan-out rule", () => {
    const prompt = buildIntentSplitPrompt(BASE_OPTS);

    expect(normalize(prompt)).toContain(INTENT_SPLIT_SURFACE_PIN);
  });

  const artifact = loadPromptRegistry().getById(INTENT_SPLIT_PROMPT_ID);

  test("intent split prompt rejects symptom slice fan-out", () => {
    const prompt = buildIntentSplitPrompt(BASE_OPTS);

    for (const body of [artifact.body, prompt]) {
      expect(body).not.toContain("independently observable behavior slices");
      expect(body).not.toContain("vertical slices");
      expect(body).not.toContain("umbrella bundles");
      expect(body).not.toMatch(/split the seed into .*slices/i);
    }
  });

  test("intent split prompt requires single-surface unsplit", () => {
    const normalized = normalize(artifact.body);

    expect(normalized).toContain("touches exactly one module-boundary surface");
    expect(normalized).toContain("state in one line in that intent's body why splitting does not apply");
    expect(normalized).not.toContain("already one independently observable behavior");
  });

  test("intent split prompt wires prerequisite behaviors", () => {
    const normalized = normalize(artifact.body);

    expect(normalized).toContain("wire each earlier surface's behaviors into every later");
    expect(normalized).toContain("declared for the operator and later plan runs to honor");
    expect(normalized).not.toContain("do not try to enforce execution order");
  });

  test("intent split artifact growth stays within budget", () => {
    expect(artifact.body.length).toBeLessThanOrEqual(INTENT_SPLIT_BASELINE_BODY_LENGTH + INTENT_SPLIT_MAX_BODY_GROWTH);
  });

  test("intent split artifact has no examples or thresholds", () => {
    expect(artifact.body).not.toContain("```");
    expect(artifact.body).not.toMatch(/\be\.g\./i);
    expect(artifact.body).not.toMatch(/\bfor example\b/i);
    expect(artifact.body).not.toMatch(/\d+\s*(files?|symptoms?|slices?|lines?|surfaces?)\b/i);
  });

  test("intent split artifact revision bumped past baseline", () => {
    expect(Number(artifact.metadata.revision)).toBeGreaterThan(1);
  });
});
