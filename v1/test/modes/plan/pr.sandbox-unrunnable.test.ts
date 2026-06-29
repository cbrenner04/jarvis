// This test requires real git commit / diff state for plan PR rendering and commit selection.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentResult } from "../../../src/agents/types.ts";
import {
  buildPlanPrHeader,
  generatePrDescription,
  maybeMarkPlanPrReady,
  renderPlanAttribution,
  updatePlanPrBody,
} from "../../../src/modes/plan/pr.ts";
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

let gitDir: string;
const currentBase =
  (baseRefName: string | null = "main") =>
  () => ({ status: "current" as const, baseRefName });
const behindBase = (baseRefName: string) => () => ({ status: "behind" as const, baseRefName });

function gitSetup(): void {
  execSync("git init -q", { cwd: gitDir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: gitDir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: gitDir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -q -b base", { cwd: gitDir, stdio: "pipe" });
  writeFileSync(join(gitDir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: gitDir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: gitDir, stdio: "pipe" });
  execSync("git checkout -q -b feature", { cwd: gitDir, stdio: "pipe" });
}

function commitWithPlanMeta(filename: string, subject: string, bodyLines: string[], agent: string = ""): void {
  writeFileSync(join(gitDir, filename), `${filename}\n`);
  execSync("git add -A", { cwd: gitDir, stdio: "pipe" });

  const body = agent === "" ? bodyLines.join("\n") : [bodyLines.join("\n"), "", `Jarvis-Agent: ${agent}`].join("\n");
  const message = `${subject}\n\n${body}`;

  execFileSync("git", ["commit", "-q", "-F", "-"], {
    cwd: gitDir,
    input: message,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function shortSha(ref: string): string {
  return execFileSync("git", ["rev-parse", "--short", ref], {
    cwd: gitDir,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "plan-attribution-"));
  gitSetup();
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
});

describe("maybeMarkPlanPrReady", () => {
  test("silent no-op when PR state is 'none'", () => {
    let getPrStateCalled = false;
    let markReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: (_branch, _cwd) => {
        getPrStateCalled = true;
        return { state: "none" };
      },
      markReady: () => {
        markReadyCalled = true;
      },
    });

    expect(getPrStateCalled).toBe(true);
    expect(markReadyCalled).toBe(false);
  });

  test("silent no-op when PR state is 'ready'", () => {
    let getPrStateCalled = false;
    let markReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: (_branch, _cwd) => {
        getPrStateCalled = true;
        return { state: "ready", number: 456 };
      },
      markReady: () => {
        markReadyCalled = true;
      },
    });

    expect(getPrStateCalled).toBe(true);
    expect(markReadyCalled).toBe(false);
  });

  test("runs ready gate and transition when PR state is 'draft'", () => {
    let getPrStateCalled = false;
    let markReadyCalled = false;
    let markReadyBranch = "";
    let markReadyCwd = "";

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: (_branch, _cwd) => {
        getPrStateCalled = true;
        return { state: "draft", number: 123 };
      },
      checkBaseCurrent: currentBase(),
      markReady: (branch, cwd) => {
        markReadyCalled = true;
        markReadyBranch = branch;
        markReadyCwd = cwd;
      },
    });

    expect(getPrStateCalled).toBe(true);
    expect(markReadyCalled).toBe(true);
    expect(markReadyBranch).toBe("feature");
    expect(markReadyCwd).toBe(gitDir);
  });

  test("propagates errors from markReady when PR is draft", () => {
    const multilineError = "bun run ready failed:\nsrc/foo.ts(1,1): error TS2345: ...\nFound 1 error.";
    expect(() => {
      maybeMarkPlanPrReady({
        branch: "feature",
        cwd: gitDir,
        getOpenPrState: () => ({ state: "draft", number: 123 }),
        checkBaseCurrent: currentBase(),
        markReady: () => {
          throw new Error(multilineError);
        },
      });
    }).toThrow(multilineError);
  });

  test("blocks ready flip when branch is behind base", () => {
    let markReadyCalled = false;
    let stderr = "";

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: () => ({ state: "draft", number: 123 }),
      checkBaseCurrent: behindBase("main"),
      markReady: () => {
        markReadyCalled = true;
      },
      stderr: (s) => {
        stderr += s;
      },
    });

    expect(markReadyCalled).toBe(false);
    expect(stderr).toContain("branch feature");
    expect(stderr).toContain("base main");
    expect(stderr).toContain("PR stays draft");
  });

  test("blocks ready flip when branch diverged from base", () => {
    let ghPrReadyCalled = false;
    let stderr = "";

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: () => ({ state: "draft", number: 123 }),
      checkBaseCurrent: behindBase("release"),
      runReady: () => {
        throw new Error("runReady should not execute");
      },
      ghPrReady: () => {
        ghPrReadyCalled = true;
      },
      stderr: (s) => {
        stderr += s;
      },
    });

    expect(ghPrReadyCalled).toBe(false);
    expect(stderr).toContain("branch feature");
    expect(stderr).toContain("base release");
  });

  test("runFix leaves clean tree -> commitPreReadyFix not called, ghPrReady called", () => {
    let runFixCalled = false;
    let runReadyCalled = false;
    let commitPreReadyFixCalled = false;
    let ghPrReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: () => ({ state: "draft", number: 123 }),
      checkBaseCurrent: currentBase(),
      runFix: (cwd) => {
        runFixCalled = true;
        expect(cwd).toBe(gitDir);
      },
      runReady: (cwd) => {
        runReadyCalled = true;
        expect(cwd).toBe(gitDir);
      },
      commitPreReadyFix: () => {
        commitPreReadyFixCalled = true;
      },
      ghPrReady: (branch, cwd) => {
        ghPrReadyCalled = true;
        expect(branch).toBe("feature");
        expect(cwd).toBe(gitDir);
      },
    });

    expect(runFixCalled).toBe(true);
    expect(runReadyCalled).toBe(true);
    expect(commitPreReadyFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(true);
  });

  test("skip gates flips draft PR without base check, fix, or ready gate", () => {
    let runFixCalled = false;
    let runReadyCalled = false;
    let ghPrReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      skipBaseCurrentCheck: true,
      skipReadyGate: true,
      getOpenPrState: () => ({ state: "draft", number: 123 }),
      checkBaseCurrent: () => {
        throw new Error("checkBaseCurrent should not execute");
      },
      runFix: () => {
        runFixCalled = true;
      },
      runReady: () => {
        runReadyCalled = true;
      },
      ghPrReady: (branch, cwd) => {
        ghPrReadyCalled = true;
        expect(branch).toBe("feature");
        expect(cwd).toBe(gitDir);
      },
    });

    expect(runFixCalled).toBe(false);
    expect(runReadyCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(true);
  });

  test("runFix dirties tree -> commitPreReadyFix called with correct args before runReady, then ghPrReady", () => {
    const calls: string[] = [];
    let commitPreReadyFixCwd = "";
    let commitPreReadyFixAgentLabel = "";
    let ghPrReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      agentLabel: "my-agent",
      getOpenPrState: () => ({ state: "draft", number: 123 }),
      checkBaseCurrent: currentBase(),
      runFix: (cwd) => {
        calls.push("fix");
        writeFileSync(join(cwd, "dirty.txt"), "dirty\n");
      },
      runReady: () => {
        calls.push("ready");
      },
      commitPreReadyFix: (cwd, agentLabel) => {
        calls.push("commit");
        commitPreReadyFixCwd = cwd;
        commitPreReadyFixAgentLabel = agentLabel;
        execSync("git add -A", { cwd, stdio: "pipe" });
        execSync("git commit -q -m 'clean'", { cwd, stdio: "pipe" });
      },
      ghPrReady: () => {
        ghPrReadyCalled = true;
      },
    });

    expect(calls).toEqual(["fix", "commit", "ready"]);
    expect(commitPreReadyFixCwd).toBe(gitDir);
    expect(commitPreReadyFixAgentLabel).toBe("my-agent");
    expect(ghPrReadyCalled).toBe(true);
  });

  test("runReady throws -> commitPreReadyFix not called when fix is clean, ghPrReady not called", () => {
    let commitPreReadyFixCalled = false;
    let ghPrReadyCalled = false;

    expect(() => {
      maybeMarkPlanPrReady({
        branch: "feature",
        cwd: gitDir,
        getOpenPrState: () => ({ state: "draft", number: 123 }),
        checkBaseCurrent: currentBase(),
        runFix: () => {},
        runReady: () => {
          throw new Error("runReady failed");
        },
        commitPreReadyFix: () => {
          commitPreReadyFixCalled = true;
        },
        ghPrReady: () => {
          ghPrReadyCalled = true;
        },
      });
    }).toThrow("runReady failed");

    expect(commitPreReadyFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(false);
  });

  test("commitPreReadyFix throws -> runReady and ghPrReady not called", () => {
    let runReadyCalled = false;
    let ghPrReadyCalled = false;

    expect(() => {
      maybeMarkPlanPrReady({
        branch: "feature",
        cwd: gitDir,
        getOpenPrState: () => ({ state: "draft", number: 123 }),
        checkBaseCurrent: currentBase(),
        runFix: (cwd) => {
          writeFileSync(join(cwd, "dirty.txt"), "dirty\n");
        },
        commitPreReadyFix: () => {
          throw new Error("commitPreReadyFix failed");
        },
        runReady: () => {
          runReadyCalled = true;
        },
        ghPrReady: () => {
          ghPrReadyCalled = true;
        },
      });
    }).toThrow("commitPreReadyFix failed");

    expect(runReadyCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(false);
  });

  test("invokes fixCommand at plan draft→ready gate site", () => {
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-plan-fix-cmd-"));
    try {
      const sentinel = join(sentinelDir, "fix-invoked");
      const script = join(sentinelDir, "fix.sh");
      writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
      chmodSync(script, 0o755);

      maybeMarkPlanPrReady({
        branch: "feature",
        cwd: gitDir,
        fixCommand: script,
        getOpenPrState: () => ({ state: "draft", number: 123 }),
        checkBaseCurrent: currentBase(),
        runReady: () => {},
        commitPreReadyFix: () => {},
        ghPrReady: () => {},
      });

      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
    }
  });

  test("fetch/base resolution failure does not block ready flip", () => {
    let markReadyCalled = false;

    maybeMarkPlanPrReady({
      branch: "feature",
      cwd: gitDir,
      getOpenPrState: () => ({ state: "draft", number: 123 }),
      checkBaseCurrent: currentBase(null),
      markReady: () => {
        markReadyCalled = true;
      },
    });

    expect(markReadyCalled).toBe(true);
  });
});

