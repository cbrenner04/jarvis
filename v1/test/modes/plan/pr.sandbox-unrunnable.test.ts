// Two cases here need real subprocesses with no in-scope seam to remove them:
// - renderPlanAttribution depends on readBranchCommits' real `git log --format=...` parsing
//   (src/pr.ts, shared with patch mode).
// - maybeMarkPlanPrReady, off the `markReady` shortcut, drives ready-gate.ts's
//   runReadyAndCommit, whose readPorcelain() shells to real `git status` unconditionally
//   (no runner seam; shared with patch mode too).
// Everything else in pr.ts is fully seamed and is covered by pr.test.ts instead.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeMarkPlanPrReady, renderPlanAttribution } from "../../../src/modes/plan/pr.ts";

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
      timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
        timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
        timeoutMs: 30_000,
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
        timeoutMs: 30_000,
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
        timeoutMs: 30_000,
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
      timeoutMs: 30_000,
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
