import { afterEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  abortableWorktreeMergeNoEdit,
  abortableWorktreeRebase,
  addWorktree,
  type BranchCreateResult,
  type BranchDeleteResult,
  type BranchDiff,
  branchDiff,
  branchExistsLocal,
  branchExistsOnOrigin,
  branchExistsOnOriginAsync,
  countCommitsBetween,
  createBranch,
  DIFF_MAX_BUFFER,
  type DiffRange,
  deleteBranch,
  deleteRef,
  diffNameOnly,
  diffNameOnlyRevision,
  diffStat,
  diffUnified,
  type GitFailureReason,
  type GitOperation,
  GitOperationError,
  getCurrentBranch,
  getCurrentBranchAsync,
  getGitStatusInventory,
  gitCommonDir,
  gitDir,
  isAncestor,
  isAncestorOrThrow,
  isInsideWorkTree,
  isNotGitRepositoryDiagnostic,
  isRetryableGitError,
  isWorktreeDirty,
  listLocalBranchHeads,
  listRecursivePathsAtRef,
  listTreeChildrenAtRef,
  listWorktrees,
  logPatchForPathInRange,
  lsRemoteRef,
  mergeBase,
  mergeTreeWriteTree,
  type PushResult,
  pruneWorktrees,
  pushBranch,
  type RefDeleteResult,
  type RefResolution,
  type RemoteUrlResult,
  readBlobAtRef,
  remoteUrl,
  removeWorktree,
  resolveRef,
  unmergedPathNames,
  updateRef,
  type WorktreeAddResult,
  type WorktreeEntry,
  type WorktreeRemoveResult,
} from "./git.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessOptions,
  type AsyncSubprocessRunner,
  NETWORK_SUBPROCESS_TIMEOUT_MS,
  type SubprocessRunner,
} from "./subprocess.ts";
import { trackedMkdtempSync } from "./tracked-temp-dir.test-support.ts";

/** Fake runner: resolves canned results by exact `cmd args` match, records argv+cwd. */
function fakeRunner(
  results: Record<string, string | Error>,
): SubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    run(cmd, args, cwd) {
      calls.push({ args: [cmd, ...args], cwd });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeRunner: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function fakeAsyncRunner(output: string): AsyncSubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    async runAsync(cmd, args, cwd) {
      calls.push({ args: [cmd, ...args], cwd });
      return output;
    },
  };
}

describe("getGitStatusInventory", () => {
  const fixtureRoots: string[] = [];

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("inventory preserves typed porcelain entries including exact UTF-8 path text", async () => {
    const stagedRenameCurrent = " staged rename current \n";
    const stagedRenameOriginal = " staged rename original \n";
    const worktreeRenameCurrent = "\nworktree rename current ";
    const worktreeRenameOriginal = "\nworktree rename original ";
    const stagedCopyCurrent = " staged copy current ";
    const stagedCopyOriginal = " staged copy original ";
    const worktreeCopyCurrent = " worktree copy current\n ";
    const worktreeCopyOriginal = " worktree copy original\n ";
    const output = [
      " M ordinary space.txt",
      "A  café\nfile.txt",
      "?? untracked/雪.txt",
      `R  ${stagedRenameCurrent}`,
      stagedRenameOriginal,
      ` R ${worktreeRenameCurrent}`,
      worktreeRenameOriginal,
      `C  ${stagedCopyCurrent}`,
      stagedCopyOriginal,
      ` C ${worktreeCopyCurrent}`,
      worktreeCopyOriginal,
      "",
    ].join("\0");
    const runner = fakeAsyncRunner(output);

    expect(await getGitStatusInventory("/repo", runner)).toEqual([
      { kind: "ordinary", stagedStatus: "unmodified", worktreeStatus: "modified", currentPath: "ordinary space.txt" },
      { kind: "ordinary", stagedStatus: "added", worktreeStatus: "unmodified", currentPath: "café\nfile.txt" },
      { kind: "ordinary", stagedStatus: "untracked", worktreeStatus: "untracked", currentPath: "untracked/雪.txt" },
      {
        kind: "rename",
        stagedStatus: "renamed",
        worktreeStatus: "unmodified",
        currentPath: stagedRenameCurrent,
        originalPath: stagedRenameOriginal,
      },
      {
        kind: "rename",
        stagedStatus: "unmodified",
        worktreeStatus: "renamed",
        currentPath: worktreeRenameCurrent,
        originalPath: worktreeRenameOriginal,
      },
      {
        kind: "copy",
        stagedStatus: "copied",
        worktreeStatus: "unmodified",
        currentPath: stagedCopyCurrent,
        originalPath: stagedCopyOriginal,
      },
      {
        kind: "copy",
        stagedStatus: "unmodified",
        worktreeStatus: "copied",
        currentPath: worktreeCopyCurrent,
        originalPath: worktreeCopyOriginal,
      },
    ]);
    expect(runner.calls).toEqual([
      { args: ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd: "/repo" },
    ]);
  });

  test("inventory expands nested untracked files", async () => {
    const scratchRoot = join(process.cwd(), ".scratch");
    mkdirSync(scratchRoot, { recursive: true });
    const repo = trackedMkdtempSync(join(scratchRoot, "git-inventory-"));
    fixtureRoots.push(repo);
    execSync("git init", { cwd: repo });
    mkdirSync(join(repo, "nested", "deeper"), { recursive: true });
    writeFileSync(join(repo, "nested", "one.txt"), "one\n");
    writeFileSync(join(repo, "nested", "deeper", "two.txt"), "two\n");

    expect((await getGitStatusInventory(repo)).map((entry) => entry.currentPath).sort()).toEqual([
      "nested/deeper/two.txt",
      "nested/one.txt",
    ]);
  });

  test("inventory rejects malformed porcelain output", async () => {
    await expect(getGitStatusInventory("/repo", fakeAsyncRunner(" M\0"))).rejects.toThrow("truncated record");
    await expect(getGitStatusInventory("/repo", fakeAsyncRunner("R  current\0"))).rejects.toThrow(
      "missing rename or copy origin",
    );
    await expect(getGitStatusInventory("/repo", fakeAsyncRunner(" M path"))).rejects.toThrow("missing terminal NUL");
  });
});

describe("branchExistsLocal", () => {
  test("true for an existing branch, false otherwise", () => {
    const runner = fakeRunner({
      "git rev-parse --verify feature": "abc123\n",
      "git rev-parse --verify nope": new Error("not a valid ref"),
    });
    expect(branchExistsLocal("/repo", "feature", runner)).toBe(true);
    expect(branchExistsLocal("/repo", "nope", runner)).toBe(false);
    expect(runner.calls).toEqual([
      { args: ["git", "rev-parse", "--verify", "feature"], cwd: "/repo" },
      { args: ["git", "rev-parse", "--verify", "nope"], cwd: "/repo" },
    ]);
  });
});

