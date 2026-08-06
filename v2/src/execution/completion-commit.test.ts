import { describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedTempRoots } from "../testing/write-fixtures.ts";
import {
  createCompletionCommitter,
  type CompletionFormatRunner,
  runCompletionFormat,
  shouldReuseHeadWithoutNewCommit,
} from "./completion-commit.ts";
import type { MutateDirective } from "./mutation-checkpoint-verifier.ts";

const { roots } = trackedTempRoots();
const repoRoot = join(import.meta.dir, "../../..");

function setupWorktree(specPath?: string): { worktreePath: string; gitDir: string } {
  const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-v2-completion-commit-"));
  roots.push(worktreePath);
  const gitDir = join(worktreePath, ".git");
  mkdirSync(gitDir);

  // Create a default index.md if a spec path is provided
  if (specPath) {
    const specDir = join(worktreePath, specPath.replace(/\/index\.md$/, ""));
    mkdirSync(specDir, { recursive: true });
    const indexPath = join(specDir, "index.md");
    writeFileSync(indexPath, "# Test Spec Title\n");
  }

  return { worktreePath, gitDir };
}

function initRealGitWorktree(): { worktreePath: string; seedHead: string } {
  const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-v2-completion-commit-real-"));
  roots.push(worktreePath);
  execSync("git init -q", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: worktreePath, stdio: "pipe" });
  copyFileSync(join(repoRoot, "biome.json"), join(worktreePath, "biome.json"));
  copyFileSync(join(repoRoot, ".gitignore"), join(worktreePath, ".gitignore"));
  try {
    symlinkSync(join(repoRoot, "node_modules"), join(worktreePath, "node_modules"), "dir");
  } catch {
    /* reuse existing symlink */
  }
  mkdirSync(join(worktreePath, "v2/spec/test"), { recursive: true });
  writeFileSync(join(worktreePath, "v2/spec/test/index.md"), "# Test Spec Title\n");
  mkdirSync(join(worktreePath, "src"), { recursive: true });
  writeFileSync(join(worktreePath, "src/example.ts"), "export const seeded = true;\n");
  execSync("git add -A", { cwd: worktreePath, stdio: "pipe" });
  execSync("git commit -q -m seed", { cwd: worktreePath, stdio: "pipe" });
  const seedHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: worktreePath,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  return { worktreePath, seedHead };
}

function completionInput(worktreePath: string, overrides?: { iterationTimeoutMs?: number }) {
  return {
    worktreePath,
    baseRef: "main",
    specPath: "v2/spec/test/index.md",
    agent: "claude",
    title: "Test Spec Title",
    ...overrides,
  };
}

function wrapGitWithAddTracker(onAdd?: () => void) {
  return async (cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> => {
    if (args[0] === "add") onAdd?.();
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      });
    });
  };
}

type GitCall = { args: readonly string[]; env: Record<string, string> | undefined };

const sampleDirective: MutateDirective = {
  sourceFile: "v2/src/execution/completion-commit.test.ts",
  sourceLine: 1,
  targetPath: "src/guard.ts",
  originalText: "const enabled = true;",
  replacementText: "const enabled = false;",
  pinTitle: "stranded replacement in staged content refuses completion",
  raw: '// @mutate src/guard.ts "const enabled = true;" -> "const enabled = false;"',
};

