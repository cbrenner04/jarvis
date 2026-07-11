import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import {
  executePatchReviewCycle,
  nextReviewDebateCycleContext,
  PATCH_REVIEW_CRITIC_PROMPT_ID,
  PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS,
  type ReviewDebateRenderContext,
  renderPatchReviewCriticPrompt,
  renderReviewDebateActuatorPrompt,
  renderReviewDebateCyclePrompts,
  renderReviewDebateRolePrompt,
} from "./review-debate-render.ts";

function setupPatchReviewRepo(): { dir: string; specPath: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "review-debate-render-"));
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

function baseContext(
  dir: string,
  specPath: string,
  overrides: Partial<ReviewDebateRenderContext> = {},
): ReviewDebateRenderContext {
  return {
    specPath,
    cwd: dir,
    passNumber: 1,
    totalPasses: 1,
    ...overrides,
  };
}

describe("PATCH_REVIEW_CRITIC_PROMPT_ID", () => {
  test("resolves critic prompt with governed metadata", () => {
    const registry = loadPromptRegistry();
    const artifact = registry.getById(PATCH_REVIEW_CRITIC_PROMPT_ID);
    expect(artifact.metadata.kind).toBe("step");
    expect(artifact.metadata.behavior).toBe("patch");
    expect(artifact.metadata.placeholders?.map((entry) => entry.name)).toEqual([
      "SPEC_PATH",
      "SPEC_TREE",
      "BRANCH_DIFF",
      "REVIEW_PASS_NUMBER",
      "REVIEW_PASS_CONTEXT",
    ]);
  });
});

describe("renderPatchReviewCriticPrompt", () => {
  test("injects spec tree, branch diff, and pass context from shared patch-review sources", () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    try {
      const prompt = renderPatchReviewCriticPrompt(
        baseContext(dir, specPath, {
          totalPasses: 2,
          passNumber: 2,
          priorCycleVerdict: "Tighten error handling on empty input",
        }),
      );

      expect(prompt).toContain("read-only");
      expect(prompt).toContain("emit an empty verdict");
      expect(prompt).not.toContain("adversary");
      expect(prompt).not.toContain("advocate");
      expect(prompt).toContain(specPath);
      expect(prompt).toContain("# Feature");
      expect(prompt).toContain("# 00");
      expect(prompt).toContain("impl.txt");
      expect(prompt).toContain("This is review pass 2 of 2.");
      expect(prompt).toContain("Prior cycle verdict:");
      expect(prompt).toContain("Tighten error handling on empty input");
    } finally {
      cleanup();
    }
  });
});

describe("PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS", () => {
  test("binds debate roles to patch review prompt ids", () => {
    const registry = loadPromptRegistry();
    expect(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adversary).toBe("patch.prompt.review.adversary");
    expect(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.advocate).toBe("patch.prompt.review.advocate");
    expect(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adjudicator).toBe("patch.prompt.review.adjudicator");
    for (const id of Object.values(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS)) {
      expect(registry.getById(id).metadata.kind).toBe("step");
    }
  });
});

describe("renderReviewDebateRolePrompt", () => {
  test("injects spec tree, branch diff, and pass number", () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    try {
      const prompt = renderReviewDebateRolePrompt(
        "adversary",
        baseContext(dir, specPath, { totalPasses: 2, passNumber: 2 }),
      );

      expect(prompt).toContain("critical review");
      expect(prompt).toContain(specPath);
      expect(prompt).toContain("# Feature");
      expect(prompt).toContain("# 00");
      expect(prompt).toContain("impl.txt");
      expect(prompt).toContain("This is review pass 2 of 2.");
    } finally {
      cleanup();
    }
  });
});

