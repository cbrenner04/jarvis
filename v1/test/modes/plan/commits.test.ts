// commits.ts's git operations route through an injectable PlanCommitGitOps seam (mocked below
// via fakePlanCommitGitOps), so these cases need no real git/gh subprocess.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitPlanBlocker,
  commitPlanDraft,
  commitPlanIntent,
  type PlanCommitGitOps,
  commitPlanRefine,
  commitPlanReview,
} from "../../../src/modes/plan/commits.ts";

type FakePlanCommitGitOps = PlanCommitGitOps & { commits: string[]; pushed: Array<{ firstPush: boolean }> };

function fakePlanCommitGitOps(opts: { hasUpstream?: boolean; porcelain?: string; projectRoot?: string } = {}): FakePlanCommitGitOps {
  const ops: FakePlanCommitGitOps = {
    commits: [],
    pushed: [],
    add() {
      // No staging concept in the fake: commit() records the message directly.
    },
    commit(_cwd, message) {
      ops.commits.push(message);
    },
    push(_cwd, pushOpts) {
      ops.pushed.push(pushOpts);
    },
    hasUpstream() {
      return opts.hasUpstream ?? false;
    },
    porcelainStatus() {
      return opts.porcelain ?? "M file";
    },
    projectRoot() {
      return opts.projectRoot ?? "/project";
    },
  };
  return ops;
}

function setupWorktree(): { worktreePath: string; cleanup: () => void } {
  const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-plan-commits-"));
  mkdirSync(join(worktreePath, "spec", "test-spec"), { recursive: true });
  writeFileSync(join(worktreePath, "spec", "test-spec", "intent.md"), "test intent");
  return { worktreePath, cleanup: () => rmSync(worktreePath, { recursive: true, force: true }) };
}

