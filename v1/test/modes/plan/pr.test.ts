// updatePlanPrBody/generatePrDescription route gh access through injectable seams
// (fetchPrBody, writePrBody, renderFooter, agent), so these cases need no real git/gh
// subprocess. renderPlanAttribution (real `git log` via readBranchCommits) and
// maybeMarkPlanPrReady (real `git status` via ready-gate.ts's unseamed readPorcelain)
// stay in pr.sandbox-unrunnable.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentResult } from "../../../src/agents/types.ts";
import { buildPlanPrHeader, generatePrDescription, updatePlanPrBody } from "../../../src/modes/plan/pr.ts";
import {
  extractNarrative,
  markGeneratedNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
} from "../../../src/pr.ts";

describe("buildPlanPrHeader", () => {
  test("builds header with correct name interpolation", () => {
    const header = buildPlanPrHeader({ name: "my-feature" });
    expect(header).toContain("spec/my-feature/");
    expect(header).toContain("spec/my-feature/intent.md");
    expect(header).toContain("spec/my-feature/index.md");
  });

  test("uses capitalized fallback title 'Plan: <name>'", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).toContain("# Plan: test");
  });

  test("includes intent and index file references", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).toContain("- Intent: `spec/test/intent.md`");
    expect(header).toContain("- Index: `spec/test/index.md`");
  });

  test("is deterministic - same input produces same output", () => {
    const header1 = buildPlanPrHeader({ name: "feature-a" });
    const header2 = buildPlanPrHeader({ name: "feature-a" });
    expect(header1).toBe(header2);
  });

  test("renders as markdown text, not HTML", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("<");
    expect(header).not.toContain(">");
  });

  test("never includes Progress line or checklist", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("## Progress");
    expect(header).not.toContain("- [ ]");
    expect(header).not.toContain("- [x]");
  });

  test("does not include prose paragraphs about reviewing and merging", () => {
    const header = buildPlanPrHeader({ name: "test" });
    expect(header).not.toContain("This PR was authored by");
    expect(header).not.toContain("Plan mode never marks");
    expect(header).not.toContain("Implementation work begins");
  });
});

