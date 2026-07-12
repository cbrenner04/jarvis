import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPromptRegistry } from "../../shared/prompts/registry.ts";
import { buildPrompt, buildVerdictActuatorPrompt, readRepoGuidance } from "../src/modes/patch/prompt.ts";

function withTempRepo(run: (root: string) => void): void {
  const root = join(import.meta.dir, ".tmp-prompt-test", String(Date.now()));
  mkdirSync(root, { recursive: true });
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("buildPrompt", () => {
  test("inlines harness-selected active subspec and omits routing prose", () => {
    const prompt = buildPrompt("spec/example/index.md", undefined, {
      activeSubspecPath: "spec/example/00-task.md",
      activeSubspecBody: "# Task\n\n## Acceptance criteria\n\n- [ ] done",
    });
    const rules = loadPromptRegistry().getById("patch.rules").body.trim();

    expect(prompt).toContain("<<<ACTIVE_SUBSPEC_BEGIN>>>");
    expect(prompt).toContain("spec/example/00-task.md");
    expect(prompt).toContain("# Task");
    expect(prompt).toContain("<<<ACTIVE_SUBSPEC_END>>>");
    expect(prompt).not.toContain("first unchecked");
    expect(prompt).not.toContain("Inspect the target repo for guidance");
    expect(prompt).not.toContain("Pick the single most important unchecked task");
    expect(prompt).toContain("Work the harness-injected active subspec only.");
    expect(prompt).toContain(rules);
  });

  test("omits sibling subspec bodies and index checklist prose", () => {
    const prompt = buildPrompt("spec/example/index.md", undefined, {
      activeSubspecPath: "spec/example/00-task.md",
      activeSubspecBody: "# Active only",
    });

    expect(prompt).not.toContain("01-other.md");
    expect(prompt).not.toContain("- [ ] [01");
    expect(prompt).not.toContain("<<<FILE name=");
    expect(prompt).toContain("# Active only");
  });

  test("direct non-index spec path inlines that file and omits index routing", () => {
    const subspecPath = "spec/example/01-task.md";
    const prompt = buildPrompt(subspecPath, undefined, {
      activeSubspecPath: subspecPath,
      activeSubspecBody: "# Direct subspec",
    });

    expect(prompt).toContain(`Read the spec at ${subspecPath}.`);
    expect(prompt).toContain(subspecPath);
    expect(prompt).toContain("# Direct subspec");
    expect(prompt).not.toContain("first unchecked");
    expect(prompt).not.toContain("Pick the single most important unchecked task");
  });

  test("undefined linked subspec omits active-subspec block", () => {
    const prompt = buildPrompt("spec/example/index.md");

    expect(prompt).not.toContain("<<<ACTIVE_SUBSPEC_BEGIN>>>");
    expect(prompt).not.toContain("<<<ACTIVE_SUBSPEC_END>>>");
    expect(prompt).not.toContain("## Active Subspec");
  });

  test("inlines repo guidance from project root when present", () => {
    withTempRepo((root) => {
      writeFileSync(join(root, "AGENTS.md"), "# Agents\nRun tests.");
      writeFileSync(join(root, "CLAUDE.md"), "# Claude\nBe terse.");

      const guidance = readRepoGuidance(root);
      const prompt = buildPrompt("spec/example/index.md", undefined, {
        repoGuidance: guidance,
        activeSubspecPath: "spec/example/00-task.md",
        activeSubspecBody: "# Task",
      });

      expect(guidance).toContain("# Agents");
      expect(guidance).toContain("# Claude");
      expect(prompt).toContain("<<<REPO_GUIDANCE_BEGIN>>>");
      expect(prompt).toContain("# Agents");
      expect(prompt).toContain("# Claude");
      expect(prompt).toContain("<<<REPO_GUIDANCE_END>>>");
    });
  });

  test("omits repo-guidance block when files are absent", () => {
    withTempRepo((root) => {
      expect(readRepoGuidance(root)).toBe("");
      const prompt = buildPrompt("spec/example/index.md", undefined, {
        repoGuidance: "",
        activeSubspecPath: "spec/example/00-task.md",
        activeSubspecBody: "# Task",
      });
      expect(prompt).not.toContain("<<<REPO_GUIDANCE_BEGIN>>>");
      expect(prompt).not.toContain("## Repo Guidance");
    });
  });

  test("passes the spec path through verbatim with no resolution or quoting", () => {
    const weird = "/tmp/some dir/spec.md";
    expect(buildPrompt(weird)).toContain(`Read the spec at ${weird}.`);
  });

  test("keeps sibling-directory block placement and newline joining unchanged", () => {
    const prompt = buildPrompt("spec/path.md", ["../repo-a", "../repo-b"]);
    expect(prompt).toContain("Additional project sibling directories are available for this run:");
    expect(prompt).toContain("- ../repo-a");
    expect(prompt).toContain("- ../repo-b");
    expect(prompt).toContain("Treat these directories as part of the target project");
  });

  test("includes guidance that agent should not run git commit", () => {
    const prompt = buildPrompt("spec/example/index.md");
    expect(prompt).toContain("git commit");
  });

  test("directs continuation when a timeout checkpoint is present", () => {
    const prompt = buildPrompt("spec/example/index.md", undefined, {
      timeoutCheckpointContext: "Partial implementation is present; inspect and continue.",
    });
    expect(prompt).toContain("## Timeout Checkpoint");
    expect(prompt).toContain("Partial implementation is present; inspect and continue.");
  });
});

describe("buildVerdictActuatorPrompt", () => {
  test("uses migrated patch prompt without repo guidance or active subspec", () => {
    const prompt = buildVerdictActuatorPrompt("fix tests", "spec/feature/index.md");

    expect(prompt).not.toContain("<<<REPO_GUIDANCE_BEGIN>>>");
    expect(prompt).not.toContain("<<<ACTIVE_SUBSPEC_BEGIN>>>");
    expect(prompt).not.toContain("first unchecked");
    expect(prompt).not.toContain("Inspect the target repo for guidance");
    expect(prompt).toContain("## Review Verdict");
    expect(prompt).toContain("fix tests");
  });
});