describe("branchExistsOnOrigin", () => {
  test("true only when ls-remote reports a head", () => {
    const exists = fakeRunner({
      "git ls-remote --heads origin main": "abc123\trefs/heads/main\n",
      "git ls-remote --heads origin nope": "",
    });
    expect(branchExistsOnOrigin("/repo", "main", exists)).toBe(true);
    expect(branchExistsOnOrigin("/repo", "nope", exists)).toBe(false);
    expect(exists.calls).toEqual([
      { args: ["git", "ls-remote", "--heads", "origin", "main"], cwd: "/repo" },
      { args: ["git", "ls-remote", "--heads", "origin", "nope"], cwd: "/repo" },
    ]);

    const lsRemoteFails = fakeRunner({
      "git ls-remote --heads origin main": new Error("no origin"),
    });
    expect(branchExistsOnOrigin("/repo", "main", lsRemoteFails)).toBe(false);
  });

  const fixtureRoots: string[] = [];

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("false when only a stale origin tracking ref remains", () => {
    const root = trackedMkdtempSync(join(tmpdir(), "jarvis-git-stale-origin-"));
    fixtureRoots.push(root);
    const bare = join(root, "origin.git");
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    execSync(`git init --bare ${bare}`);
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "t@example.com"', { cwd: repo });
    execSync('git config user.name "t"', { cwd: repo });
    execSync(`git remote add origin ${bare}`, { cwd: repo });
    writeFileAndCommit(repo, "README.md", "seed\n", "init");
    execSync("git push -u origin main", { cwd: repo });
    execSync("git checkout -b feature", { cwd: repo });
    writeFileAndCommit(repo, "feature.txt", "x\n", "feature");
    execSync("git push -u origin feature", { cwd: repo });
    execSync("git update-ref -d refs/heads/feature", { cwd: bare });
    execSync("git checkout main", { cwd: repo });

    expect(execSync("git rev-parse --verify origin/feature", { cwd: repo, encoding: "utf8" }).trim()).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(branchExistsOnOrigin(repo, "feature")).toBe(false);
  });
});

function writeFileAndCommit(repo: string, relPath: string, body: string, message: string): void {
  writeFileSync(join(repo, relPath), body);
  execSync(`git add ${relPath} && git commit -m ${message}`, { cwd: repo });
}

describe("getCurrentBranch", () => {
  test("returns the checked-out branch", () => {
    const runner = fakeRunner({
      "git rev-parse --abbrev-ref HEAD": "main\n",
    });
    expect(getCurrentBranch("/repo", runner)).toBe("main");

    const afterCheckout = fakeRunner({
      "git rev-parse --abbrev-ref HEAD": "feature\n",
    });
    expect(getCurrentBranch("/repo", afterCheckout)).toBe("feature");
  });
});

describe("isWorktreeDirty", () => {
  test("true when git status --porcelain reports changes, false when clean", () => {
    const dirty = fakeRunner({ "git status --porcelain": " M src/file.ts\n" });
    expect(isWorktreeDirty("/repo", dirty)).toBe(true);

    const clean = fakeRunner({ "git status --porcelain": "" });
    expect(isWorktreeDirty("/repo", clean)).toBe(false);
  });
});

// --- Git operations boundary -------------------------------------------------

type AsyncCall = { args: string[]; cwd: string; options: AsyncSubprocessOptions | undefined };

/** Fake async runner: canned results by exact `cmd args` match; records argv, cwd, and options. */
function fakeAsync(results: Record<string, string | Error>): AsyncSubprocessRunner & { calls: AsyncCall[] } {
  const calls: AsyncCall[] = [];
  return {
    calls,
    async runAsync(cmd, args, cwd, options) {
      calls.push({ args: [cmd, ...args], cwd, options });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeAsync: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const OID_C = "c".repeat(40);

function gitFailure(stderr: string, status = 128): AsyncSubprocessError {
  return new AsyncSubprocessError("Command failed: git", status, "", stderr, undefined);
}

function timeoutFailure(): AsyncSubprocessError {
  return new AsyncSubprocessError("Command timed out after 1ms: git", undefined, "", "", "ETIMEDOUT");
}

async function rejection(promise: Promise<unknown>): Promise<GitOperationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitOperationError) return error;
    throw new Error(`expected GitOperationError, got ${String(error)}`);
  }
  throw new Error("expected rejection");
}

function expectFailure(
  error: GitOperationError,
  operation: GitOperation,
  reason: GitFailureReason,
  retryable: boolean,
) {
  expect(error.operation).toBe(operation);
  expect(error.reason).toBe(reason);
  expect(error.retryable).toBe(retryable);
  expect(error.name).toBe("GitOperationError");
  expect(error.message).toStartWith(`git ${operation} ${reason}: `);
}

describe("mergeBase", () => {
  test("returns the trimmed OID and pins the command", async () => {
    const runner = fakeAsync({ "git merge-base main HEAD": `${OID_A}\n` });
    expect(await mergeBase("/repo", "main", "HEAD", runner)).toBe(OID_A);
    expect(runner.calls).toEqual([{ args: ["git", "merge-base", "main", "HEAD"], cwd: "/repo", options: {} }]);
  });

  test("silent exit 1 is no-merge-base; a bad ref is failed; a timeout is retryable", async () => {
    const unrelated = await rejection(
      mergeBase("/repo", "main", "lone", fakeAsync({ "git merge-base main lone": gitFailure("", 1) })),
    );
    expectFailure(unrelated, "merge-base", "no-merge-base", false);
    expect(unrelated.message).toContain("main and lone share no ancestor");

    const badRef = await rejection(
      mergeBase(
        "/repo",
        "main",
        "nope",
        fakeAsync({ "git merge-base main nope": gitFailure("fatal: Not a valid object name nope\n") }),
      ),
    );
    expectFailure(badRef, "merge-base", "failed", false);
    expect(badRef.message).toContain("fatal: Not a valid object name nope");
    expect(badRef.stderr).toBe("fatal: Not a valid object name nope\n");
    expect(badRef.status).toBe(128);

    const timeout = await rejection(
      mergeBase("/repo", "main", "HEAD", fakeAsync({ "git merge-base main HEAD": timeoutFailure() })),
    );
    expectFailure(timeout, "merge-base", "timeout", true);
    expect(isRetryableGitError(timeout)).toBe(true);
  });

  test("rejects output that is not an OID", async () => {
    const error = await rejection(
      mergeBase("/repo", "main", "HEAD", fakeAsync({ "git merge-base main HEAD": "garbage\n" })),
    );
    expectFailure(error, "merge-base", "failed", false);
  });
});

