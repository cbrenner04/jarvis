import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentResult } from "../../../src/agents/types.ts";
import {
  buildPrBody,
  extractNarrative,
  generatePrDescription,
  maybeMarkReady,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  updatePrBody,
} from "../../../src/modes/patch/pr.ts";
import { markGeneratedNarrative } from "../../../src/pr.ts";

let dir: string;
let indexPath: string;

function gitSetup(): void {
  execSync("git init -q", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: dir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b main", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -q -b feature", { cwd: dir, stdio: "pipe" });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-pr-test-"));
  indexPath = join(dir, "spec", "index.md");
  // Create spec directory
  execSync("mkdir -p spec", { cwd: dir, stdio: "pipe" });
  gitSetup();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildPrBody", () => {
  test("renders header with H1 only", () => {
    writeFileSync(
      indexPath,
      [
        "# Big Feature",
        "",
        "- [x] [00 - first](./00-first.md)",
        "- [ ] [01 - second](./01-second.md)",
        "- [ ] [02 - third](./02-third.md)",
        "",
      ].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe("# Big Feature");
  });

  test("ignores linked checklist content", () => {
    writeFileSync(
      indexPath,
      ["# Spec", "", "- [x] [00 - md](./00-md.md)", "- [ ] [link](https://example.com)", ""].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe("# Spec");
  });

  test("includes narrative bracketed by markers when narrative is non-null", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const body = buildPrBody({
      indexPath,
      narrative: "Some narrative content.",
    });
    expect(body).toContain(`${NARRATIVE_START_MARKER}\nSome narrative content.\n${NARRATIVE_END_MARKER}`);
  });

  test("omits narrative markers when narrative is null", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).not.toContain(NARRATIVE_START_MARKER);
    expect(body).not.toContain(NARRATIVE_END_MARKER);
  });

  test("renders header with no H1 when index has none", () => {
    writeFileSync(indexPath, "- [ ] [00 - one](./00-one.md)\n");
    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe("");
  });
});

describe("extractNarrative", () => {
  test("returns trimmed text between markers when both are present", () => {
    const body = [
      "# Header",
      "",
      NARRATIVE_START_MARKER,
      "",
      "  hello world  ",
      "",
      NARRATIVE_END_MARKER,
      "",
      "footer",
    ].join("\n");
    expect(extractNarrative(body)).toBe("hello world");
  });

  test("returns null when start marker is missing", () => {
    const body = `body\n${NARRATIVE_END_MARKER}\n`;
    expect(extractNarrative(body)).toBeNull();
  });

  test("returns null when end marker is missing", () => {
    const body = `${NARRATIVE_START_MARKER}\ncontent\n`;
    expect(extractNarrative(body)).toBeNull();
  });

  test("returns null when both markers are missing", () => {
    expect(extractNarrative("just a body")).toBeNull();
  });

  test("trims surrounding whitespace from extracted content", () => {
    const body = `${NARRATIVE_START_MARKER}\n\n\nbody text\n\n\n${NARRATIVE_END_MARKER}`;
    expect(extractNarrative(body)).toBe("body text");
  });
});

describe("updatePrBody", () => {
  test("composes header + preserved narrative + footer when markers and footer present", async () => {
    writeFileSync(
      indexPath,
      ["# Spec", "", "- [x] [00 - one](./00-one.md)", "- [ ] [01 - two](./01-two.md)", ""].join("\n"),
    );
    const currentBody = [
      "# stale header",
      "",
      NARRATIVE_START_MARKER,
      "preserved narrative",
      NARRATIVE_END_MARKER,
      "",
      "stale footer",
    ].join("\n");

    let writtenBody = "";
    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => currentBody,
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "- abc Foo \u2014 Agent X\n\nWritten by Agent X through Jarvis.",
    });

    expect(writtenBody).toContain("# Spec");
    expect(writtenBody).toContain(`${NARRATIVE_START_MARKER}\npreserved narrative\n${NARRATIVE_END_MARKER}`);
    expect(writtenBody).toContain("\n\n---\n\n- abc Foo \u2014 Agent X\n\nWritten by Agent X through Jarvis.");
  });

  test("uses compact attribution by default", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'one' -m 'Spec: spec/00-one.md' -m 'Jarvis-Agent: Agent A'", {
      cwd: dir,
      stdio: "pipe",
    });
    execSync("echo x >> seed.txt", { cwd: dir, stdio: "pipe" });
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'retry same subspec' -m 'Spec: spec/00-one.md' -m 'Jarvis-Agent: Agent A'", {
      cwd: dir,
      stdio: "pipe",
    });

    let writtenBody = "";
    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
    });

    expect(writtenBody).toContain("Written by Agent A through Jarvis.");
    expect(writtenBody.split("\n").filter((line) => line === "Written by Agent A through Jarvis.")).toHaveLength(1);
    expect(writtenBody).not.toContain("retry same subspec");
  });

  test("omits narrative section when markers missing in current body", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";
    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "no markers here",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).not.toContain(NARRATIVE_END_MARKER);
  });

  test("omits footer separator when renderFooter returns empty string", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";
    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).not.toContain("---");
  });

  test("passes branch and cwd through to writer", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let seenBranch = "";
    let seenCwd = "";
    await updatePrBody({
      indexPath,
      branch: "feature-x",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "",
      writePrBody: (branch, _body, cwd) => {
        seenBranch = branch;
        seenCwd = cwd;
      },
      renderFooter: () => "",
    });

    expect(seenBranch).toBe("feature-x");
    expect(seenCwd).toBe(dir);
  });

  test("surfaces gh failures as thrown errors", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    await expect(
      updatePrBody({
        indexPath,
        branch: "feature",
        base: "main",
        cwd: dir,
        fetchPrBody: () => "",
        writePrBody: () => {
          throw new Error("gh pr edit failed");
        },
        renderFooter: () => "",
      }),
    ).rejects.toThrow("gh pr edit failed");
  });
});

