import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../../../shared/prompts/step-rules.ts";
import { buildPrDescriptionPrompt as buildPatchPrDescriptionPrompt } from "../../src/modes/patch/pr-description-prompt.ts";
import { buildReviewPrompt as buildPatchReviewPrompt, buildPrompt } from "../../src/modes/patch/prompt.ts";
import { buildDraftPrompt } from "../../src/modes/plan/draft.ts";
import { buildPrDescriptionPrompt as buildPlanPrDescriptionPrompt } from "../../src/modes/plan/pr-description-prompt.ts";
import { buildReviewPrompt } from "../../src/modes/plan/review.ts";
import { buildVerdictActuatorPrompt } from "../../src/modes/plan/verdict-actuator.ts";

type WrapperVariant = "codex.exec.stdin+marker";

function applyWrapper(variant: WrapperVariant, rendered: string): string {
  switch (variant) {
    case "codex.exec.stdin+marker":
      return `${rendered}\n<!-- jarvis-codex-invocation: fixture -->`;
    default: {
      const neverVariant: never = variant;
      throw new Error(`unknown wrapper variant: ${neverVariant}`);
    }
  }
}

function fixturePath(name: string): string {
  return join(import.meta.dir, "..", "fixtures", "prompts", "rendered", name);
}

function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