describe("diff operations", () => {
  const range: DiffRange = { from: OID_A, to: "HEAD" };

  test("stat is trimmed, paths are sorted and empty-filtered, unified is raw", async () => {
    const runner = fakeAsync({
      [`git diff --stat ${OID_A} HEAD`]: " a.ts | 1 +\n 1 file changed\n",
      [`git diff --name-only ${OID_A} HEAD`]: "src/b.ts\n\nsrc/a.ts\n",
      [`git diff ${OID_A} HEAD`]: "diff --git a/x b/x\n+x\n",
    });
    expect(await diffStat("/repo", range, runner)).toBe("a.ts | 1 +\n 1 file changed");
    expect(await diffNameOnly("/repo", range, runner)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(await diffUnified("/repo", range, runner)).toBe("diff --git a/x b/x\n+x\n");
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "diff", "--stat", OID_A, "HEAD"],
      ["git", "diff", "--name-only", OID_A, "HEAD"],
      ["git", "diff", OID_A, "HEAD"],
    ]);
    expect(runner.calls.map((call) => call.options)).toEqual(Array(3).fill({ maxBuffer: DIFF_MAX_BUFFER }));
    expect(DIFF_MAX_BUFFER).toBeGreaterThan(1024 * 1024);
  });

  test("output over the diff bound is the named too-large reason", async () => {
    const overflow = new AsyncSubprocessError(
      "stdout maxBuffer length exceeded",
      undefined,
      "",
      "",
      "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    );
    const runner = fakeAsync({ [`git diff ${OID_A} HEAD`]: overflow });
    expectFailure(await rejection(diffUnified("/repo", range, runner)), "diff", "too-large", false);
  });

  test("a diff failure is the diff operation, never merge-base", async () => {
    const runner = fakeAsync({ [`git diff --name-only ${OID_A} HEAD`]: gitFailure("fatal: ambiguous argument\n") });
    expectFailure(await rejection(diffNameOnly("/repo", range, runner)), "diff", "failed", false);
  });

  test("diffNameOnlyRevision drops blank lines and sorts paths", async () => {
    const runner = fakeAsync({
      "git diff --name-only main..HEAD": "src/b.ts\n\nsrc/a.ts\n",
    });
    expect(await diffNameOnlyRevision("/repo", "main..HEAD", runner)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("branchDiff", () => {
  test("returns the structured report in merge-base, stat, paths, unified order", async () => {
    const runner = fakeAsync({
      "git merge-base main HEAD": `${OID_A}\n`,
      [`git diff --stat ${OID_A} HEAD`]: " a.ts | 1 +\n",
      [`git diff --name-only ${OID_A} HEAD`]: "b.ts\na.ts\n",
      [`git diff ${OID_A} HEAD`]: "patch\n",
    });
    const report: BranchDiff = await branchDiff("/repo", "main", "HEAD", runner);
    expect(report).toEqual({
      mergeBase: OID_A,
      stat: "a.ts | 1 +",
      changedPaths: ["a.ts", "b.ts"],
      unified: "patch\n",
    });
    expect(runner.calls.map((call) => call.args.slice(1, 3))).toEqual([
      ["merge-base", "main"],
      ["diff", "--stat"],
      ["diff", "--name-only"],
      ["diff", OID_A],
    ]);
  });

  test("the three diffs run concurrently after merge-base resolves", async () => {
    const started: string[] = [];
    let releaseStat: (() => void) | undefined;
    const statReleased = new Promise<void>((resolveStat) => {
      releaseStat = resolveStat;
    });
    const runner: AsyncSubprocessRunner = {
      async runAsync(_cmd, args) {
        started.push(args[0] === "diff" ? (args[1] ?? "") : (args[0] ?? ""));
        if (args[0] === "merge-base") return `${OID_A}\n`;
        if (args[1] === "--stat") await statReleased;
        return "";
      },
    };
    const report = branchDiff("/repo", "main", "HEAD", runner);
    await new Promise((tick) => setTimeout(tick, 0));
    expect(started).toEqual(["merge-base", "--stat", "--name-only", OID_A]);
    releaseStat?.();
    expect(await report).toEqual({ mergeBase: OID_A, stat: "", changedPaths: [], unified: "" });
  });

  test("merge-base failure is distinct from a diff failure", async () => {
    const noBase = fakeAsync({ "git merge-base main HEAD": gitFailure("", 1) });
    expectFailure(await rejection(branchDiff("/repo", "main", "HEAD", noBase)), "merge-base", "no-merge-base", false);
    expect(noBase.calls).toHaveLength(1);

    const diffFails = fakeAsync({
      "git merge-base main HEAD": OID_A,
      [`git diff --stat ${OID_A} HEAD`]: gitFailure("boom\n"),
    });
    expectFailure(await rejection(branchDiff("/repo", "main", "HEAD", diffFails)), "diff", "failed", false);
  });
});

const PORCELAIN = [
  `worktree /repo\nHEAD ${OID_A}\nbranch refs/heads/main\n`,
  `worktree /wt/feature\nHEAD ${OID_B}\nbranch refs/heads/feature\nlocked hold\nprunable gitdir file points to non-existent location\n`,
  `worktree /wt/detached\nHEAD ${OID_B}\ndetached\nlocked\n`,
  "worktree /bare.git\nbare\n",
].join("\n");

describe("listWorktrees", () => {
  test("parses every porcelain attribute into typed entries", async () => {
    const runner = fakeAsync({ "git worktree list --porcelain": PORCELAIN });
    const entries: WorktreeEntry[] = await listWorktrees("/repo", runner);
    expect(entries).toEqual([
      { path: "/repo", head: OID_A, branch: "main", detached: false, bare: false },
      {
        path: "/wt/feature",
        head: OID_B,
        branch: "feature",
        detached: false,
        bare: false,
        locked: "hold",
        prunable: "gitdir file points to non-existent location",
      },
      { path: "/wt/detached", head: OID_B, detached: true, bare: false, locked: "" },
      { path: "/bare.git", detached: false, bare: true },
    ]);
    expect(runner.calls).toEqual([{ args: ["git", "worktree", "list", "--porcelain"], cwd: "/repo", options: {} }]);
    expect(await listWorktrees("/repo", fakeAsync({ "git worktree list --porcelain": "" }))).toEqual([]);
  });

  test("malformed listing and command failure reject as worktree-list", async () => {
    const malformed = await rejection(
      listWorktrees("/repo", fakeAsync({ "git worktree list --porcelain": "HEAD abc\n" })),
    );
    expectFailure(malformed, "worktree-list", "failed", false);
    expect(malformed.message).toContain("Malformed worktree listing");
    const failed = fakeAsync({ "git worktree list --porcelain": gitFailure("fatal: not a git repository\n") });
    expectFailure(await rejection(listWorktrees("/repo", failed)), "worktree-list", "failed", false);
  });
});

describe("addWorktree", () => {
  const target = { path: "/wt/feature", branch: "feature" };

  test("adds and pins the command", async () => {
    const runner = fakeAsync({ "git worktree add /wt/feature feature": "" });
    const result: WorktreeAddResult = await addWorktree("/repo", target, runner);
    expect(result).toEqual({ status: "added" });
    expect(runner.calls).toEqual([
      { args: ["git", "worktree", "add", "/wt/feature", "feature"], cwd: "/repo", options: {} },
    ]);
  });

  test("the same (path, branch) already registered is idempotent success", async () => {
    const runner = fakeAsync({
      "git worktree add /wt/feature feature": gitFailure("fatal: '/wt/feature' already exists\n"),
      "git worktree list --porcelain": PORCELAIN,
    });
    expect(await addWorktree("/repo", target, runner)).toEqual({ status: "already-registered" });
    expect(runner.calls.map((call) => call.args[1])).toEqual(["worktree", "worktree"]);
  });

  test("path taken by another branch, branch in use elsewhere, and other failures reject", async () => {
    const pathTaken = fakeAsync({
      "git worktree add /wt/feature other": gitFailure("fatal: '/wt/feature' already exists\n"),
      "git worktree list --porcelain": PORCELAIN,
    });
    expectFailure(
      await rejection(addWorktree("/repo", { path: "/wt/feature", branch: "other" }, pathTaken)),
      "worktree-add",
      "path-exists",
      false,
    );

    const inUse = fakeAsync({
      "git worktree add /wt/again feature": gitFailure(
        "fatal: 'feature' is already used by worktree at '/wt/feature'\n",
      ),
      "git worktree list --porcelain": PORCELAIN,
    });
    expectFailure(
      await rejection(addWorktree("/repo", { path: "/wt/again", branch: "feature" }, inUse)),
      "worktree-add",
      "branch-in-use",
      false,
    );

    const other = fakeAsync({
      "git worktree add /wt/feature feature": gitFailure("fatal: invalid reference: feature\n"),
    });
    expectFailure(await rejection(addWorktree("/repo", target, other)), "worktree-add", "failed", false);
    expect(other.calls).toHaveLength(1);
  });

  test("a failing listing rethrows the original add classification", async () => {
    const runner = fakeAsync({
      "git worktree add /wt/feature feature": gitFailure(
        "fatal: 'feature' is already used by worktree at '/elsewhere'\n",
      ),
      "git worktree list --porcelain": gitFailure("fatal: not a git repository\n"),
    });
    expectFailure(await rejection(addWorktree("/repo", target, runner)), "worktree-add", "branch-in-use", false);
  });

  const fixtureRoots: string[] = [];
  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("registered-path match sees through symlinked directories", async () => {
    const root = trackedMkdtempSync(join(tmpdir(), "jarvis-git-wt-link-"));
    fixtureRoots.push(root);
    const canonical = realpathSync(root);
    const linked = join(root, "link");
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), linked);
    const runner = fakeAsync({
      [`git worktree add ${linked} feature`]: gitFailure(`fatal: '${linked}' already exists\n`),
      "git worktree list --porcelain": `worktree ${join(canonical, "real")}\nHEAD ${OID_A}\nbranch refs/heads/feature\n`,
    });
    expect(await addWorktree("/repo", { path: linked, branch: "feature" }, runner)).toEqual({
      status: "already-registered",
    });
  });
});

describe("removeWorktree", () => {
  test("removes, honours force, and treats an unregistered path as absent", async () => {
    const runner = fakeAsync({
      "git worktree remove /wt/feature": "",
      "git worktree remove --force /wt/feature": "",
      "git worktree remove /wt/gone": gitFailure("fatal: '/wt/gone' is not a working tree\n"),
    });
    const removed: WorktreeRemoveResult = await removeWorktree("/repo", "/wt/feature", runner);
    expect(removed).toEqual({ status: "removed" });
    expect(await removeWorktree("/repo", "/wt/feature", runner, { force: true })).toEqual({ status: "removed" });
    expect(await removeWorktree("/repo", "/wt/gone", runner)).toEqual({ status: "absent" });
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "worktree", "remove", "/wt/feature"],
      ["git", "worktree", "remove", "--force", "/wt/feature"],
      ["git", "worktree", "remove", "/wt/gone"],
    ]);
  });

  test("force overrides a dirty or locked worktree", async () => {
    const runner = fakeAsync({ "git worktree remove --force /wt/a": "" });
    expect(await removeWorktree("/repo", "/wt/a", runner, { force: true })).toEqual({ status: "removed" });
    expect(runner.calls[0]?.args).toEqual(["git", "worktree", "remove", "--force", "/wt/a"]);
  });

  test("dirty and locked worktrees are precondition failures", async () => {
    const dirty = fakeAsync({
      "git worktree remove /wt/a": gitFailure(
        "fatal: '/wt/a' contains modified or untracked files, use --force to delete it\n",
      ),
    });
    expectFailure(await rejection(removeWorktree("/repo", "/wt/a", dirty)), "worktree-remove", "precondition", false);
    const locked = fakeAsync({
      "git worktree remove /wt/a": gitFailure("fatal: cannot remove a locked working tree, lock reason: hold\n"),
    });
    expectFailure(await rejection(removeWorktree("/repo", "/wt/a", locked)), "worktree-remove", "precondition", false);
  });
});