describe("maybeMarkReady", () => {
  test("returns early when subspecs are not complete", () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
      }),
    ).not.toThrow();
  });

  test("calls markReady when all subspecs complete", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n- [x] [01 - two](./01-two.md)\n");

    let markReadyCalled = false;
    let markReadyBranch = "";
    let markReadyCwd = "";

    expect(() => {
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        markReady: (branch, cwd) => {
          markReadyCalled = true;
          markReadyBranch = branch;
          markReadyCwd = cwd;
        },
      });
    }).not.toThrow();

    expect(markReadyCalled).toBe(true);
    expect(markReadyBranch).toBe("feature");
    expect(markReadyCwd).toBe(dir);
  });

  test("propagates errors from markReady", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    const multilineError = "bun run ready failed:\nsrc/foo.ts(1,1): error TS2345: ...\nFound 1 error.";
    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        markReady: () => {
          throw new Error(multilineError);
        },
      }),
    ).toThrow(multilineError);
  });

  test("throws when no PR exists for the branch", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => false,
      }),
    ).toThrow("cannot mark PR ready: no PR found");
  });

  test("(a) runReady does not dirty tree -> commitCheckFix not called, ghPrReady called", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n- [x] [01 - two](./01-two.md)\n");
    // Commit the spec file to have a clean tree
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let runReadyCalled = false;
    let commitCheckFixCalled = false;
    let ghPrReadyCalled = false;
    let ghPrReadyBranch = "";

    maybeMarkReady({
      indexPath,
      cwd: dir,
      checkPrExists: () => true,
      agentLabel: "test-agent",
      runReady: () => {
        runReadyCalled = true;
        // Don't dirty the tree
      },
      commitCheckFix: () => {
        commitCheckFixCalled = true;
      },
      ghPrReady: (branch) => {
        ghPrReadyCalled = true;
        ghPrReadyBranch = branch;
      },
    });

    expect(runReadyCalled).toBe(true);
    expect(commitCheckFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(true);
    expect(ghPrReadyBranch).toBe("feature");
  });

  test("(b) runReady dirties tree -> commitCheckFix called with correct args, then ghPrReady", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    // Commit the spec file to have a clean baseline
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let runReadyCalled = false;
    let commitCheckFixCalled = false;
    let commitCheckFixCwd = "";
    let commitCheckFixAgentLabel = "";
    let ghPrReadyCalled = false;

    maybeMarkReady({
      indexPath,
      cwd: dir,
      checkPrExists: () => true,
      agentLabel: "my-agent",
      runReady: () => {
        runReadyCalled = true;
        // Dirty the tree by creating an untracked file
        execSync("echo dirty > dirty.txt", { cwd: dir, stdio: "pipe" });
      },
      commitCheckFix: (cwd, agentLabel) => {
        commitCheckFixCalled = true;
        commitCheckFixCwd = cwd;
        commitCheckFixAgentLabel = agentLabel;
        // Clean up the dirty file
        execSync("git add -A", { cwd, stdio: "pipe" });
        execSync("git commit -q -m 'clean'", { cwd, stdio: "pipe" });
      },
      ghPrReady: () => {
        ghPrReadyCalled = true;
      },
    });

    expect(runReadyCalled).toBe(true);
    expect(commitCheckFixCalled).toBe(true);
    expect(commitCheckFixCwd).toBe(dir);
    expect(commitCheckFixAgentLabel).toBe("my-agent");
    expect(ghPrReadyCalled).toBe(true);
  });

  test("(c) runReady throws -> commitCheckFix not called, ghPrReady not called, error propagates", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    // Commit the spec file to have a clean baseline
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let commitCheckFixCalled = false;
    let ghPrReadyCalled = false;

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        runReady: () => {
          throw new Error("runReady failed");
        },
        commitCheckFix: () => {
          commitCheckFixCalled = true;
        },
        ghPrReady: () => {
          ghPrReadyCalled = true;
        },
      }),
    ).toThrow("runReady failed");

    expect(commitCheckFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(false);
  });

  test("(d) commitCheckFix throws -> ghPrReady not called, error propagates", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    // Commit the spec file to have a clean baseline
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync("git commit -q -m 'add spec'", { cwd: dir, stdio: "pipe" });

    let ghPrReadyCalled = false;

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        checkPrExists: () => true,
        runReady: () => {
          // Dirty the tree
          execSync("echo dirty > dirty.txt", { cwd: dir, stdio: "pipe" });
        },
        commitCheckFix: () => {
          throw new Error("commitCheckFix failed");
        },
        ghPrReady: () => {
          ghPrReadyCalled = true;
        },
      }),
    ).toThrow("commitCheckFix failed");

    expect(ghPrReadyCalled).toBe(false);
  });
});