describe("extractNarrative - shared utility", () => {
  test("extracts narrative between markers", () => {
    const body = `header
${NARRATIVE_START_MARKER}
This is narrative content.
${NARRATIVE_END_MARKER}
footer`;
    expect(extractNarrative(body)).toBe("This is narrative content.");
  });

  test("returns null when markers are missing", () => {
    const body = "just body text";
    expect(extractNarrative(body)).toBeNull();
  });

  test("trims whitespace around narrative", () => {
    const body = `${NARRATIVE_START_MARKER}

  narrative text

${NARRATIVE_END_MARKER}`;
    expect(extractNarrative(body)).toBe("narrative text");
  });
});

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "plan-pr-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("updatePlanPrBody", () => {
  const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
  const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

  function mockAgent(response: string = "Generated body\n\nDecisions:\n- Did the thing"): Agent {
    const wrappedResponse = `${PR_DESCRIPTION_BEGIN}\n${response}\n${PR_DESCRIPTION_END}`;
    return {
      name: "claude",
      async run(): Promise<AgentResult> {
        return { kind: "ok", stdout: wrappedResponse, stderr: "" };
      },
      attributionLabel: () => "test-agent",
    };
  }

  function writeSpec(targetDir: string): string {
    const specDirPath = join(workDir, targetDir, "my-feat");
    mkdirSync(specDirPath, { recursive: true });
    writeFileSync(join(specDirPath, "index.md"), "# Real Spec Title\n\n- [x] [00 - a](./00-a.md)\n");
    writeFileSync(join(specDirPath, "intent.md"), "intent body\n");
    return specDirPath;
  }

  test("threads targetDir so the header keeps the real title and pointers", async () => {
    const specDirPath = writeSpec("v1/spec");
    let written = "";
    await updatePlanPrBody({
      indexPath: join(specDirPath, "index.md"),
      specDirPath,
      branch: "feature",
      base: "base",
      cwd: workDir,
      targetDir: "v1/spec",
      fetchPrBody: () => "",
      writePrBody: (_b, body) => {
        written = body;
      },
      renderFooter: () => "",
    });
    // Regression: without targetDir threading the header fell back to
    // "# Plan: my-feat" and "spec/..." pointers.
    expect(written).toContain("# Real Spec Title");
    expect(written).toContain("`v1/spec/my-feat/intent.md`");
    expect(written).toContain("`v1/spec/my-feat/index.md`");
    expect(written).not.toContain("# Plan: my-feat");
  });

  test("regenerates the narrative when empty and an agent is provided", async () => {
    const specDirPath = writeSpec("v1/spec");
    let written = "";
    await updatePlanPrBody({
      indexPath: join(specDirPath, "index.md"),
      specDirPath,
      branch: "feature",
      base: "base",
      cwd: workDir,
      targetDir: "v1/spec",
      prNarrative: "agent",
      intentContent: "intent body",
      agent: mockAgent(),
      fetchPrBody: () => "",
      writePrBody: (_b, body) => {
        written = body;
      },
      renderFooter: () => "",
    });
    expect(written).toContain(NARRATIVE_START_MARKER);
    expect(written).toContain("Generated body");
    expect(written).toContain("Decisions:");
    expect(written).toContain(NARRATIVE_END_MARKER);
  });

  test("regenerates machine-owned narrative when hash still matches", async () => {
    const specDirPath = writeSpec("v1/spec");
    let written = "";
    await updatePlanPrBody({
      indexPath: join(specDirPath, "index.md"),
      specDirPath,
      branch: "feature",
      base: "base",
      cwd: workDir,
      targetDir: "v1/spec",
      prNarrative: "agent",
      intentContent: "intent body",
      agent: mockAgent("Fresh body\n\nDecisions:\n- Fresh choice"),
      fetchPrBody: () =>
        `${NARRATIVE_START_MARKER}\n${markGeneratedNarrative("Old body\n\nDecisions:\n- Old choice")}\n${NARRATIVE_END_MARKER}`,
      writePrBody: (_b, body) => {
        written = body;
      },
      renderFooter: () => "",
    });
    expect(written).toContain("Fresh body");
    expect(written).not.toContain("Old body");
  });

  test("preserves human-edited narrative verbatim and does not call the agent", async () => {
    const specDirPath = writeSpec("v1/spec");
    const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
    const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

    let ran = false;
    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        ran = true;
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nREGEN\n\nDecisions:\n- x\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel: () => "test-agent",
    };
    const existing = `# Real Spec Title\n\n${NARRATIVE_START_MARKER}\nHuman wrote this\n${NARRATIVE_END_MARKER}`;
    let written = "";
    await updatePlanPrBody({
      indexPath: join(specDirPath, "index.md"),
      specDirPath,
      branch: "feature",
      base: "base",
      cwd: workDir,
      targetDir: "v1/spec",
      prNarrative: "agent",
      intentContent: "intent body",
      agent,
      fetchPrBody: () => existing,
      writePrBody: (_b, body) => {
        written = body;
      },
      renderFooter: () => "",
    });
    expect(ran).toBe(false);
    expect(written).toContain("Human wrote this");
    expect(written).not.toContain("REGEN");
  });

  test("preserves edited generated narrative when hash no longer matches", async () => {
    const specDirPath = writeSpec("v1/spec");
    let ran = false;
    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        ran = true;
        return { kind: "ok", stdout: "REGEN\n\nDecisions:\n- x", stderr: "" };
      },
      attributionLabel: () => "test-agent",
    };
    const edited = markGeneratedNarrative("Old body\n\nDecisions:\n- Old choice").replace(
      "Old body",
      "Human edited body",
    );
    let written = "";
    await updatePlanPrBody({
      indexPath: join(specDirPath, "index.md"),
      specDirPath,
      branch: "feature",
      base: "base",
      cwd: workDir,
      targetDir: "v1/spec",
      prNarrative: "agent",
      intentContent: "intent body",
      agent,
      fetchPrBody: () => `${NARRATIVE_START_MARKER}\n${edited}\n${NARRATIVE_END_MARKER}`,
      writePrBody: (_b, body) => {
        written = body;
      },
      renderFooter: () => "",
    });
    expect(ran).toBe(false);
    expect(written).toContain("Human edited body");
    expect(written).not.toContain("REGEN");
  });

  test("end-to-end: preamble + well-delimited description yields no narrative section on null return", async () => {
    const specDirPath = writeSpec("v1/spec");
    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout:
            "I'll review the actual spec files...\n\n" +
            `${PR_DESCRIPTION_BEGIN}\n` +
            "Updated plan\n\nDecisions:\n- Use async\n",
          stderr: "",
        };
      },
      attributionLabel: () => "test-agent",
    };

    let written = "";
    await updatePlanPrBody({
      indexPath: join(specDirPath, "index.md"),
      specDirPath,
      branch: "feature",
      base: "base",
      cwd: workDir,
      targetDir: "v1/spec",
      prNarrative: "agent",
      intentContent: "intent body",
      agent,
      fetchPrBody: () => "",
      writePrBody: (_b, body) => {
        written = body;
      },
      renderFooter: () => "",
    });

    expect(written).toContain("# Real Spec Title");
    expect(written).not.toContain(NARRATIVE_START_MARKER);
    expect(written).not.toContain(NARRATIVE_END_MARKER);
    expect(written).not.toContain("I'll review");
  });
});