describe("pruneWorktrees", () => {
  test("pins the command, forwards the signal, and wraps failure", async () => {
    const controller = new AbortController();
    const runner = fakeAsync({ "git worktree prune": "" });
    await pruneWorktrees("/repo", runner, { signal: controller.signal });
    expect(runner.calls).toEqual([
      { args: ["git", "worktree", "prune"], cwd: "/repo", options: { signal: controller.signal } },
    ]);
    const failed = fakeAsync({ "git worktree prune": gitFailure("fatal: not a git repository\n") });
    expectFailure(await rejection(pruneWorktrees("/repo", failed)), "worktree-prune", "failed", false);
  });

  test("a failure after the caller aborted is reported as aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = fakeAsync({
      "git worktree prune": new AsyncSubprocessError("Command failed", undefined, "", "", "SIGTERM"),
    });
    expectFailure(
      await rejection(pruneWorktrees("/repo", runner, { signal: controller.signal })),
      "worktree-prune",
      "aborted",
      false,
    );
  });
});

describe("createBranch", () => {
  test("creates, reports an existing branch, and rejects other failures", async () => {
    const runner = fakeAsync({
      "git branch feature origin/feature": "",
      "git branch taken main": gitFailure("fatal: a branch named 'taken' already exists\n"),
      "git branch bad nope": gitFailure("fatal: not a valid object name: 'nope'\n"),
    });
    const created: BranchCreateResult = await createBranch("/repo", "feature", "origin/feature", runner);
    expect(created).toEqual({ status: "created" });
    expect(await createBranch("/repo", "taken", "main", runner)).toEqual({ status: "exists" });
    expectFailure(await rejection(createBranch("/repo", "bad", "nope", runner)), "branch-create", "failed", false);
    expect(runner.calls[0]).toEqual({
      args: ["git", "branch", "feature", "origin/feature"],
      cwd: "/repo",
      options: {},
    });
  });
});