describe("renderPlanAttribution", () => {
  test("returns empty string when there are no commits", () => {
    expect(renderPlanAttribution({ cwd: gitDir, base: "base" })).toBe("");
  });

  test("collapses only meta-commits into a single summary line", () => {
    commitWithPlanMeta("a.txt", "plan: refine", ["Spec: spec/my-plan/intent.md", "", "Seeded from inline"], "");
    commitWithPlanMeta(
      "b.txt",
      "plan: draft",
      ["Spec: spec/my-plan/intent.md", "", "Drafted by Claude Opus 4.8.", "Subspecs: 3"],
      "Claude Opus 4.8",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("2 spec commits (refine, draft, review) — Claude Opus 4.8");
    expect(out).toContain("Written by Claude Opus 4.8 through Jarvis.");
  });

  test("renders single meta-commit in collapsed form", () => {
    commitWithPlanMeta(
      "a.txt",
      "plan: draft",
      ["Spec: spec/my-plan/intent.md", "", "Drafted by Claude Opus 4.8.", "Subspecs: 2"],
      "Claude Opus 4.8",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("1 spec commits (refine, draft, review)");
    expect(out).toContain("Claude Opus 4.8");
  });

  test("mixes collapsed meta-commits with individual subspec commits", () => {
    commitWithPlanMeta("a.txt", "plan: refine", ["Spec: spec/my-plan/intent.md", "", "Seeded from inline"], "");
    commitWithPlanMeta(
      "b.txt",
      "plan: draft",
      ["Spec: spec/my-plan/intent.md", "", "Drafted by Claude Opus 4.8.", "Subspecs: 1"],
      "Claude Opus 4.8",
    );
    commitWithPlanMeta("c.txt", "Implement feature", ["Spec: spec/my-plan/00-implement.md"], "Claude Opus 4.8");
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("2 spec commits (refine, draft, review)");
    const sha = shortSha("HEAD");
    expect(out).toContain(`- ${sha} Implement feature`);
    expect(out).toContain("Written by Claude Opus 4.8 through Jarvis.");
  });

  test("handles multiple agents in meta-commits", () => {
    commitWithPlanMeta("a.txt", "plan: refine", ["Spec: spec/my-plan/intent.md", "", "Seeded from inline"], "");
    commitWithPlanMeta(
      "b.txt",
      "plan: draft",
      ["Spec: spec/my-plan/intent.md", "", "Drafted by Claude Opus 4.8.", "Subspecs: 1"],
      "Claude Opus 4.8",
    );
    commitWithPlanMeta(
      "c.txt",
      "plan: review 1",
      ["Spec: spec/my-plan/intent.md", "", "Reviewed by Claude Sonnet 4.6."],
      "Claude Sonnet 4.6",
    );
    const out = renderPlanAttribution({ cwd: gitDir, base: "base" });
    expect(out).toContain("3 spec commits (refine, draft, review)");
    expect(out).toContain("Claude Opus 4.8, Claude Sonnet 4.6");
  });
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
    const specDirPath = join(gitDir, targetDir, "my-feat");
    execSync(`mkdir -p ${specDirPath}`, { stdio: "pipe" });
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
      cwd: gitDir,
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
      cwd: gitDir,
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
      cwd: gitDir,
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
      cwd: gitDir,
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
      cwd: gitDir,
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
      cwd: gitDir,
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
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Updated plan");
    expect(result).toContain("Decisions:");
    expect(result).not.toContain("I'll review");
  });

  test("strips trailing chatter after closing sentinel", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Updated plan");
    expect(result).not.toContain("trailing commentary");
  });

  test("returns null when opening sentinel is absent", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeNull();
  });

  test("returns null when closing sentinel is absent", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeNull();
  });

  test("returns null when closing sentinel appears before opening", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeNull();
  });

  test("returns null when sentinel-delimited content lacks Decisions:", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeNull();
  });

  test("includes linked subspec content in the prompt", async () => {
    const indexPath = join(gitDir, "index.md");
    writeFileSync(indexPath, "# Plan\n\n- [x] [00 - one](./00-one.md)\n");
    writeFileSync(join(gitDir, "00-one.md"), "# One\n\nPlanned useful details.\n");

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
      cwd: gitDir,
    });

    expect(prompt).toContain("## ./00-one.md");
    expect(prompt).toContain("Planned useful details.");
  });

  test("passes run options through to the agent", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
      runOptions: { signal: controller.signal },
    });

    expect(seenSignal).toBe(controller.signal);
  });

  test("returns null when agent fails", async () => {
    const indexPath = join(gitDir, "index.md");
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
      cwd: gitDir,
    });

    expect(result).toBeNull();
  });
});