describe("createCompletionCommitter", () => {
  test("commits and returns a sha when the working tree has changes", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");
    const calls: GitCall[] = [];

    const runGit = async (_cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> => {
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
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });

    expect(result).toEqual({ commitSha: "new-commit", filesChanged: 2 });
    expect(calls.some((c) => c.args[0] === "update-ref")).toBe(true);
    expect(calls.some((c) => c.args[0] === "diff-tree" && c.args.includes("--no-renames"))).toBe(true);

    // Subject is the caller-supplied title verbatim; the committer no longer resolves it.
    const commitCall = calls.find((c) => c.args[0] === "commit-tree");
    const message = commitCall?.args[commitCall.args.indexOf("-m") + 1];
    expect(message).toContain("Test Spec Title");
    expect(message).toContain("Spec: v2/spec/test/index.md");
    expect(message).toContain("Jarvis-Agent: claude");
  });

  test("an intent landing directory (no index.md) commits with the caller-supplied title", async () => {
    // Regression: intent workflows land into `v2/spec/ready-intents`, a directory
    // with no index.md. The committer used to re-resolve its subject from that
    // directory and threw PublicationTitleResolutionError. It now takes the title
    // as input, so the shape of specPath is irrelevant to the subject.
    const { worktreePath, gitDir } = setupWorktree();
    mkdirSync(join(worktreePath, "v2/spec/ready-intents"), { recursive: true });
    const calls: GitCall[] = [];

    const runGit = async (_cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> => {
      calls.push({ args, env });
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "base-head";
      if (args[0] === "write-tree") return "new-tree";
      if (args[0] === "rev-parse" && args[1] === "base-head^{tree}") return "base-tree";
      if (args[0] === "symbolic-ref") return "refs/heads/feature";
      if (args[0] === "commit-tree") return "new-commit";
      if (args[0] === "diff-tree") return "v2/spec/ready-intents/a.md\nv2/spec/ready-intents/b.md";
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/ready-intents",
      agent: "codex",
      title: "intent: my seed",
    });

    expect(result.commitSha).toBe("new-commit");
    const commitCall = calls.find((c) => c.args[0] === "commit-tree");
    const message = commitCall?.args[commitCall.args.indexOf("-m") + 1];
    expect(message).toContain("intent: my seed");
    expect(message).toContain("Jarvis-Agent: codex");
  });

  test("an empty title is rejected before any git work", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");
    const calls: GitCall[] = [];
    const runGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
      calls.push({ args, env: undefined });
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      return "";
    };

    await expect(
      createCompletionCommitter(runGit)({
        worktreePath,
        baseRef: "main",
        specPath: "v2/spec/test/index.md",
        agent: "codex",
        title: "   ",
      }),
    ).rejects.toThrow("completion title is missing");
    expect(calls.length).toBe(0);
  });

  test("resuming after a successful commit reports the existing completion commit sha, not a no-op", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");

    const runGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "completion-commit";
      if (args[0] === "read-tree") return "";
      if (args[0] === "add") return "";
      if (args[0] === "write-tree") return "same-tree";
      if (args[0] === "rev-parse" && args[1] === "completion-commit^{tree}") return "same-tree";
      if (args[0] === "log") return "test spec title\n\nSpec: v2/spec/test/index.md\n\nJarvis-Agent: claude\n";
      if (args[0] === "diff-tree") return "spec/index.md";
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });

    // HEAD is already the completion commit (publish failed earlier); resume must
    // surface its sha so the caller retries publication instead of no-op'ing.
    expect(result).toEqual({ commitSha: "completion-commit", filesChanged: 1 });
  });

  test("forceDistinctCommit creates a new sha when the tree matches HEAD with Jarvis-Agent", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");
    const calls: GitCall[] = [];

    const runGit = async (_cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> => {
      calls.push({ args, env });
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "iteration-head";
      if (args[0] === "read-tree") return "";
      if (args[0] === "add") return "";
      if (args[0] === "write-tree") return "same-tree";
      if (args[0] === "rev-parse" && args[1] === "iteration-head^{tree}") return "same-tree";
      if (args[0] === "symbolic-ref") return "refs/heads/feature";
      if (args[0] === "commit-tree") return "terminal-commit";
      if (args[0] === "diff-tree") return "";
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
      forceDistinctCommit: true,
    });

    expect(result).toEqual({ commitSha: "terminal-commit", filesChanged: 0 });
    expect(calls.some((c) => c.args[0] === "commit-tree")).toBe(true);
  });

  test("truly nothing to commit when HEAD is not a completion commit", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");

    const runGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
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
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });

    expect(result).toEqual({});
  });

  test("returns empty result when the worktree is not git-backed", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-v2-completion-commit-"));
    roots.push(worktreePath);
    expect(existsSync(join(worktreePath, ".git"))).toBe(false);

    const runGit = async (): Promise<string> => "";
    const committer = createCompletionCommitter(runGit);
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });

    expect(result).toEqual({});
  });

  test("filesChanged matches tree diff on commit and is absent when no commit is produced", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");
    const diffOutput = "a.ts\nb.ts\nc.ts";
    const calls: GitCall[] = [];

    const runGit = async (_cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> => {
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
    const result = await committer({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });

    expect(result.filesChanged).toBe(3);
    const diffCall = calls.find((c) => c.args[0] === "diff-tree");
    expect(diffCall?.args).toEqual(["diff-tree", "--no-renames", "--name-only", "base-head^{tree}", "new-tree"]);

    const noChangeGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "same-head";
      if (args[0] === "read-tree") return "";
      if (args[0] === "add") return "";
      if (args[0] === "write-tree") return "same-tree";
      if (args[0] === "rev-parse" && args[1] === "same-head^{tree}") return "same-tree";
      if (args[0] === "log") return "unrelated\n";
      return "";
    };

    const noCommit = await createCompletionCommitter(noChangeGit)({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });
    expect(noCommit).toEqual({});
    expect(noCommit.filesChanged).toBeUndefined();
  });

  test("republishing a pending completion commit yields the same filesChanged", async () => {
    const { worktreePath, gitDir } = setupWorktree();
    const pendingPath = join(gitDir, "jarvis-completion-pending.json");
    writeFileSync(
      pendingPath,
      `${JSON.stringify({
        baseHead: "base-head",
        tree: "new-tree",
        branchRef: "refs/heads/feature",
        message: "test spec title\n\nSpec: v2/spec/test/index.md\n\nJarvis-Agent: claude",
        agent: "claude",
        timestamp: "2026-01-01T00:00:00.000Z",
        commitSha: "existing-commit",
      })}\n`,
      "utf8",
    );

    const diffOutput = "only-one.ts";
    const runGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "existing-commit";
      if (args[0] === "diff-tree") return diffOutput;
      return "";
    };

    const result = await createCompletionCommitter(runGit)({
      worktreePath,
      baseRef: "main",
      specPath: "v2/spec/test/index.md",
      agent: "claude",
      title: "Test Spec Title",
    });

    expect(result).toEqual({ commitSha: "existing-commit", filesChanged: 1 });
  });

  test("shouldReuseHeadWithoutNewCommit blocks spurious commits when trees match (inverted guard would commit)", () => {
    const tree = "same-tree";
    const headTree = "same-tree";
    expect(shouldReuseHeadWithoutNewCommit(tree, headTree, false)).toBe(true);
    expect(shouldReuseHeadWithoutNewCommit(tree, headTree, true)).toBe(false);
    expect(shouldReuseHeadWithoutNewCommit(tree, "other-tree", false)).toBe(false);
    const invertedSkipGuard = tree !== headTree;
    expect(invertedSkipGuard).toBe(false);
    expect(shouldReuseHeadWithoutNewCommit(tree, headTree, false)).not.toBe(invertedSkipGuard);
  });

  test("stranded replacement in staged content refuses completion", async () => {
    // @mutate v2/src/execution/completion-commit.ts "if (isStrandedMutationContent(staged, directive)) {" -> "if (false) {"
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");
    const calls: GitCall[] = [];

    const runGit = async (_cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> => {
      calls.push({ args, env });
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "base-head";
      if (args[0] === "write-tree") return "new-tree";
      if (args[0] === "show" && args[1] === "new-tree:src/guard.ts") {
        return "const enabled = false;\n";
      }
      if (args[0] === "show" && args[1] === "base-head:src/guard.ts") {
        return "const enabled = true;\n";
      }
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    await expect(
      committer({
        worktreePath,
        baseRef: "main",
        specPath: "v2/spec/test/index.md",
        agent: "claude",
        title: "Test Spec Title",
        unrestoredDirectives: [sampleDirective],
      }),
    ).rejects.toThrow(
      'src/guard.ts: stranded mutation v2/src/execution/completion-commit.test.ts:1: // @mutate src/guard.ts "const enabled = true;" -> "const enabled = false;"',
    );
    expect(calls.some((c) => c.args[0] === "add")).toBe(true);
    expect(calls.some((c) => c.args[0] === "commit-tree")).toBe(false);
  });

  test("stranded replacement in pending commit resume refuses completion", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");
    const pendingPath = join(gitDir, "jarvis-completion-pending.json");
    writeFileSync(
      pendingPath,
      `${JSON.stringify({
        baseHead: "base-head",
        tree: "pending-tree",
        branchRef: "refs/heads/feature",
        message: "test spec title\n\nSpec: v2/spec/test/index.md\n\nJarvis-Agent: claude",
        agent: "claude",
        timestamp: "2026-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const runGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "base-head";
      if (args[0] === "show" && args[1] === "pending-tree:src/guard.ts") {
        return "const enabled = false;\n";
      }
      if (args[0] === "show" && args[1] === "base-head:src/guard.ts") {
        return "const enabled = true;\n";
      }
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    await expect(
      committer({
        worktreePath,
        baseRef: "main",
        specPath: "v2/spec/test/index.md",
        agent: "claude",
        title: "Test Spec Title",
        unrestoredDirectives: [sampleDirective],
      }),
    ).rejects.toThrow(
      'src/guard.ts: stranded mutation v2/src/execution/completion-commit.test.ts:1: // @mutate src/guard.ts "const enabled = true;" -> "const enabled = false;"',
    );
  });

  test("stranded replacement in HEAD refuses even when working copy is clean", async () => {
    const { worktreePath, gitDir } = setupWorktree("v2/spec/test/index.md");

    const runGit = async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return gitDir;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "base-head";
      if (args[0] === "write-tree") return "new-tree";
      if (args[0] === "show" && args[1] === "new-tree:src/guard.ts") {
        return "const enabled = true;\n";
      }
      if (args[0] === "show" && args[1] === "base-head:src/guard.ts") {
        return "const enabled = false;\n";
      }
      return "";
    };

    const committer = createCompletionCommitter(runGit);
    await expect(
      committer({
        worktreePath,
        baseRef: "main",
        specPath: "v2/spec/test/index.md",
        agent: "claude",
        title: "Test Spec Title",
        unrestoredDirectives: [sampleDirective],
      }),
    ).rejects.toThrow("src/guard.ts: stranded mutation");
  });

  test("formats changed files before staging so committed tree passes biome check", async () => {
    // @mutate v2/src/execution/completion-commit.ts "await formatRunner({" -> "if (false) { await formatRunner({"
    const { worktreePath, seedHead } = initRealGitWorktree();
    const targetPath = join(worktreePath, "src/example.ts");
    writeFileSync(targetPath, "const x=1;\n");

    const result = await createCompletionCommitter()(completionInput(worktreePath, { iterationTimeoutMs: 60_000 }));

    expect(result.commitSha).toBeDefined();
    expect(result.commitSha).not.toBe(seedHead);
    expect(readFileSync(targetPath, "utf8")).toBe("const x = 1;\n");
    execFileSync("bun", ["biome", "check", "src/example.ts"], { cwd: worktreePath, stdio: "pipe" });
    const committed = execFileSync("git", ["show", "HEAD:src/example.ts"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(committed).toBe("const x = 1;\n");
  });

  test("throws before staging when formatter exits non-zero", async () => {
    const { worktreePath, seedHead } = initRealGitWorktree();
    writeFileSync(join(worktreePath, "src/example.ts"), "const x=1;\n");
    let addCalled = false;
    const failingFormatter: CompletionFormatRunner = async () => {
      throw new Error("bun biome check --write failed:\nformatter rejected");
    };

    await expect(
      createCompletionCommitter(wrapGitWithAddTracker(() => {
        addCalled = true;
      }), failingFormatter)(completionInput(worktreePath)),
    ).rejects.toThrow("bun biome check --write failed");

    expect(addCalled).toBe(false);
    expect(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8", stdio: "pipe" }).trim(),
    ).toBe(seedHead);
    expect(readFileSync(join(worktreePath, "src/example.ts"), "utf8")).toBe("const x=1;\n");
  });

  test("throws before staging when formatter times out", async () => {
    const { worktreePath, seedHead } = initRealGitWorktree();
    writeFileSync(join(worktreePath, "src/example.ts"), "const x=1;\n");
    const timeoutFormatter: CompletionFormatRunner = async (opts) => {
      throw new Error(`bun biome check --write exceeded ${opts.timeoutMs}ms budget`);
    };

    await expect(
      createCompletionCommitter(wrapGitWithAddTracker(), timeoutFormatter)(
        completionInput(worktreePath, { iterationTimeoutMs: 25 }),
      ),
    ).rejects.toThrow("exceeded 25ms budget");

    expect(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8", stdio: "pipe" }).trim(),
    ).toBe(seedHead);
    expect(readFileSync(join(worktreePath, "src/example.ts"), "utf8")).toBe("const x=1;\n");
  });

  test("honors injected iterationTimeoutMs for formatter budget", async () => {
    const { worktreePath } = initRealGitWorktree();
    writeFileSync(join(worktreePath, "src/example.ts"), "const x=1;\n");
    const budgets: number[] = [];
    const capturingFormatter: CompletionFormatRunner = async (opts) => {
      budgets.push(opts.timeoutMs);
      if (opts.timeoutMs < 100) {
        throw new Error(`bun biome check --write exceeded ${opts.timeoutMs}ms budget`);
      }
      await runCompletionFormat(opts);
    };

    await expect(
      createCompletionCommitter(wrapGitWithAddTracker(), capturingFormatter)(
        completionInput(worktreePath, { iterationTimeoutMs: 5 }),
      ),
    ).rejects.toThrow("exceeded 5ms budget");

    const result = await createCompletionCommitter(wrapGitWithAddTracker(), capturingFormatter)(
      completionInput(worktreePath, { iterationTimeoutMs: 60_000 }),
    );
    expect(result.commitSha).toBeDefined();
    expect(budgets).toEqual([5, 60_000]);
    expect(readFileSync(join(worktreePath, "src/example.ts"), "utf8")).toBe("const x = 1;\n");
  });
});