describe("deleteBranch", () => {
  test("deletes with -d, forces with -D, absent is idempotent, unmerged is a precondition", async () => {
    const runner = fakeAsync({
      "git branch -d merged": "",
      "git branch -D stale": "",
      "git branch -d nope": gitFailure("error: branch 'nope' not found\n", 1),
      "git branch -d unmerged": gitFailure("error: the branch 'unmerged' is not fully merged\n", 1),
      "git branch -D live": gitFailure("error: Cannot delete branch 'live' checked out at '/wt/live'\n", 1),
    });
    const deleted: BranchDeleteResult = await deleteBranch("/repo", "merged", runner);
    expect(deleted).toEqual({ status: "deleted" });
    expect(await deleteBranch("/repo", "stale", runner, { force: true })).toEqual({ status: "deleted" });
    expect(await deleteBranch("/repo", "nope", runner)).toEqual({ status: "absent" });
    expectFailure(await rejection(deleteBranch("/repo", "unmerged", runner)), "branch-delete", "precondition", false);
    expectFailure(
      await rejection(deleteBranch("/repo", "live", runner, { force: true })),
      "branch-delete",
      "branch-in-use",
      false,
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "branch", "-d", "merged"],
      ["git", "branch", "-D", "stale"],
      ["git", "branch", "-d", "nope"],
      ["git", "branch", "-d", "unmerged"],
      ["git", "branch", "-D", "live"],
    ]);
  });
});

describe("abortable worktree rewrites", () => {
  test("rebase and merge abort on conflict and return unmerged paths", async () => {
    const runner = fakeAsync({
      "git rebase main": gitFailure("CONFLICT\n", 1),
      "git diff --name-only --diff-filter=U": "a.txt\n",
      "git rebase --abort": "",
      "git merge --no-edit main": gitFailure("CONFLICT\n", 1),
      "git merge --abort": gitFailure("fatal: no merge in progress\n", 128),
    });
    expect(await abortableWorktreeRebase("/wt", "main", runner)).toEqual(["a.txt"]);
    expect(await abortableWorktreeMergeNoEdit("/wt", "main", runner)).toEqual(["a.txt"]);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "rebase", "main"],
      ["git", "diff", "--name-only", "--diff-filter=U"],
      ["git", "rebase", "--abort"],
      ["git", "merge", "--no-edit", "main"],
      ["git", "diff", "--name-only", "--diff-filter=U"],
      ["git", "merge", "--abort"],
    ]);
  });

  test("clean rebase and merge return undefined", async () => {
    const runner = fakeAsync({
      "git rebase main": "",
      "git merge --no-edit feature": "",
    });
    expect(await abortableWorktreeRebase("/wt", "main", runner)).toBeUndefined();
    expect(await abortableWorktreeMergeNoEdit("/wt", "feature", runner)).toBeUndefined();
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "rebase", "main"],
      ["git", "merge", "--no-edit", "feature"],
    ]);
  });
});

describe("graph reads for stale-reset", () => {
  test("isAncestor, merge-tree write-tree, unmerged paths, and log patch for path", async () => {
    const runner = fakeAsync({
      "git merge-base --is-ancestor main feature": "",
      "git merge-base --is-ancestor main stale": gitFailure("", 1),
      "git merge-base --is-ancestor main broken": gitFailure("fatal: bad revision\n", 128),
      "git merge-tree --write-tree main feature": `${OID_A}\n`,
      "git merge-tree --write-tree main broken": gitFailure("fatal: bad revision\n", 128),
      "git diff --name-only --diff-filter=U": "a.txt\nb.txt\n",
      "git diff --name-only --diff-filter=U empty": "",
      "git log main..feature -p --format=%H -- v2/spec/task.md": `${OID_A}\n+tick\n`,
      "git log main..feature -p --format=%H -- missing": gitFailure("fatal: bad revision\n", 128),
    });
    expect(await isAncestor("/repo", "main", "feature", runner)).toBe(true);
    expect(await isAncestor("/repo", "main", "stale", runner)).toBe(false);
    expect(await isAncestorOrThrow("/repo", "main", "feature", runner)).toBe(true);
    expect(await isAncestorOrThrow("/repo", "main", "stale", runner)).toBe(false);
    expectFailure(await rejection(isAncestorOrThrow("/repo", "main", "broken", runner)), "merge-base", "failed", false);
    expect(await mergeTreeWriteTree("/repo", "main", "feature", runner)).toBe(OID_A);
    expectFailure(
      await rejection(mergeTreeWriteTree("/repo", "main", "broken", runner)),
      "merge-tree",
      "failed",
      false,
    );
    expect(await unmergedPathNames("/repo", runner)).toEqual(["a.txt", "b.txt"]);
    expect(await logPatchForPathInRange("/repo", "main", "feature", "v2/spec/task.md", runner)).toBe(
      `${OID_A}\n+tick\n`,
    );
    expectFailure(
      await rejection(logPatchForPathInRange("/repo", "main", "feature", "missing", runner)),
      "ref-query",
      "failed",
      false,
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "merge-base", "--is-ancestor", "main", "feature"],
      ["git", "merge-base", "--is-ancestor", "main", "stale"],
      ["git", "merge-base", "--is-ancestor", "main", "feature"],
      ["git", "merge-base", "--is-ancestor", "main", "stale"],
      ["git", "merge-base", "--is-ancestor", "main", "broken"],
      ["git", "merge-tree", "--write-tree", "main", "feature"],
      ["git", "merge-tree", "--write-tree", "main", "broken"],
      ["git", "diff", "--name-only", "--diff-filter=U"],
      ["git", "log", "main..feature", "-p", "--format=%H", "--", "v2/spec/task.md"],
      ["git", "log", "main..feature", "-p", "--format=%H", "--", "missing"],
    ]);
  });
});

