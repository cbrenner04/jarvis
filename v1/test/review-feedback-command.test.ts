import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult } from "../src/agents/types.ts";
import type { CiCheckRun, CommitCheckRunsFetchResult } from "../src/ci-checks.ts";
import { type ReviewIo, reviewFeedbackCommand } from "../src/commands/review-feedback.ts";
import type { Config } from "../src/config.ts";
import { getWorktreeLockPath } from "../src/worktree-lock.ts";

function captureIo(): { io: ReviewIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

let root: string;
let projectRoot: string;
let worktreeRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-review-"));
  projectRoot = join(root, "project");
  worktreeRoot = join(projectRoot, ".worktree");
  mkdirSync(worktreeRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function createGitWorktree(name: string): string {
  const worktreePath = join(worktreeRoot, name);
  mkdirSync(worktreePath, { recursive: true });
  execSync("git init", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config user.email test@example.com", {
    cwd: worktreePath,
    stdio: "pipe",
  });
  execSync("git config user.name Test", { cwd: worktreePath, stdio: "pipe" });
  writeFileSync(join(worktreePath, "README.md"), "seed\n");
  execSync("git add README.md", { cwd: worktreePath, stdio: "pipe" });
  execSync("git commit -m seed", { cwd: worktreePath, stdio: "pipe" });
  return worktreePath;
}

function cfg(order: Array<{ agent: AgentName; model: string }>): Config {
  return {
    version: 2,
    modes: {
      patch: { agentOrder: order },
      plan: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      prompt: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      review: { passes: 2 },
    },
    quotaFallback: "lenient",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 1000,
    logServerUrl: "http://127.0.0.1:4310/logs",
    logServerBind: "127.0.0.1:4310",
    telemetryPath: null,
    git: true,
    projects: {},
  };
}

function fakeAgent(name: AgentName, runImpl: () => Promise<AgentResult> | AgentResult): Agent {
  return {
    name,
    run: async () => runImpl(),
    attributionLabel: () => `${name}-model`,
  };
}

function noCommentsFetchStub(checkRuns: CiCheckRun[] = []): {
  resolveHeadShaFn: () => string;
  fetchCommitCheckRunsFn: () => CommitCheckRunsFetchResult;
} {
  return {
    resolveHeadShaFn: () => "abc123",
    fetchCommitCheckRunsFn: () => ({ ok: true, checkRuns }),
  };
}

function failingCheckRun(name = "ci-test"): CiCheckRun {
  return { name, status: "completed", conclusion: "failure" };
}

function greenCheckRun(name = "ci-test"): CiCheckRun {
  return { name, status: "completed", conclusion: "success" };
}

function pendingCheckRun(name = "ci-test"): CiCheckRun {
  return { name, status: "in_progress", conclusion: null };
}

describe("review-feedback command", () => {
  test("missing worktree without branch throws no-branch error", async () => {
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "missing-one",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      ensurePatchWorktreeFn: async () => {
        throw new Error("no local or remote branch named missing-one; cannot create worktree");
      },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("no local or remote branch named missing-one");
  });

  test("plan-* worktree is rejected in v1", async () => {
    createGitWorktree("plan-my-worktree");
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "plan-my-worktree",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("only supports patch worktrees");
  });

  test("branch on origin with missing worktree creates it and runs review", async () => {
    const worktreePath = createGitWorktree("feature-branch");
    // Remove the worktree directory to simulate a missing worktree that needs to be created
    renameSync(join(worktreePath, ".git"), join(worktreePath, "git-dir"));
    rmSync(worktreePath, { recursive: true, force: true });
    expect(existsSync(worktreePath)).toBe(false);

    // Track whether ensurePatchWorktreeForExistingBranch was called from the command
    let createdFromCommand = false;

    const cap = captureIo();
    const _code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "feature-branch",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      ensurePatchWorktreeFn: async (_projRoot, _name) => {
        createdFromCommand = true;
        // Recreate the worktree for the test
        mkdirSync(worktreePath, { recursive: true });
        execSync("git init", { cwd: worktreePath, stdio: "pipe" });
        execSync("git config user.email test@example.com", {
          cwd: worktreePath,
          stdio: "pipe",
        });
        execSync("git config user.name Test", {
          cwd: worktreePath,
          stdio: "pipe",
        });
        writeFileSync(join(worktreePath, "README.md"), "test\n");
        execSync("git add README.md", { cwd: worktreePath, stdio: "pipe" });
        execSync("git commit -m initial", { cwd: worktreePath, stdio: "pipe" });
        execSync("git checkout -b feature-branch", {
          cwd: worktreePath,
          stdio: "pipe",
        });
        return {
          path: worktreePath,
          source: "origin",
        };
      },
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      createAgentFn: () =>
        fakeAgent("claude", () => {
          writeFileSync(join(worktreePath, "changed.txt"), "changed\n");
          return { kind: "ok", stdout: "ok", stderr: "" };
        }),
      commitAllFn: () => {},
      pushCurrentFn: () => {},
    });

    // The function should call our stubbed ensurePatchWorktreeFn
    expect(createdFromCommand).toBe(true);
    // Should emit the creation message
    expect(cap.out()).toContain("worktree missing; creating");
    expect(cap.out()).toContain("from origin/");
  });

  test("no branch local or remote errors with no-branch message", async () => {
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "nonexistent-branch",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      ensurePatchWorktreeFn: async () => {
        throw new Error("no local or remote branch named nonexistent-branch; cannot create worktree");
      },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("no local or remote branch named nonexistent-branch");
  });

  test("git disabled and worktree missing uses unknown-worktree error", async () => {
    const cap = captureIo();
    let ensureCalled = false;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "missing-git-disabled",
      io: cap.io,
      loadConfigFn: () => {
        const c = cfg([{ agent: "claude", model: "haiku" }]);
        c.git = false;
        return c;
      },
      ensurePatchWorktreeFn: async () => {
        ensureCalled = true;
        throw new Error("should not be called");
      },
    });
    expect(code).toBe(1);
    expect(ensureCalled).toBe(false);
    expect(cap.err()).toContain("unknown worktree");
    expect(cap.err()).toContain("missing-git-disabled");
  });

  test("detached HEAD is rejected before gh lookup", async () => {
    const worktreePath = createGitWorktree("detached");
    execSync("git checkout --detach", { cwd: worktreePath, stdio: "pipe" });

    let ghCalled = false;
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "detached",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      assertGhReadyFn: async () => {
        ghCalled = true;
      },
    });
    expect(code).toBe(1);
    expect(ghCalled).toBe(false);
    expect(cap.err()).toContain("detached HEAD");
  });

  test("lock contention exits through normal lock failure path", async () => {
    const worktreePath = createGitWorktree("locked");
    const lockPath = getWorktreeLockPath(worktreePath);
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        host: "test",
      }),
    );

    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "locked",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
    });
    expect(code).toBe(9);
    expect(cap.err()).toContain("worktree is in use by process");
  });

  test("dirty-start refusal happens before gh readiness", async () => {
    const worktreePath = createGitWorktree("dirty");
    writeFileSync(join(worktreePath, "dirty.txt"), "dirty\n");

    let ghCalled = false;
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "dirty",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      assertGhReadyFn: async () => {
        ghCalled = true;
      },
    });
    expect(code).toBe(1);
    expect(ghCalled).toBe(false);
    expect(cap.err()).toContain("is not clean");
  });

  test("gh readiness failures are surfaced unchanged", async () => {
    const worktreePath = createGitWorktree("gh-failure");
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "gh-failure",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      assertGhReadyFn: async () => {
        throw new Error("gh auth failure text");
      },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("gh auth failure text");
    expect(existsSync(getWorktreeLockPath(worktreePath))).toBe(false);
  });

  test("lock is released on detached-head early error path", async () => {
    const worktreePath = createGitWorktree("detached-release");
    execSync("git checkout --detach", { cwd: worktreePath, stdio: "pipe" });
    const cap = captureIo();
    await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "detached-release",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
    });
    expect(existsSync(getWorktreeLockPath(worktreePath))).toBe(false);
  });

  test("missing open PR exits non-zero and does not collect feedback", async () => {
    createGitWorktree("no-pr");
    let collectCalled = false;
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "no-pr",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => null,
      collectReviewFeedbackFn: async () => {
        collectCalled = true;
        return { inlineThreads: [], topLevelComments: [] };
      },
    });
    expect(code).toBe(1);
    expect(collectCalled).toBe(false);
    expect(cap.err()).toContain("no open PR");
  });

  test("no actionable comments exits 0 with no-open-comments message", async () => {
    createGitWorktree("no-comments");
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "no-comments",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [],
        topLevelComments: [],
      }),
      ...noCommentsFetchStub(),
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("no open review comments");
  });

  test("successful run commits once and pushes once", async () => {
    const worktreePath = createGitWorktree("success");
    const cap = captureIo();
    let commitCount = 0;
    const pushes: Array<{ cwd: string; firstPush: boolean }> = [];
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "success",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () =>
        fakeAgent("claude", () => {
          writeFileSync(join(worktreePath, "changed.txt"), "changed\n");
          return { kind: "ok", stdout: "ok", stderr: "" };
        }),
      commitAllFn: (cwd, message) => {
        commitCount += 1;
        expect(cwd).toBe(worktreePath);
        expect(message).toBe("address PR review comments");
      },
      pushCurrentFn: (args) => {
        pushes.push(args);
      },
    });
    expect(code).toBe(0);
    expect(commitCount).toBe(1);
    expect(pushes.length).toBe(1);
    expect(pushes[0]?.cwd).toBe(worktreePath);
  });

  test("no-op agent exits non-zero and does not commit", async () => {
    createGitWorktree("noop");
    const cap = captureIo();
    let committed = false;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "noop",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () => fakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" })),
      commitAllFn: () => {
        committed = true;
      },
    });
    expect(code).toBe(1);
    expect(committed).toBe(false);
    expect(cap.err()).toContain("no file changes");
  });

  test("falls through failing/quota agent to later success and commits once", async () => {
    const worktreePath = createGitWorktree("fallback-success");
    const cap = captureIo();
    let commitCount = 0;
    let call = 0;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "fallback-success",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () =>
        cfg([
          { agent: "claude", model: "haiku" },
          { agent: "codex", model: "gpt-5.3-codex" },
        ]),
      createAgentFn: (name) => {
        if (name === "claude") {
          return fakeAgent("claude", () => ({
            kind: "quota",
            stderr: "limit",
          }));
        }
        return fakeAgent("codex", () => {
          call += 1;
          writeFileSync(join(worktreePath, "changed.txt"), "changed\n");
          return { kind: "ok", stdout: "", stderr: "" };
        });
      },
      commitAllFn: (cwd, message) => {
        commitCount += 1;
        expect(cwd).toBe(worktreePath);
        expect(message).toBe("address PR review comments");
      },
      pushCurrentFn: () => {},
    });
    expect(code).toBe(0);
    expect(call).toBe(1);
    expect(commitCount).toBe(1);
  });

  test("all agents quota-exhausted exits non-zero with no commit", async () => {
    createGitWorktree("all-quota");
    const cap = captureIo();
    let committed = false;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "all-quota",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () =>
        cfg([
          { agent: "claude", model: "haiku" },
          { agent: "codex", model: "gpt-5.3-codex" },
        ]),
      createAgentFn: (name) =>
        fakeAgent(name, () => ({
          kind: "quota",
          stderr: "limit",
        })),
      commitAllFn: () => {
        committed = true;
      },
    });
    expect(code).toBe(1);
    expect(committed).toBe(false);
    expect(cap.err()).toContain("all agents quota-exhausted");
  });

  test("agent failure exits non-zero without commit", async () => {
    createGitWorktree("agent-fail");
    const cap = captureIo();
    let committed = false;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "agent-fail",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () =>
        fakeAgent("claude", () => ({
          kind: "error",
          exitCode: 1,
          stderr: "boom",
        })),
      commitAllFn: () => {
        committed = true;
      },
    });
    expect(code).toBe(1);
    expect(committed).toBe(false);
    expect(cap.err()).toContain("boom");
  });

  test("push failure after commit is surfaced and does not rollback", async () => {
    const worktreePath = createGitWorktree("push-fail");
    const cap = captureIo();
    let commitCount = 0;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "push-fail",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () =>
        fakeAgent("claude", () => {
          writeFileSync(join(worktreePath, "changed.txt"), "changed\n");
          return { kind: "ok", stdout: "", stderr: "" };
        }),
      commitAllFn: (cwd, message) => {
        commitCount += 1;
        expect(cwd).toBe(worktreePath);
        expect(message).toBe("address PR review comments");
      },
      pushCurrentFn: () => {
        throw new Error("push rejected");
      },
    });
    expect(code).toBe(1);
    expect(commitCount).toBe(1);
    expect(cap.err()).toContain("push failed after commit creation");
  });

  test("no comments and red CI runs agent and commits address failing CI checks", async () => {
    const worktreePath = createGitWorktree("ci-red");
    const cap = captureIo();
    let commitMessage = "";
    let agentCalled = false;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "ci-red",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 456,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [],
        topLevelComments: [],
      }),
      ...noCommentsFetchStub([failingCheckRun()]),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () =>
        fakeAgent("claude", () => {
          agentCalled = true;
          writeFileSync(join(worktreePath, "ci-fix.txt"), "fixed\n");
          return { kind: "ok", stdout: "ok", stderr: "" };
        }),
      commitAllFn: (_cwd, message) => {
        commitMessage = message;
      },
      pushCurrentFn: () => {},
    });
    expect(code).toBe(0);
    expect(agentCalled).toBe(true);
    expect(commitMessage).toBe("address failing CI checks");
    expect(cap.out()).toContain("collected 1 failing CI checks for PR #456");
    expect(cap.out()).toContain("committed and pushed review feedback updates via claude");
  });

  for (const [label, checkRuns] of [
    ["green", [greenCheckRun()]],
    ["pending", [pendingCheckRun()]],
  ] as [string, CiCheckRun[]][]) {
    test(`no comments and ${label} CI exits 0 without agent`, async () => {
      createGitWorktree(`ci-${label}`);
      const cap = captureIo();
      let agentCalled = false;
      const code = await reviewFeedbackCommand({
        projectRoot,
        worktreeName: `ci-${label}`,
        io: cap.io,
        loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
        assertGhReadyFn: async () => {},
        checkPrExistsFn: () => 123,
        collectReviewFeedbackFn: async () => ({
          inlineThreads: [],
          topLevelComments: [],
        }),
        ...noCommentsFetchStub(checkRuns),
        createAgentFn: () => {
          agentCalled = true;
          return fakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
        },
      });
      expect(code).toBe(0);
      expect(agentCalled).toBe(false);
      expect(cap.out()).toContain("no open review comments");
    });
  }

  test("comments and red CI use comment prompt and address PR review comments", async () => {
    const worktreePath = createGitWorktree("comments-red-ci");
    const cap = captureIo();
    let commitMessage = "";
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "comments-red-ci",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 789,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [{ comments: [] }],
        topLevelComments: [],
      }),
      resolveHeadShaFn: () => "abc123",
      fetchCommitCheckRunsFn: () => ({ ok: true, checkRuns: [failingCheckRun()] }),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () =>
        fakeAgent("claude", () => {
          writeFileSync(join(worktreePath, "review-fix.txt"), "fixed\n");
          return { kind: "ok", stdout: "ok", stderr: "" };
        }),
      commitAllFn: (_cwd, message) => {
        commitMessage = message;
      },
      pushCurrentFn: () => {},
    });
    expect(code).toBe(0);
    expect(commitMessage).toBe("address PR review comments");
    expect(cap.out()).toContain("unresolved inline threads");
    expect(cap.out()).not.toContain("failing CI checks");
  });

  test("no comments and check-runs fetch error exits 1", async () => {
    createGitWorktree("ci-fetch-fail");
    const cap = captureIo();
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "ci-fetch-fail",
      io: cap.io,
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [],
        topLevelComments: [],
      }),
      resolveHeadShaFn: () => "abc123",
      fetchCommitCheckRunsFn: () => ({ ok: false, reason: "gh api error: boom" }),
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("gh api error: boom");
    expect(cap.out()).not.toContain("no open review comments");
  });

  test("no comments CI no-op agent exits non-zero and does not commit", async () => {
    createGitWorktree("ci-noop");
    const cap = captureIo();
    let committed = false;
    const code = await reviewFeedbackCommand({
      projectRoot,
      worktreeName: "ci-noop",
      io: cap.io,
      assertGhReadyFn: async () => {},
      checkPrExistsFn: () => 123,
      collectReviewFeedbackFn: async () => ({
        inlineThreads: [],
        topLevelComments: [],
      }),
      ...noCommentsFetchStub([failingCheckRun()]),
      readPatchRulesFn: () => "rules",
      loadConfigFn: () => cfg([{ agent: "claude", model: "haiku" }]),
      createAgentFn: () => fakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" })),
      commitAllFn: () => {
        committed = true;
      },
    });
    expect(code).toBe(1);
    expect(committed).toBe(false);
    expect(cap.err()).toContain("no file changes");
  });
});
