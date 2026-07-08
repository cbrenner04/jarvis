import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
const currentBase =
  (baseRefName: string | null = "main") =>
  () => ({ status: "current" as const, baseRefName });
const behindBase = (baseRefName: string) => () => ({ status: "behind" as const, baseRefName });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-pr-test-"));
  indexPath = join(dir, "spec", "index.md");
  mkdirSync(join(dir, "spec"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Minimal real git fixture reserved for maybeMarkReady tests below whose behavior
 * is mediated by runReadyGateWithTier / ready-gate.ts internal calls to readPorcelain
 * and getCurrentHeadSha (neither exposes an injectable seam). Mirrors the real-git
 * fixture pattern in shrink.test.ts and review.test.ts.
 */
function setupMinimalGitRepo(): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -q -m 'seed'", { cwd: dir, stdio: "pipe" });
}

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

  test("includes human-verify checklist section for unchecked human-only criteria", () => {
    writeFileSync(
      indexPath,
      ["# Spec", "", "- [x] [00 - first](./00-first.md)", "- [ ] [01 - second](./01-second.md)", ""].join("\n"),
    );
    writeFileSync(
      join(dirname(indexPath), "00-first.md"),
      ["# First", "", "## Acceptance criteria", "", "- [x] Test 1", ""].join("\n"),
    );
    writeFileSync(
      join(dirname(indexPath), "01-second.md"),
      ["# Second", "", "## Acceptance criteria", "", "- [ ] Should work (Manual)", "- [x] Other test", ""].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toContain("# Spec");
    expect(body).toContain("## Human verification checklist");
    expect(body).toContain("- [ ] Should work (Manual)");
    expect(body).toContain("[./01-second.md](./01-second.md)");
  });

  test("omits human-verify checklist section when no unchecked human-only criteria exist", () => {
    writeFileSync(
      indexPath,
      ["# Spec", "", "- [x] [00 - first](./00-first.md)", "- [ ] [01 - second](./01-second.md)", ""].join("\n"),
    );
    writeFileSync(
      join(dirname(indexPath), "00-first.md"),
      ["# First", "", "## Acceptance criteria", "", "- [x] Test 1", ""].join("\n"),
    );
    writeFileSync(
      join(dirname(indexPath), "01-second.md"),
      ["# Second", "", "## Acceptance criteria", "", "- [x] Should work (Manual)", "- [ ] Other test", ""].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe("# Spec");
    expect(body).not.toContain("## Human verification checklist");
  });

  test("omits human-verify checklist section when all human-only criteria are checked", () => {
    writeFileSync(indexPath, ["# Spec", "", "- [x] [00 - first](./00-first.md)", ""].join("\n"));
    writeFileSync(
      join(dirname(indexPath), "00-first.md"),
      ["# First", "", "## Acceptance criteria", "", "- [x] Test 1 (Manual)", ""].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe("# Spec");
    expect(body).not.toContain("## Human verification checklist");
  });

  test("excludes human-verify items for external-linked subspecs", () => {
    writeFileSync(
      indexPath,
      ["# Spec", "", "- [x] [00 - first](./00-first.md)", "- [ ] [link](https://example.com)", ""].join("\n"),
    );
    writeFileSync(
      join(dirname(indexPath), "00-first.md"),
      ["# First", "", "## Acceptance criteria", "", "- [ ] Unchecked (Manual)", ""].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toContain("## Human verification checklist");
    expect(body).toContain("[./00-first.md](./00-first.md)");
  });

  test("handles missing subspec file gracefully", () => {
    writeFileSync(
      indexPath,
      ["# Spec", "", "- [x] [00 - first](./00-first.md)", "- [ ] [01 - missing](./01-missing.md)", ""].join("\n"),
    );
    writeFileSync(
      join(dirname(indexPath), "00-first.md"),
      ["# First", "", "## Acceptance criteria", "", "- [x] Test 1", ""].join("\n"),
    );

    const body = buildPrBody({ indexPath, narrative: null });
    expect(body).toBe("# Spec");
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
    const humanEditedNarrative = "Human edited narrative\nMultiple lines here";
    const currentBody = [
      "# stale header",
      "",
      NARRATIVE_START_MARKER,
      humanEditedNarrative,
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
      renderFooter: () => "- abc Foo — Agent X\n\nWritten by Agent X through Jarvis.",
    });

    expect(writtenBody).toContain("# Spec");
    expect(writtenBody).toContain(`${NARRATIVE_START_MARKER}\n${humanEditedNarrative}\n${NARRATIVE_END_MARKER}`);
    expect(writtenBody).toContain("\n\n---\n\n- abc Foo — Agent X\n\nWritten by Agent X through Jarvis.");
  });

  test("uses compact attribution by default", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

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
      renderFooter: () => "- abc Foo — Agent A\n\nWritten by Agent A through Jarvis.",
      getDiffStats: () => [],
      getCommitSubjects: () => ["one", "retry same subspec"],
    });

    expect(writtenBody).toContain("Written by Agent A through Jarvis.");
    expect(writtenBody).toContain("## Subspecs");
    expect(writtenBody).toContain("- 00 - one");
    expect(writtenBody).toContain("## Commits");
    expect(writtenBody).toContain("- one");
    expect(writtenBody).toContain("- retry same subspec");
    expect(writtenBody.split("\n").filter((line) => line === "Written by Agent A through Jarvis.")).toHaveLength(1);
  });

  test("regenerates template narrative when markers missing in current body", async () => {
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
      getCommitSubjects: () => [],
    });

    expect(writtenBody).toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).toContain(NARRATIVE_END_MARKER);
    expect(writtenBody).toContain("## Subspecs");
    expect(writtenBody).toContain("- 00 - one");
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
      getCommitSubjects: () => [],
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
      getCommitSubjects: () => [],
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
        getCommitSubjects: () => [],
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
        timeoutMs: 30_000,
        branchName: "feature",
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
        timeoutMs: 30_000,
        branchName: "feature",
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
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
        timeoutMs: 30_000,
        branchName: "feature",
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
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
        timeoutMs: 30_000,
        branchName: "feature",
        checkPrExists: () => false,
      }),
    ).toThrow("cannot mark PR ready: no PR found");
  });

  test("autoIntegrateBase merges behind base on conflict-free completion", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    let integrateCalled = false;
    let ghReadyCalled = false;

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
      checkBaseCurrent: behindBase("main"),
      autoIntegrateBase: true,
      tryAutoIntegrateBase: () => {
        integrateCalled = true;
        return "integrated";
      },
      ghPrReady: () => {
        ghReadyCalled = true;
      },
      markReady: () => {
        throw new Error("markReady should not run");
      },
    });

    expect(integrateCalled).toBe(true);
    expect(ghReadyCalled).toBe(false);
  });

  test("blocks ready flip when branch is behind base", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    let markReadyCalled = false;
    let stderr = "";

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
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
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    let ghPrReadyCalled = false;
    let stderr = "";

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
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

  // Tests (a)-(d), recorded-green, and fixCommand/readyCommand go through
  // runReadyGateWithTier which shells out to git via readPorcelain / getCurrentHeadSha
  // with no injectable seam — a minimal real git repo is required for these.

  test("(a) runFix leaves clean tree -> commitPreReadyFix not called, ghPrReady called", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n- [x] [01 - two](./01-two.md)\n");
    setupMinimalGitRepo();

    let runFixCalled = false;
    let runReadyCalled = false;
    let commitPreReadyFixCalled = false;
    let ghPrReadyCalled = false;
    let ghPrReadyBranch = "";

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
      checkBaseCurrent: currentBase(),
      agentLabel: "test-agent",
      runFix: () => {
        runFixCalled = true;
      },
      runReady: () => {
        runReadyCalled = true;
      },
      commitPreReadyFix: () => {
        commitPreReadyFixCalled = true;
      },
      ghPrReady: (branch) => {
        ghPrReadyCalled = true;
        ghPrReadyBranch = branch;
      },
    });

    expect(runFixCalled).toBe(true);
    expect(runReadyCalled).toBe(true);
    expect(commitPreReadyFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(true);
    expect(ghPrReadyBranch).toBe("feature");
  });

  test("recorded green on unchanged tree runs fast tier before gh pr ready", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n- [x] [01 - two](./01-two.md)\n");
    setupMinimalGitRepo();
    const headSha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();

    const tiers: string[] = [];
    let ghPrReadyCalled = false;

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
      checkBaseCurrent: currentBase(),
      recordedGreenResult: { headSha },
      runReady: (_cwd, tier) => {
        tiers.push(tier);
      },
      ghPrReady: () => {
        ghPrReadyCalled = true;
      },
    });

    expect(tiers).toEqual(["fast"]);
    expect(ghPrReadyCalled).toBe(true);
  });

  test("(b) runFix dirties tree -> commitPreReadyFix called with correct args before runReady, then ghPrReady", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    setupMinimalGitRepo();

    const calls: string[] = [];
    let commitPreReadyFixCwd = "";
    let commitPreReadyFixAgentLabel = "";
    let ghPrReadyCalled = false;

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
      checkBaseCurrent: currentBase(),
      agentLabel: "my-agent",
      runFix: () => {
        calls.push("fix");
        writeFileSync(join(dir, "dirty.txt"), "dirty\n");
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
    expect(commitPreReadyFixCwd).toBe(dir);
    expect(commitPreReadyFixAgentLabel).toBe("my-agent");
    expect(ghPrReadyCalled).toBe(true);
  });

  test("(c) runReady throws -> commitPreReadyFix not called when fix is clean, ghPrReady not called, error propagates", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    setupMinimalGitRepo();

    let commitPreReadyFixCalled = false;
    let ghPrReadyCalled = false;

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        timeoutMs: 30_000,
        branchName: "feature",
        checkPrExists: () => true,
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
      }),
    ).toThrow("runReady failed");

    expect(commitPreReadyFixCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(false);
  });

  test("(d) commitPreReadyFix throws -> runReady and ghPrReady not called, error propagates", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    setupMinimalGitRepo();

    let runReadyCalled = false;
    let ghPrReadyCalled = false;

    expect(() =>
      maybeMarkReady({
        indexPath,
        cwd: dir,
        timeoutMs: 30_000,
        branchName: "feature",
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        runFix: () => {
          writeFileSync(join(dir, "dirty.txt"), "dirty\n");
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
      }),
    ).toThrow("commitPreReadyFix failed");

    expect(runReadyCalled).toBe(false);
    expect(ghPrReadyCalled).toBe(false);
  });

  test("invokes fixCommand at maybeMarkReady gate site", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    setupMinimalGitRepo();

    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-pr-fix-cmd-"));
    try {
      const sentinel = join(sentinelDir, "invoked");
      const script = join(sentinelDir, "fix.sh");
      writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
      chmodSync(script, 0o755);

      maybeMarkReady({
        indexPath,
        cwd: dir,
        timeoutMs: 30_000,
        branchName: "feature",
        fixCommand: script,
        checkPrExists: () => true,
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

  test("invokes readyCommand at maybeMarkReady gate site", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
    setupMinimalGitRepo();

    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-pr-ready-cmd-"));
    try {
      const sentinel = join(sentinelDir, "invoked");
      const script = join(sentinelDir, "ready.sh");
      writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
      chmodSync(script, 0o755);

      maybeMarkReady({
        indexPath,
        cwd: dir,
        timeoutMs: 30_000,
        branchName: "feature",
        readyCommand: script,
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        runFix: () => {},
        commitPreReadyFix: () => {},
        ghPrReady: () => {},
      });

      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
    }
  });

  test("fetch/base resolution failure does not block ready flip", () => {
    writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");

    let markReadyCalled = false;

    maybeMarkReady({
      indexPath,
      cwd: dir,
      timeoutMs: 30_000,
      branchName: "feature",
      checkPrExists: () => true,
      checkBaseCurrent: currentBase(null),
      markReady: () => {
        markReadyCalled = true;
      },
    });

    expect(markReadyCalled).toBe(true);
  });
});

describe("generatePrDescription", () => {
  const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
  const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

  test("extracts sentinel-wrapped output, stripping preamble", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout:
            "I'll review the actual spec files...\n\n" +
            `${PR_DESCRIPTION_BEGIN}\n` +
            "Updated feature\n\nDecisions:\n- Use async generation\n- Store in markers\n" +
            `${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Updated feature");
    expect(result).toContain("Decisions:");
    expect(result).not.toContain("I'll review");
  });

  test("strips trailing chatter after closing sentinel", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout:
            `${PR_DESCRIPTION_BEGIN}\n` +
            "Updated feature\n\nDecisions:\n- Use async\n" +
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
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Updated feature");
    expect(result).not.toContain("trailing commentary");
  });

  test("returns null when opening sentinel is absent", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: `Updated feature\n\nDecisions:\n- Missing opening\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeNull();
  });

  test("returns null when closing sentinel is absent", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nUpdated feature\n\nDecisions:\n- Missing closing`,
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    const result = await generatePrDescription({
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeNull();
  });

  test("returns null when closing sentinel appears before opening", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

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
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeNull();
  });

  test("returns null when sentinel-delimited content lacks Decisions:", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

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
      specPath: indexPath,
      agent,
      cwd: dir,
    });

    expect(result).toBeNull();
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
          stdout: `${PR_DESCRIPTION_BEGIN}\nUpdated feature\n\nDecisions:\n- Use details\n${PR_DESCRIPTION_END}`,
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
          stdout: `${PR_DESCRIPTION_BEGIN}\nUpdated feature\n\nDecisions:\n- Signal\n${PR_DESCRIPTION_END}`,
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
  const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
  const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

  function createMockAgent(
    response: string = "Updated feature\n\nDecisions:\n- Use async generation\n- Store in markers",
  ): Agent {
    const wrappedResponse = `${PR_DESCRIPTION_BEGIN}\n${response}\n${PR_DESCRIPTION_END}`;
    return {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout: wrappedResponse,
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
      prNarrative: "agent",
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
      prNarrative: "agent",
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
      prNarrative: "agent",
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
        return {
          kind: "ok",
          stdout: `${PR_DESCRIPTION_BEGIN}\nREGEN\n\nDecisions:\n- x\n${PR_DESCRIPTION_END}`,
          stderr: "",
        };
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
      prNarrative: "agent",
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
      prNarrative: "agent",
      fetchPrBody: () => "# stale header",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
    });

    expect(writtenBody).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).not.toContain(NARRATIVE_END_MARKER);
  });

  test("end-to-end: preamble + malformed sentinel yields header-only body on null return", async () => {
    writeFileSync(indexPath, "# Spec\n\n- [ ] [00 - one](./00-one.md)\n");

    const agent: Agent = {
      name: "claude",
      async run(): Promise<AgentResult> {
        return {
          kind: "ok",
          stdout:
            "I'll review the actual spec files...\n\n" +
            `${PR_DESCRIPTION_BEGIN}\n` +
            "Updated feature\n\nDecisions:\n- Use async\n",
          stderr: "",
        };
      },
      attributionLabel(): string {
        return "test-agent";
      },
    };

    let writtenBody = "";
    await updatePrBody({
      indexPath,
      branch: "feature",
      base: "main",
      cwd: dir,
      prNarrative: "agent",
      fetchPrBody: () => "",
      writePrBody: (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: () => "",
      agent,
    });

    expect(writtenBody).toBe("# Spec");
    expect(writtenBody).not.toContain(NARRATIVE_START_MARKER);
    expect(writtenBody).not.toContain(NARRATIVE_END_MARKER);
    expect(writtenBody).not.toContain("I'll review");
  });
});