describe("generatePrDescription", () => {
  function createMockAgent(
    response: string = "Updated feature\n\nDecisions:\n- Use async generation\n- Store in markers",
  ): Agent {
    return {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: response,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };
  }

  test("generates description with model when provided valid spec", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent = createMockAgent();
    const result = await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toContain("Updated feature");
    expect(result).toContain("Decisions:");
  });

  test("includes linked subspec content in the prompt", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    writeFileSync(join(dir, "spec", "00-one.md"), "# One\n\nImplemented useful details.\n");

    let prompt = "";
    const agent: Agent = {
      name: "claude",
      async run(receivedPrompt): Promise<AgentResult> {
        prompt = receivedPrompt;
        return {
          kind: "ok",
          stdout: "Updated feature\n\nDecisions:\n- Use details",
          stderr: "",
        };
      },
      attributionLabel: () => "test-agent",
    };

    await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(prompt).toContain("## ./00-one.md");
    expect(prompt).toContain("Implemented useful details.");
  });

  test("passes run options through to the agent", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const agent: Agent = {
      name: "claude",
      async run(_prompt, opts): Promise<AgentResult> {
        seenSignal = opts.signal;
        return {
          kind: "ok",
          stdout: "Updated feature\n\nDecisions:\n- Signal",
          stderr: "",
        };
      },
      attributionLabel: () => "test-agent",
    };

    await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
      runOptions: { signal: controller.signal },
    });

    expect(seenSignal).toBe(controller.signal);
  });

  test("returns null when model response lacks Decisions section", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent = createMockAgent("Just a description without decisions");
    const result = await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeNull();
  });

  test("returns null when agent fails", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

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
      specPath: indexPath,
      agent: failingAgent,
      cwd: dir,
    });

    expect(result).toBeNull();
  });
});

describe("updatePrBody with generation", () => {
  function createMockAgent(
    response: string = "Updated feature\n\nDecisions:\n- Use async generation\n- Store in markers",
  ): Agent {
    return {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: response,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };
  }

  test("preserves human-edited narrative when present", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const currentBody = [
      "# stale header",
      "",
      NARRATIVE_START_MARKER,
      "This is my custom narrative",
      NARRATIVE_END_MARKER,
      "",
      "footer",
    ].join("\n");

    let writtenBody = "";
    const agent = createMockAgent();

    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => currentBody,
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
      agent,
    });

    expect(writtenBody).toContain(`${NARRATIVE_START_MARKER}\nThis is my custom narrative\n${NARRATIVE_END_MARKER}`);
    expect(writtenBody).not.toContain("Updated feature");
  });

  test("regenerates narrative when empty and agent provided", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";
    const agent = createMockAgent();

    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "# stale header",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
      agent,
    });

    expect(writtenBody).toContain(
      `${NARRATIVE_START_MARKER}\nUpdated feature\n\nDecisions:\n- Use async generation\n- Store in markers\n<!-- jarvis:narrative:generated-sha256:`,
    );
    expect(writtenBody).toContain(NARRATIVE_END_MARKER);
  });

  test("regenerates machine-owned narrative when hash still matches", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";
    const agent = createMockAgent("Fresh feature\n\nDecisions:\n- New choice");
    const currentBody = [
      "# stale header",
      "",
      NARRATIVE_START_MARKER,
      markGeneratedNarrative("Old feature\n\nDecisions:\n- Old choice"),
      NARRATIVE_END_MARKER,
    ].join("\n");

    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => currentBody,
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
      agent,
    });

    expect(writtenBody).toContain("Fresh feature");
    expect(writtenBody).not.toContain("Old feature");
  });

  test("preserves edited generated narrative when hash no longer matches", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let ran = false;
    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        ran = true;
        return { kind: "ok", stdout: "REGEN\n\nDecisions:\n- x", stderr: "" };
      },
      attributionLabel: () => "test-agent",
    };
    const edited = markGeneratedNarrative("Old feature\n\nDecisions:\n- Old choice").replace(
      "Old feature",
      "Human edited feature",
    );

    let writtenBody = "";
    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => `${NARRATIVE_START_MARKER}\n${edited}\n${NARRATIVE_END_MARKER}`,
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
      agent,
    });

    expect(ran).toBe(false);
    expect(writtenBody).toContain("Human edited feature");
    expect(writtenBody).not.toContain("REGEN");
  });

  test("omits narrative section when empty and no agent provided", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    let writtenBody = "";

    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      fetchPrBody: () => "# stale header",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).not.toContain(NARRATIVE_END_MARKER);
  });
});