describe("renderReviewDebateCyclePrompts", () => {
  test("chains prior-role output within a cycle", () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    try {
      const context = baseContext(dir, specPath);
      const prompts = renderReviewDebateCyclePrompts(context, {
        adversary: "Missing edge case in parser",
        advocate: "Parser scope excludes that path by design",
      });

      expect(prompts.advocate).toContain("Missing edge case in parser");
      expect(prompts.advocate).toContain("<<<ADVERSARY_BEGIN>>>");
      expect(prompts.adjudicator).toContain("Parser scope excludes that path by design");
      expect(prompts.adjudicator).toContain("<<<ADVOCATE_BEGIN>>>");
    } finally {
      cleanup();
    }
  });

  test("carries prior cycle verdict into the next cycle adversary render", () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    try {
      const cycleOne = baseContext(dir, specPath, { passNumber: 1, totalPasses: 2 });
      const cycleTwo = nextReviewDebateCycleContext(cycleOne, "Tighten error handling on empty input");
      const prompt = renderReviewDebateRolePrompt("adversary", cycleTwo);

      expect(prompt).toContain("This is review pass 2 of 2.");
      expect(prompt).toContain("Prior cycle verdict:");
      expect(prompt).toContain("Tighten error handling on empty input");
    } finally {
      cleanup();
    }
  });
});

describe("renderReviewDebateActuatorPrompt", () => {
  test("derives actuator prompt from patch verdict actuator template", () => {
    const prompt = renderReviewDebateActuatorPrompt("Fix the null guard", "spec/feature/index.md");

    expect(prompt).toContain("Review Actuator Rules");
    expect(prompt).toContain("Fix the null guard");
    expect(prompt).toContain("do not edit spec files");
  });
});

describe("executePatchReviewCycle", () => {
  test("renders critic per cycle, skips actuator on empty verdict, and uses patch actuator prompt", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const verdictPath = join(dir, "verdict-patch.md");
    const prompts: string[] = [];
    try {
      const result = await executePatchReviewCycle({
        cwd: dir,
        context: { specPath, cwd: dir, baseBranch: "main" },
        verdictPath,
        maxCycles: 2,
        bindings: {
          critic: [
            {
              id: "critic",
              invoke: async ({ prompt }) => {
                prompts.push(prompt);
                const pass = prompts.filter((entry) => entry.includes("read-only")).length;
                return { kind: "ok" as const, stdout: pass === 1 ? "fix it" : "", stderr: "" };
              },
            },
          ],
          actuator: [
            {
              id: "actuator",
              invoke: async ({ prompt }) => {
                prompts.push(prompt);
                return { kind: "ok" as const, stdout: "done", stderr: "" };
              },
            },
          ],
        },
      });

      expect(result.cycles).toHaveLength(2);
      expect(result.cycles[0]).toMatchObject({ kind: "completed", actuatorRan: true });
      expect(result.cycles[1]).toMatchObject({ kind: "completed", actuatorRan: false });
      expect(prompts[0]).toContain("read-only");
      expect(prompts[0]).toContain("This is review pass 1 of 2.");
      expect(prompts[1]).toContain("Review Actuator Rules");
      expect(prompts[1]).toContain("fix it");
      expect(prompts[2]).toContain("This is review pass 2 of 2.");
      expect(prompts[2]).toContain("Prior cycle verdict:");
      expect(prompts.some((entry) => entry === "fix it")).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("does not fail when the critic edits files", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const verdictPath = join(dir, "verdict-patch.md");
    try {
      const result = await executePatchReviewCycle({
        cwd: dir,
        context: { specPath, cwd: dir, baseBranch: "main" },
        verdictPath,
        maxCycles: 1,
        bindings: {
          critic: [
            {
              id: "critic",
              invoke: async () => {
                writeFileSync(join(dir, "critic-edit.txt"), "oops\n");
                return { kind: "ok" as const, stdout: "still apply this", stderr: "" };
              },
            },
          ],
          actuator: [
            {
              id: "actuator",
              invoke: async () => ({ kind: "ok" as const, stdout: "done", stderr: "" }),
            },
          ],
        },
      });

      expect(result.cycles).toEqual([expect.objectContaining({ kind: "completed", actuatorRan: true })]);
      expect(readFileSync(join(dir, "critic-edit.txt"), "utf8")).toBe("oops\n");
    } finally {
      cleanup();
    }
  });
});
