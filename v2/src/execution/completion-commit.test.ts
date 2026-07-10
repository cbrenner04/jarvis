import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedTempRoots } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";

const { roots } = trackedTempRoots();

function setupWorktree(): { worktreePath: string; gitDir: string } {
  const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-v2-completion-commit-"));
  roots.push(worktreePath);
  const gitDir = join(worktreePath, ".git");
  mkdirSync(gitDir);
  return { worktreePath, gitDir };
}

type GitCall = { args: readonly string[]; env: Record<string, string> | undefined };

describe("createCompletionCommitter", () => {
  test("commits and returns a sha when the working tree has changes", () => {
    const { worktreePath, gitDir } = setupWorktree();
    const calls: GitCall[] = [];

    const runGit = (_cwd: string, args: readonly string[], env?: Record<string, string>): string => {
      calls.push({ args, env });
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "base-head";
      if (args[0] === "write-tree") return "new-tree";
      if (args[0] === "rev-parse" && args[1] === "base-head^{tree}") return "base-tree";
      if (args[0] === "symbolic-ref") return "refs/heads/feature";
      if (args[0] === "commit-tree") return "new-commit";
      if (args[0] === "diff-tree") return "src/a.ts\nsrc/b.ts";
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });

    expect(result).toEqual({ commitSha: "new-commit", filesChanged: 2 });
    expect(calls.some((c) => c.args[0] === "update-ref")).toBe(true);
    expect(calls.some((c) => c.args[0] === "diff-tree" && c.args.includes("--no-renames"))).toBe(true);
  });

  test("resuming after a successful commit reports the existing completion commit sha, not a no-op", () => {
    const { worktreePath, gitDir } = setupWorktree();

    const runGit = (_cwd: string, args: readonly string[]): string => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "completion-commit";
      if (args[0] === "read-tree") return "";
      if (args[0] === "add") return "";
      if (args[0] === "write-tree") return "same-tree";
      if (args[0] === "rev-parse" && args[1] === "completion-commit^{tree}") return "same-tree";
      if (args[0] === "log") return "jarvis: complete run\n\nSpec: v2/spec/test/index.md\n\nJarvis-Agent: claude\n";
      if (args[0] === "diff-tree") return "spec/index.md";
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });

    // HEAD is already the completion commit (publish failed earlier); resume must
    // surface its sha so the caller retries publication instead of no-op'ing.
    expect(result).toEqual({ commitSha: "completion-commit", filesChanged: 1 });
  });

  test("truly nothing to commit when HEAD is not a completion commit", () => {
    const { worktreePath, gitDir } = setupWorktree();

    const runGit = (_cwd: string, args: readonly string[]): string => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "unrelated-commit";
      if (args[0] === "read-tree") return "";
      if (args[0] === "add") return "";
      if (args[0] === "write-tree") return "same-tree";
      if (args[0] === "rev-parse" && args[1] === "unrelated-commit^{tree}") return "same-tree";
      if (args[0] === "log") return "some other commit\n";
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });

    expect(result).toEqual({});
  });

  test("returns empty result when the worktree is not git-backed", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-v2-completion-commit-"));
    roots.push(worktreePath);
    expect(existsSync(join(worktreePath, ".git"))).toBe(false);

    const runGit = (): string => "";
    const committer = createCompletionCommitter(runGit);
    const result = committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });

    expect(result).toEqual({});
  });

  test("filesChanged matches tree diff on commit and is absent when no commit is produced", () => {
    const { worktreePath, gitDir } = setupWorktree();
    const diffOutput = "a.ts\nb.ts\nc.ts";
    const calls: GitCall[] = [];

    const runGit = (_cwd: string, args: readonly string[], env?: Record<string, string>): string => {
      calls.push({ args, env });
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "base-head";
      if (args[0] === "write-tree") return "new-tree";
      if (args[0] === "rev-parse" && args[1] === "base-head^{tree}") return "base-tree";
      if (args[0] === "symbolic-ref") return "refs/heads/feature";
      if (args[0] === "commit-tree") return "new-commit";
      if (args[0] === "diff-tree") return diffOutput;
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });

    expect(result.filesChanged).toBe(3);
    const diffCall = calls.find((c) => c.args[0] === "diff-tree");
    expect(diffCall?.args).toEqual(["diff-tree", "--no-renames", "--name-only", "base-head^{tree}", "new-tree"]);

    const noChangeGit = (_cwd: string, args: readonly string[]): string => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "same-head";
      if (args[0] === "read-tree") return "";
      if (args[0] === "add") return "";
      if (args[0] === "write-tree") return "same-tree";
      if (args[0] === "rev-parse" && args[1] === "same-head^{tree}") return "same-tree";
      if (args[0] === "log") return "unrelated\n";
      return "";
    };

    const noCommit = createCompletionCommitter(noChangeGit)({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });
    expect(noCommit).toEqual({});
    expect(noCommit.filesChanged).toBeUndefined();
  });

  test("republishing a pending completion commit yields the same filesChanged", () => {
    const { worktreePath, gitDir } = setupWorktree();
    const pendingPath = join(gitDir, "jarvis-completion-pending.json");
    writeFileSync(
      pendingPath,
      `${JSON.stringify({
        baseHead: "base-head",
        tree: "new-tree",
        branchRef: "refs/heads/feature",
        message: "jarvis: complete run\n\nSpec: v2/spec/test/index.md\n\nJarvis-Agent: claude",
        agent: "claude",
        timestamp: "2026-01-01T00:00:00.000Z",
        commitSha: "existing-commit",
      })}\n`,
      "utf8",
    );

    const diffOutput = "only-one.ts";
    const runGit = (_cwd: string, args: readonly string[]): string => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "existing-commit";
      if (args[0] === "diff-tree") return diffOutput;
      return "";
    };

    const result = createCompletionCommitter(runGit)({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
    });

    expect(result).toEqual({ commitSha: "existing-commit", filesChanged: 1 });
  });
});