function setupPatchReviewSnapshotRepo(): { dir: string; specPath: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "jarvis-patch-review-snapshot-"));
  const dir = join(parent, "repo");
  const origin = join(parent, "origin.git");
  mkdirSync(dir);
  execSync(`git init --bare -b main ${origin}`);
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  execSync(`git remote add origin ${origin}`, { cwd: dir });
  const specDir = join(dir, "spec", "feature");
  mkdirSync(specDir, { recursive: true });
  const specPath = "spec/feature/index.md";
  writeFileSync(join(dir, specPath), "# Feature\n\n- [x] [00](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# 00\n\n## Acceptance criteria\n\n- [x] done\n");
  writeFileSync(join(dir, "impl.txt"), "seed\n");
  execSync("git add -A", { cwd: dir });
  execSync("git commit -m 'seed'", { cwd: dir });
  execSync("git push -u origin main", { cwd: dir });
  execSync("git checkout -b feature", { cwd: dir });
  writeFileSync(join(dir, "impl.txt"), "changed\n");
  execSync("git add impl.txt", { cwd: dir });
  execSync("git commit -m 'impl'", { cwd: dir });
  return { dir, specPath, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

describe("rendered prompt snapshots", () => {
  const registry = loadPromptRegistry();

  test("shared snapshots are keyed by id and revision", () => {
    expect(registry.getById("patch.prompt.body").metadata.revision).toBe("10");
    expect(registry.getById("plan.prompt.draft").metadata.revision).toBe("11");
    expect(registry.getById("plan.prompt.review").metadata.revision).toBe("6");
    expect(registry.getById("plan.prompt.review.adversary").metadata.revision).toBe("3");
    expect(registry.getById("plan.prompt.review.advocate").metadata.revision).toBe("2");
    expect(registry.getById("plan.prompt.review.critic").metadata.revision).toBe("1");
    expect(registry.getById("plan.prompt.review.adjudicator").metadata.revision).toBe("2");
    expect(registry.getById("plan.prompt.review-actuator").metadata.revision).toBe("4");

    const patchKey = `${registry.getById("patch.prompt.body").metadata.id}@r${registry.getById("patch.prompt.body").metadata.revision}.shared.txt`;
    const draftKey = `${registry.getById("plan.prompt.draft").metadata.id}@r${registry.getById("plan.prompt.draft").metadata.revision}.shared.txt`;
    const reviewStepOneKey = `${registry.getById("plan.prompt.review.adversary").metadata.id}@r${registry.getById("plan.prompt.review.adversary").metadata.revision}.pass-1.shared.txt`;
    const reviewStepTwoKey = `${registry.getById("plan.prompt.review.adversary").metadata.id}@r${registry.getById("plan.prompt.review.adversary").metadata.revision}.pass-2.shared.txt`;
    const advocateKey = `${registry.getById("plan.prompt.review.advocate").metadata.id}@r${registry.getById("plan.prompt.review.advocate").metadata.revision}.pass-1.shared.txt`;
    const adjudicatorKey = `${registry.getById("plan.prompt.review.adjudicator").metadata.id}@r${registry.getById("plan.prompt.review.adjudicator").metadata.revision}.pass-1.shared.txt`;
    const reviewActuatorKey = `${registry.getById("plan.prompt.review-actuator").metadata.id}@r${registry.getById("plan.prompt.review-actuator").metadata.revision}.shared.txt`;
    const criticKey = `${registry.getById("plan.prompt.review.critic").metadata.id}@r${registry.getById("plan.prompt.review.critic").metadata.revision}.pass-1.shared.txt`;

    const patch = buildPrompt("v1/spec/example/index.md", ["../shared-lib", "../infra"]);
    const draft = buildDraftPrompt({
      name: "prompt-registry",
      intent: "Intent with <SPEC_GUIDANCE> token",
      specGuidance: "Guidance block",
    });
    const reviewPass1 = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec: '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      passNumber: 1,
      totalPasses: 2,
    });
    const reviewPass2 = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec: '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      passNumber: 2,
      totalPasses: 2,
    });
    const reviewActuator = buildVerdictActuatorPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec: '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      verdict: "Verdict",
    });
    const advocate = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec: '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      role: "advocate",
      priorArtifact: "Adversary finding",
    });
    const critic = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec: '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      role: "critic",
    });
    const adjudicator = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec: '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      role: "adjudicator",
      priorArtifact: "Advocate response",
    });

    expect(patch).toBe(readFixture(patchKey));
    expect(patch).toContain(DEFAULT_WRITE_STEP_RULES);
    expect(patch.endsWith(DEFAULT_WRITE_STEP_RULES)).toBe(true);
    expect(draft).toBe(readFixture(draftKey));
    expect(reviewPass1).toBe(readFixture(reviewStepOneKey));
    expect(reviewPass2).toBe(readFixture(reviewStepTwoKey));
    expect(advocate).toBe(readFixture(advocateKey).trimEnd());
    expect(critic).toBe(readFixture(criticKey).trimEnd());
    expect(adjudicator).toBe(readFixture(adjudicatorKey).trimEnd());
    expect(reviewActuator).toBe(readFixture(reviewActuatorKey));
  });

  test("patch review snapshots are keyed by id and revision", () => {
    expect(registry.getById("patch.prompt.review.adversary").metadata.revision).toBe("2");

    const adversaryKey = `${registry.getById("patch.prompt.review.adversary").metadata.id}@r${registry.getById("patch.prompt.review.adversary").metadata.revision}.pass-1.shared.txt`;
    const adversaryPassTwoKey = `${registry.getById("patch.prompt.review.adversary").metadata.id}@r${registry.getById("patch.prompt.review.adversary").metadata.revision}.pass-2.shared.txt`;

    const { dir, specPath, cleanup } = setupPatchReviewSnapshotRepo();
    try {
      const reviewPass1 = buildPatchReviewPrompt({
        specPath,
        cwd: dir,
        passNumber: 1,
        totalPasses: 2,
        baseBranch: "main",
        role: "adversary",
      });
      const reviewPass2 = buildPatchReviewPrompt({
        specPath,
        cwd: dir,
        passNumber: 2,
        totalPasses: 2,
        baseBranch: "main",
        role: "adversary",
      });

      expect(reviewPass1).toBe(readFixture(adversaryKey));
      expect(reviewPass2).toBe(readFixture(adversaryPassTwoKey));
    } finally {
      cleanup();
    }
  });

  test("wrapper snapshots are separate from shared snapshots and include wrapper variant", () => {
    const artifact = registry.getById("patch.prompt.body");
    const key = `${artifact.metadata.id}@r${artifact.metadata.revision}.wrapper.codex.exec.stdin+marker.txt`;
    const shared = buildPrompt("v1/spec/example/index.md");

    const wrapped = applyWrapper("codex.exec.stdin+marker", shared);

    expect(wrapped).toBe(readFixture(key));
  });

  test("wrapper selection is explicit", () => {
    const rendered = "prompt";
    expect(applyWrapper("codex.exec.stdin+marker", rendered)).toContain("jarvis-codex-invocation");
  });

  test("patch and plan PR-description prompts include shared fragment", () => {
    expect(registry.getById("patch.prompt.pr-description").metadata.revision).toBe("2");
    expect(registry.getById("plan.prompt.pr-description").metadata.revision).toBe("2");

    const patchKey = `patch.prompt.pr-description@r2.shared.txt`;
    const planKey = `plan.prompt.pr-description@r2.shared.txt`;

    const patch = buildPatchPrDescriptionPrompt({
      specPath: "v1/spec/example/index.md",
      specContext: "Example spec context",
    });
    const plan = buildPlanPrDescriptionPrompt({
      intent: "Example intent",
      specContext: "Example spec context",
    });

    expect(patch).toBe(readFixture(patchKey));
    expect(plan).toBe(readFixture(planKey));

    // Verify both include the shared fragment text
    const sharedFragmentMarker = "Author a PR description consisting of a short summary";
    expect(patch).toContain(sharedFragmentMarker);
    expect(plan).toContain(sharedFragmentMarker);
  });
});