describe("ref object reads at commits", () => {
  test("exit 1 with missing-path stderr is absent like exit 128", async () => {
    const runner = fakeAsync({
      "git show main:gone": gitFailure("error: path 'gone' does not exist in 'main'\n", 1),
    });
    expect(await readBlobAtRef("/repo", "main", "gone", runner)).toBeUndefined();
  });

  test("listTreeChildrenAtRef keeps blob tree and commit entries only", async () => {
    const treeListing =
      `100644 blob ${OID_A}\tblob.md\0` +
      `040000 tree ${OID_B}\tdir\0` +
      `160000 commit ${OID_C}\tgitlink\0` +
      `120000 submodule ${OID_A}\tskipped\0`;
    const runner = fakeAsync({
      "git ls-tree -z main:.": treeListing,
    });
    expect(await listTreeChildrenAtRef("/repo", "main", ".", runner)).toEqual([
      { mode: "100644", type: "blob", oid: OID_A, name: "blob.md" },
      { mode: "040000", type: "tree", oid: OID_B, name: "dir" },
      { mode: "160000", type: "commit", oid: OID_C, name: "gitlink" },
    ]);
  });

  test("tree children, recursive paths, blob read, commit count, and local heads", async () => {
    const treeListing = `100644 blob ${OID_A}\tindex.md\0${`040000 tree ${OID_B}\tspec-dir\0`}`;
    const runner = fakeAsync({
      "git ls-tree -z main:v2/spec": treeListing,
      "git ls-tree -z missing:path": gitFailure("fatal: Not a valid object name missing:path\n", 128),
      "git ls-tree -r -z --name-only main -- v2/spec/spec-dir": `v2/spec/spec-dir/index.md\0v2/spec/spec-dir/task.md\0`,
      "git ls-tree -r -z --name-only main -- gone": gitFailure("fatal: path 'gone' does not exist in 'main'\n", 128),
      "git show main:v2/spec/spec-dir/index.md": "# spec\n",
      "git show main:missing": gitFailure("fatal: path 'missing' does not exist in 'main'\n", 128),
      "git rev-list --count main..feature": "3\n",
      "git rev-list --count main..broken": gitFailure("fatal: bad revision broken\n", 128),
      "git for-each-ref --format=%(refname:short) %(objectname) refs/heads/": `main ${OID_A}\nfeature ${OID_B}\n`,
    });
    const children = await listTreeChildrenAtRef("/repo", "main", "v2/spec", runner);
    expect(children).toEqual([
      { mode: "100644", type: "blob", oid: OID_A, name: "index.md" },
      { mode: "040000", type: "tree", oid: OID_B, name: "spec-dir" },
    ]);
    expect(await listTreeChildrenAtRef("/repo", "missing", "path", runner)).toBeUndefined();
    expect(await listRecursivePathsAtRef("/repo", "main", "v2/spec/spec-dir", runner)).toEqual([
      "v2/spec/spec-dir/index.md",
      "v2/spec/spec-dir/task.md",
    ]);
    expect(await listRecursivePathsAtRef("/repo", "main", "gone", runner)).toBeUndefined();
    expect(await readBlobAtRef("/repo", "main", "v2/spec/spec-dir/index.md", runner)).toBe("# spec\n");
    expect(await readBlobAtRef("/repo", "main", "missing", runner)).toBeUndefined();
    expect(await countCommitsBetween("/repo", "main", "feature", runner)).toBe(3);
    expectFailure(
      await rejection(countCommitsBetween("/repo", "main", "broken", runner)),
      "ref-query",
      "failed",
      false,
    );
    expect(await listLocalBranchHeads("/repo", runner)).toEqual([
      { branch: "main", oid: OID_A },
      { branch: "feature", oid: OID_B },
    ]);
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "ls-tree", "-z", "main:v2/spec"],
      ["git", "ls-tree", "-z", "missing:path"],
      ["git", "ls-tree", "-r", "-z", "--name-only", "main", "--", "v2/spec/spec-dir"],
      ["git", "ls-tree", "-r", "-z", "--name-only", "main", "--", "gone"],
      ["git", "show", "main:v2/spec/spec-dir/index.md"],
      ["git", "show", "main:missing"],
      ["git", "rev-list", "--count", "main..feature"],
      ["git", "rev-list", "--count", "main..broken"],
      ["git", "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/"],
    ]);
  });
});

describe("resolveRef", () => {
  test("resolved OID, silent exit 1 as absent, anything else inconclusive", async () => {
    const runner = fakeAsync({
      "git rev-parse --verify --quiet feature": `${OID_A}\n`,
      "git rev-parse --verify --quiet nope": gitFailure("", 1),
      "git rev-parse --verify --quiet broken": gitFailure("fatal: not a git repository\n"),
      "git rev-parse --verify --quiet slow": timeoutFailure(),
    });
    const resolved: RefResolution = await resolveRef("/repo", "feature", runner);
    expect(resolved).toEqual({ status: "resolved", oid: OID_A });
    expect(await resolveRef("/repo", "nope", runner)).toEqual({ status: "absent" });
    expectFailure(await rejection(resolveRef("/repo", "broken", runner)), "ref-query", "failed", false);
    expectFailure(await rejection(resolveRef("/repo", "slow", runner)), "ref-query", "timeout", true);
    expect(runner.calls[0]?.args).toEqual(["git", "rev-parse", "--verify", "--quiet", "feature"]);
  });
});

describe("updateRef", () => {
  test("lock-file contention is the retryable lock reason, not a precondition", async () => {
    const contended = fakeAsync({
      [`git update-ref refs/heads/a ${OID_A}`]: gitFailure(
        "error: Unable to create '/repo/.git/refs/heads/a.lock': File exists.\n",
      ),
      [`git update-ref refs/heads/b ${OID_A} ${OID_B}`]: gitFailure(
        "fatal: update_ref failed for ref 'refs/heads/b': cannot lock ref 'refs/heads/b': Unable to create '/repo/.git/refs/heads/b.lock': File exists.\n",
      ),
    });
    const plain = await rejection(updateRef("/repo", "refs/heads/a", OID_A, contended));
    expectFailure(plain, "update-ref", "lock", true);
    expect(isRetryableGitError(plain)).toBe(true);
    expectFailure(
      await rejection(updateRef("/repo", "refs/heads/b", OID_A, contended, { oldOid: OID_B })),
      "update-ref",
      "lock",
      true,
    );
  });

  test("pins the plain and compare-and-swap forms; a moved ref is a precondition failure", async () => {
    const runner = fakeAsync({
      [`git update-ref refs/heads/a ${OID_A}`]: "",
      [`git update-ref refs/heads/b ${OID_A} ${OID_B}`]: gitFailure(
        `fatal: update_ref failed for ref 'refs/heads/b': cannot lock ref 'refs/heads/b': is at ${OID_A} but expected ${OID_B}\n`,
      ),
    });
    await updateRef("/repo", "refs/heads/a", OID_A, runner);
    expectFailure(
      await rejection(updateRef("/repo", "refs/heads/b", OID_A, runner, { oldOid: OID_B })),
      "update-ref",
      "precondition",
      false,
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "update-ref", "refs/heads/a", OID_A],
      ["git", "update-ref", "refs/heads/b", OID_A, OID_B],
    ]);
  });
});