describe("generatePrDescription", () => {
  const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
  const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

  test("extracts sentinel-wrapped output, stripping preamble", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout:
            "I'll review the actual plan files...\n\n" +
            `${PR_DESCRIPTION_BEGIN}\n` +
            "Updated plan\n\nDecisions:\n- Use async generation\n" +
            `${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Updated plan");
    expect(result).toContain("Decisions:");
    expect(result).not.toContain("I'll review");
  });

  test("strips trailing chatter after closing sentinel", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout:
            `${PR_DESCRIPTION_BEGIN}\n` +
            "Updated plan\n\nDecisions:\n- Use async\n" +
            `${PR_DESCRIPTION_END}\n` +
            "Here's some trailing commentary that should be discarded.",
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Updated plan");
    expect(result).not.toContain("trailing commentary");
  });

  test("returns null when opening sentinel is absent", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: `Updated plan\n\nDecisions:\n- Missing opening\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(result).toBeNull();
  });

  test("returns null when closing sentinel is absent", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nUpdated plan\n\nDecisions:\n- Missing closing`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(result).toBeNull();
  });

  test("returns null when closing sentinel appears before opening", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_END}\nGarbage\n${PR_DESCRIPTION_BEGIN}`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(result).toBeNull();
  });

  test("returns null when sentinel-delimited content lacks Decisions:", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nJust a description without the required section\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(result).toBeNull();
  });

  test("includes linked subspec content in the prompt", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [x] [00 - one](./00-one.md)\n");
    writeFileSync(join(workDir, "00-one.md"), "# One\n\nPlanned useful details.\n");

    let prompt = "";
    const agent: Agent = {
      name: "claude",
      async run(receivedPrompt): Promise<AgentResult> {
        prompt = receivedPrompt;
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nUpdated plan\n\nDecisions:\n- Use details\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel: () => "test-agent",
    };

    await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
    });

    expect(prompt).toContain("## ./00-one.md");
    expect(prompt).toContain("Planned useful details.");
  });

  test("passes run options through to the agent", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const agent: Agent = {
      name: "claude",
      async run(_prompt, opts): Promise<AgentResult> {
        seenSignal = opts.signal;
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nUpdated plan\n\nDecisions:\n- Signal\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel: () => "test-agent",
    };

    await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent,
      cwd: workDir,
      runOptions: { signal: controller.signal },
    });

    expect(seenSignal).toBe(controller.signal);
  });

  test("returns null when agent fails", async () => {
    const indexPath = join(workDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [ ] [00 - one](./00-one.md)\n");

    const failingAgent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "error",
          exitCode: 1,
          stderr: "Agent failed",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      indexPath,
      intent: "Test intent",
      agent: failingAgent,
      cwd: workDir,
    });

    expect(result).toBeNull();
  });
});