describe("commitPlanIntent", () => {
  test("creates intent commit with seed line and agent trailer, pushes with firstPush", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps();
      commitPlanIntent(
        {
          worktreePath,
          name: "test-spec",
          mode: "inline",
          intentPathOrLabel: "add feature",
          agentLabel: "Claude Haiku",
        },
        ops,
      );

      expect(ops.commits).toEqual([
        "plan: intent\n\nSpec: spec/test-spec/intent.md\n\nSeeded from inline\n\nJarvis-Agent: Claude Haiku",
      ]);
      expect(ops.pushed).toEqual([{ firstPush: true }]);
    } finally {
      cleanup();
    }
  });

  test("file mode records path relative to project root", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps({ projectRoot: worktreePath });
      commitPlanIntent(
        {
          worktreePath,
          name: "test-spec",
          mode: "file",
          intentPathOrLabel: join(worktreePath, "seed.md"),
          agentLabel: "Claude Haiku",
        },
        ops,
      );

      expect(ops.commits[0]).toContain("Seeded from seed.md");
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanRefine", () => {
  test("creates refine commit with correct message and firstPush when no upstream", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps({ hasUpstream: false });
      commitPlanRefine(
        {
          worktreePath,
          name: "test-spec",
          mode: "inline",
          intentPathOrLabel: "add csv export",
        },
        ops,
      );

      expect(ops.commits).toEqual(["plan: refine\n\nSpec: spec/test-spec/intent.md\n\nTurns: 0"]);
      expect(ops.pushed).toEqual([{ firstPush: true }]);
    } finally {
      cleanup();
    }
  });

  test("pushes without firstPush when upstream already exists", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps({ hasUpstream: true });
      commitPlanRefine(
        {
          worktreePath,
          name: "test-spec",
          mode: "interactive",
          intentPathOrLabel: "interactive",
        },
        ops,
      );

      expect(ops.pushed).toEqual([{ firstPush: false }]);
    } finally {
      cleanup();
    }
  });

  test("records resumedBy and refineOutcome in the commit body", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps();
      commitPlanRefine(
        {
          worktreePath,
          name: "test-spec",
          mode: "inline",
          intentPathOrLabel: "x",
          completedTurns: 2,
          resumedBy: "Codex GPT-5.3",
          refineOutcome: "skipped",
        },
        ops,
      );

      expect(ops.commits[0]).toContain("Resumed by Codex GPT-5.3.");
      expect(ops.commits[0]).toContain("Turns: 2");
      expect(ops.commits[0]).toContain("Outcome: explicit skip");
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanDraft", () => {
  test("creates draft commit with agent label and subspec count", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps({ hasUpstream: true });
      commitPlanDraft(
        {
          worktreePath,
          name: "test-spec",
          agentLabel: "Claude Haiku",
          subspecCount: 2,
        },
        ops,
      );

      expect(ops.commits[0]).toContain("plan: draft");
      expect(ops.commits[0]).toContain("Drafted by Claude Haiku");
      expect(ops.commits[0]).toContain("Subspecs: 2");
      expect(ops.pushed).toEqual([{ firstPush: false }]);
    } finally {
      cleanup();
    }
  });

  test("writes Jarvis-Agent trailer with the agent label", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps({ hasUpstream: true });
      commitPlanDraft(
        {
          worktreePath,
          name: "test-spec",
          agentLabel: "Claude Opus 4.8",
          subspecCount: 1,
        },
        ops,
      );

      expect(ops.commits[0]).toContain("Jarvis-Agent: Claude Opus 4.8");
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanReview", () => {
  test("writes plan: review N commit with Spec line and trailer", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps();
      commitPlanReview(
        {
          worktreePath,
          name: "test-spec",
          passNumber: 1,
          agentLabel: "Codex GPT-5.3",
        },
        ops,
      );

      const msg = ops.commits[0] ?? "";
      expect(msg).toContain("plan: review 1");
      expect(msg).toContain("Spec: spec/test-spec/intent.md");
      expect(msg).toContain("Reviewed by Codex GPT-5.3.");
      expect(msg).toContain("Jarvis-Agent: Codex GPT-5.3");
      expect(ops.pushed).toEqual([{ firstPush: false }]);
    } finally {
      cleanup();
    }
  });

  test("supports resume suffix in review subject", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps();
      commitPlanReview(
        {
          worktreePath,
          name: "test-spec",
          passNumber: 3,
          agentLabel: "Codex GPT-5.3",
          subjectSuffix: "r2",
        },
        ops,
      );

      expect(ops.commits[0]?.split("\n")[0]).toBe("plan: review 3 r2");
    } finally {
      cleanup();
    }
  });

  test("uses reviewLabel over passNumber when provided", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps();
      commitPlanReview(
        {
          worktreePath,
          name: "test-spec",
          passNumber: 1,
          agentLabel: "Claude Haiku",
          reviewLabel: "review: adversary",
        },
        ops,
      );

      expect(ops.commits[0]?.split("\n")[0]).toBe("plan: review: adversary");
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanBlocker", () => {
  test("body matches docs shape (Blocked by / Spec files to date / Raised by) and includes trailer", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps({ porcelain: "M spec/test-spec/intent.md" });
      commitPlanBlocker(
        {
          worktreePath,
          name: "test-spec",
          agentLabel: "Claude Haiku",
          reason: "Need clarification on X.",
          specFilesCount: 3,
        },
        ops,
      );

      const msg = ops.commits[0] ?? "";
      expect(msg).toContain("plan: blocker");
      expect(msg).toContain("Spec: spec/test-spec/intent.md");
      expect(msg).toContain("Blocked by Need clarification on X.");
      expect(msg).toContain("Spec files to date: 3");
      expect(msg).toContain("Raised by Claude Haiku.");
      expect(msg).toContain("Jarvis-Agent: Claude Haiku");
      expect(ops.pushed).toEqual([{ firstPush: false }]);
    } finally {
      cleanup();
    }
  });

  test("allows an empty commit when there is nothing staged", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const commitCalls: Array<{ message: string; allowEmpty: boolean | undefined }> = [];
      const ops = fakePlanCommitGitOps({ porcelain: "" });
      ops.commit = (_cwd, message, commitOpts) => {
        commitCalls.push({ message, allowEmpty: commitOpts?.allowEmpty });
      };
      commitPlanBlocker(
        {
          worktreePath,
          name: "test-spec",
          agentLabel: "Claude Haiku",
          reason: "Need clarification on X.",
          specFilesCount: 1,
        },
        ops,
      );

      expect(commitCalls).toHaveLength(1);
      expect(commitCalls[0]?.allowEmpty).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanIntent error propagation", () => {
  test("wraps push failures", () => {
    const { worktreePath, cleanup } = setupWorktree();
    try {
      const ops = fakePlanCommitGitOps();
      ops.push = () => {
        throw new Error("remote rejected");
      };
      expect(() =>
        commitPlanIntent(
          {
            worktreePath,
            name: "test-spec",
            mode: "inline",
            intentPathOrLabel: "add feature",
            agentLabel: "Claude Haiku",
          },
          ops,
        ),
      ).toThrow("remote rejected");
    } finally {
      cleanup();
    }
  });
});