describe("deleteRef", () => {
  test("absent skips the mutation, present deletes, inconclusive query propagates", async () => {
    const runner = fakeAsync({
      "git rev-parse --verify --quiet refs/remotes/origin/gone": gitFailure("", 1),
      "git rev-parse --verify --quiet refs/remotes/origin/stale": `${OID_A}\n`,
      "git update-ref -d refs/remotes/origin/stale": "",
      "git rev-parse --verify --quiet refs/remotes/origin/slow": timeoutFailure(),
    });
    const absent: RefDeleteResult = await deleteRef("/repo", "refs/remotes/origin/gone", runner);
    expect(absent).toEqual({ status: "absent" });
    expect(await deleteRef("/repo", "refs/remotes/origin/stale", runner)).toEqual({ status: "deleted" });
    expectFailure(
      await rejection(deleteRef("/repo", "refs/remotes/origin/slow", runner)),
      "ref-query",
      "timeout",
      true,
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "rev-parse", "--verify", "--quiet", "refs/remotes/origin/gone"],
      ["git", "rev-parse", "--verify", "--quiet", "refs/remotes/origin/stale"],
      ["git", "update-ref", "-d", "refs/remotes/origin/stale"],
      ["git", "rev-parse", "--verify", "--quiet", "refs/remotes/origin/slow"],
    ]);
  });
});

describe("pushBranch", () => {
  test("pins push, upstream, and delete forms under network options", async () => {
    const controller = new AbortController();
    const runner = fakeAsync({
      "git push origin feature": "",
      "git push -u origin feature": "",
      "git push upstream --delete feature": "",
    });
    const pushed: PushResult = await pushBranch("/repo", { branch: "feature" }, runner);
    expect(pushed).toEqual({ status: "pushed" });
    expect(
      await pushBranch("/repo", { branch: "feature", setUpstream: true }, runner, { signal: controller.signal }),
    ).toEqual({ status: "pushed" });
    expect(await pushBranch("/repo", { branch: "feature", remote: "upstream", delete: true }, runner)).toEqual({
      status: "pushed",
    });
    expect(runner.calls.map((call) => call.args)).toEqual([
      ["git", "push", "origin", "feature"],
      ["git", "push", "-u", "origin", "feature"],
      ["git", "push", "upstream", "--delete", "feature"],
    ]);
    const options = runner.calls[1]?.options;
    expect(options?.timeoutMs).toBe(NETWORK_SUBPROCESS_TIMEOUT_MS);
    expect(options?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(options?.signal).toBe(controller.signal);
    expect(runner.calls[0]?.options?.signal).toBeUndefined();
  });

  test("deleting an already-absent remote branch is success; other outcomes classify", async () => {
    const absent = fakeAsync({
      "git push origin --delete gone": gitFailure("error: unable to delete 'gone': remote ref does not exist\n", 1),
    });
    expect(await pushBranch("/repo", { branch: "gone", delete: true }, absent)).toEqual({ status: "already-absent" });

    const cases: Array<[string, GitFailureReason, boolean]> = [
      ["remote: Permission denied\nfatal: Authentication failed for 'https://x'\n", "auth", false],
      [
        "remote: Permission to o/r.git denied to user.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403\n",
        "auth",
        false,
      ],
      ["fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 401\n", "auth", false],
      ["fatal: unable to access 'https://x': Could not resolve host: github.com\n", "network", true],
      [
        " ! [rejected] feature -> feature (non-fast-forward)\nerror: failed to push some refs to 'origin'\n",
        "rejected",
        false,
      ],
      ["fatal: 'origin' does not appear to be a git repository\n", "failed", false],
    ];
    for (const [stderr, reason, retryable] of cases) {
      const runner = fakeAsync({ "git push origin feature": gitFailure(stderr, 1) });
      const error = await rejection(pushBranch("/repo", { branch: "feature" }, runner));
      expectFailure(error, "push", reason, retryable);
      expect(isRetryableGitError(error)).toBe(retryable);
    }
    const timeout = fakeAsync({ "git push origin feature": timeoutFailure() });
    expectFailure(await rejection(pushBranch("/repo", { branch: "feature" }, timeout)), "push", "timeout", true);
  });
});

describe("lsRemoteRef", () => {
  test("returns the tip sha when ls-remote reports the ref, undefined when absent", async () => {
    const present = fakeAsync({ "git ls-remote origin refs/heads/feature": "abc123def\trefs/heads/feature\n" });
    expect(await lsRemoteRef("/repo", "origin", "refs/heads/feature", present)).toBe("abc123def");
    expect(present.calls[0]).toMatchObject({
      args: ["git", "ls-remote", "origin", "refs/heads/feature"],
      cwd: "/repo",
    });
    expect(present.calls[0]?.options?.timeoutMs).toBe(NETWORK_SUBPROCESS_TIMEOUT_MS);

    const absent = fakeAsync({ "git ls-remote origin refs/heads/missing": "" });
    expect(await lsRemoteRef("/repo", "origin", "refs/heads/missing", absent)).toBeUndefined();
  });

  test("ls-remote failures are ref-query errors", async () => {
    const failed = fakeAsync({
      "git ls-remote origin refs/heads/x": gitFailure("fatal: could not read from remote\n"),
    });
    expectFailure(
      await rejection(lsRemoteRef("/repo", "origin", "refs/heads/x", failed)),
      "ref-query",
      "failed",
      false,
    );
  });
});

describe("remoteUrl", () => {
  test("returns the trimmed URL and absent when the remote is missing", async () => {
    const runner = fakeAsync({
      "git remote get-url origin": "https://github.com/o/r.git\n",
      "git remote get-url upstream": gitFailure("fatal: No such remote 'upstream'\n", 2),
    });
    const resolved: RemoteUrlResult = await remoteUrl("/repo", "origin", runner);
    expect(resolved).toEqual({ status: "resolved", url: "https://github.com/o/r.git" });
    expect(await remoteUrl("/repo", "upstream", runner)).toEqual({ status: "absent" });
    expect(runner.calls[0]).toEqual({
      args: ["git", "remote", "get-url", "origin"],
      cwd: "/repo",
      options: {},
    });
  });

  test("other failures are remote-url errors", async () => {
    const failed = fakeAsync({ "git remote get-url origin": gitFailure("fatal: not a git repository\n") });
    expectFailure(await rejection(remoteUrl("/nowhere", "origin", failed)), "remote-url", "failed", false);
  });
});

describe("isRetryableGitError", () => {
  test("false for non-Git errors and fatal reasons", () => {
    expect(isRetryableGitError(new Error("x"))).toBe(false);
    expect(isRetryableGitError(new GitOperationError("push", "rejected", "x", "", 1))).toBe(false);
    expect(isRetryableGitError(new GitOperationError("push", "network", "x", "", 1))).toBe(true);
  });
});

describe("gitDir and gitCommonDir", () => {
  test("gitDir is the trimmed absolute per-worktree dir; failure is git-dir", () => {
    const runner = fakeRunner({ "git rev-parse --absolute-git-dir": "/repo/.git/worktrees/lane\n" });
    expect(gitDir("/wt/lane", runner)).toBe("/repo/.git/worktrees/lane");
    expect(runner.calls).toEqual([{ args: ["git", "rev-parse", "--absolute-git-dir"], cwd: "/wt/lane" }]);
    const syncError = Object.assign(new Error("Command failed: git rev-parse --absolute-git-dir"), {
      status: 128,
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
    });
    const outside = fakeRunner({ "git rev-parse --absolute-git-dir": syncError });
    expect(() => gitDir("/nowhere", outside)).toThrow(GitOperationError);
    try {
      gitDir("/nowhere", outside);
    } catch (error) {
      const failure = error as GitOperationError;
      expectFailure(failure, "git-dir", "failed", false);
      expect(failure.stderr).toBe("fatal: not a git repository (or any of the parent directories): .git\n");
      expect(failure.status).toBe(128);
      expect(failure.message).toBe(
        "git git-dir failed: fatal: not a git repository (or any of the parent directories): .git",
      );
    }
  });

  test("gitCommonDir resolves the shared dir absolutely", async () => {
    const runner = fakeAsync({ "git rev-parse --path-format=absolute --git-common-dir": "/repo/.git/\n" });
    expect(await gitCommonDir("/wt/lane", runner)).toBe("/repo/.git");
    expect(runner.calls).toEqual([
      { args: ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: "/wt/lane", options: {} },
    ]);
    const failed = fakeAsync({
      "git rev-parse --path-format=absolute --git-common-dir": gitFailure("fatal: not a git repository\n"),
    });
    expectFailure(await rejection(gitCommonDir("/nowhere", failed)), "git-dir", "failed", false);
  });
});

describe("isInsideWorkTree", () => {
  test("true inside a tree, false on git's answer or its not-a-repository diagnostics, else inconclusive", async () => {
    const controller = new AbortController();
    const inside = fakeAsync({ "git rev-parse --is-inside-work-tree": "true\n" });
    expect(await isInsideWorkTree("/wt", inside, { signal: controller.signal })).toBe(true);
    expect(inside.calls).toEqual([
      { args: ["git", "rev-parse", "--is-inside-work-tree"], cwd: "/wt", options: { signal: controller.signal } },
    ]);
    expect(await isInsideWorkTree("/repo/.git", fakeAsync({ "git rev-parse --is-inside-work-tree": "false\n" }))).toBe(
      false,
    );
    for (const stderr of [
      "fatal: not a git repository (or any of the parent directories): .git\n",
      "fatal: gitfile does not point to a valid repository: /x/.git\n",
    ]) {
      const outside = fakeAsync({ "git rev-parse --is-inside-work-tree": gitFailure(stderr) });
      expect(await isInsideWorkTree("/plain", outside)).toBe(false);
    }
    const broken = fakeAsync({ "git rev-parse --is-inside-work-tree": gitFailure("fatal: ambiguous argument\n") });
    expectFailure(await rejection(isInsideWorkTree("/x", broken)), "work-tree-query", "failed", false);
    const slow = fakeAsync({ "git rev-parse --is-inside-work-tree": timeoutFailure() });
    expectFailure(await rejection(isInsideWorkTree("/x", slow)), "work-tree-query", "timeout", true);
  });

  test("a failure after the caller aborted is aborted, never a plain directory", async () => {
    const controller = new AbortController();
    controller.abort();
    for (const stderr of ["", "fatal: not a git repository (or any of the parent directories): .git\n"]) {
      const runner = fakeAsync({
        "git rev-parse --is-inside-work-tree": new AsyncSubprocessError(
          "Command failed",
          undefined,
          "",
          stderr,
          "SIGTERM",
        ),
      });
      expectFailure(
        await rejection(isInsideWorkTree("/wt", runner, { signal: controller.signal })),
        "work-tree-query",
        "aborted",
        false,
      );
    }
  });

  test("isNotGitRepositoryDiagnostic recognizes pre-2.56 and 2.56+ diagnostics only", () => {
    expect(isNotGitRepositoryDiagnostic("fatal: not a git repository: /nonexistent")).toBe(true);
    expect(isNotGitRepositoryDiagnostic("fatal: gitfile does not point to a valid repository: /x/.git")).toBe(true);
    expect(isNotGitRepositoryDiagnostic("fatal: ambiguous argument 'HEAD'")).toBe(false);
    expect(isNotGitRepositoryDiagnostic("")).toBe(false);
  });
});

describe("signal forwarding on the older async probes", () => {
  test("getCurrentBranchAsync and branchExistsOnOriginAsync pass the caller's signal to the runner", async () => {
    const controller = new AbortController();
    const branch = fakeAsync({ "git rev-parse --abbrev-ref HEAD": "feature\n" });
    expect(await getCurrentBranchAsync("/wt", branch, { signal: controller.signal })).toBe("feature");
    expect(branch.calls[0]?.options).toEqual({ signal: controller.signal });
    const origin = fakeAsync({ "git ls-remote --heads origin feature": "def456\trefs/heads/feature\n" });
    expect(await branchExistsOnOriginAsync("/repo", "feature", origin, { signal: controller.signal })).toBe(true);
    expect(origin.calls[0]?.options).toMatchObject({
      signal: controller.signal,
      timeoutMs: NETWORK_SUBPROCESS_TIMEOUT_MS,
    });
    const plain = fakeAsync({ "git rev-parse --abbrev-ref HEAD": "main\n" });
    await getCurrentBranchAsync("/wt", plain);
    expect(plain.calls[0]?.options).toEqual({});
  });
});
