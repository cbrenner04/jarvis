// Most tests use the SubprocessRunner seam (runner option) with a fake runner that
// resolves branch names from a mapping and no-ops all other git commands. A small
// set of tests that verify real git commit content or branch ref state use real
// subprocess — justified inline.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubprocessRunner } from "../../shared/subprocess.ts";
import { type CleanupIo, cleanupCommand } from "../src/commands/cleanup.ts";

function fakeRunner(
  branches: Record<string, string>,
): SubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    run(cmd, args, cwd) {
      calls.push({ args: [cmd, ...args], cwd });
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
        const worktreeName = cwd.split("/").at(-1) ?? "";
        const branch = branches[worktreeName];
        if (branch === undefined) throw new Error(`fakeRunner: unknown worktree "${worktreeName}"`);
        return `${branch}\n`;
      }
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
        const path = args[3] !== undefined ? args[3] : (args[2] ?? "");
        try {
          rmSync(path, { recursive: true, force: true });
        } catch {
          // already removed
        }
      }
      return "";
    },
  };
}

function captureIo(responses: string[] = []): {
  io: CleanupIo;
  out: () => string;
  err: () => string;
} {
  let out = "";
  let err = "";
  let readlineIndex = 0;

  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
      readlineSync: (_prompt) => {
        const response = responses[readlineIndex] ?? "n";
        readlineIndex++;
        return response;
      },
    },
    out: () => out,
    err: () => err,
  };
}

let root: string;
let projectRoot: string;
let worktreeDir: string;
let externalSpecsRoot: string;

function createTrackedWorktree(specName: string): string {
  const worktreePath = join(worktreeDir, specName);
  mkdirSync(worktreePath, { recursive: true });
  return worktreePath;
}

function createTrackedPlanWorktree(name: string): string {
  const dirName = `plan-${name}`;
  const worktreePath = join(worktreeDir, dirName);
  mkdirSync(worktreePath, { recursive: true });
  return worktreePath;
}

function _branchForWorktreeName(name: string): string {
  if (name.startsWith("plan-")) {
    return `plan/${name.slice("plan-".length)}`;
  }
  return name;
}

function runMergedCleanup(
  io: CleanupIo,
  runner?: SubprocessRunner,
  opts: Partial<Parameters<typeof cleanupCommand>[0]> = {},
): number {
  return cleanupCommand({
    projectRoot,
    io,
    isMergedPr: () => true,
    findMatchingOpenPrs: () => [],
    ...(runner !== undefined ? { runner } : {}),
    ...opts,
  });
}

function runMergedPlanCleanup(
  io: CleanupIo,
  runner?: SubprocessRunner,
  opts: Partial<Parameters<typeof cleanupCommand>[0]> = {},
): number {
  return cleanupCommand({
    projectRoot,
    io,
    targetDir: "v1/spec",
    isMergedPr: (branch) => branch.startsWith("plan/"),
    findMatchingOpenPrs: () => [],
    ...(runner !== undefined ? { runner } : {}),
    ...opts,
  });
}

function runExternalCleanup(io: CleanupIo, runner?: SubprocessRunner, root: string = externalSpecsRoot): number {
  return cleanupCommand({
    projectRoot,
    io,
    commit: false,
    externalSpecsRoot: root,
    isMergedPr: () => true,
    findMatchingOpenPrs: () => [],
    ...(runner !== undefined ? { runner } : {}),
  });
}

/** A spec with one checked non-human-only acceptance criterion (genuinely complete, non-vacuous). */
function completeSpec(title: string): string {
  return `# ${title}\n\n## Acceptance criteria\n- [x] done\n`;
}

function timestampedSlug(name: string): string {
  return `2026-06-29T00-00-00Z-${name}`;
}

function writeV1TimestampedSpec(name: string, body: string): { slug: string; source: string } {
  const slug = timestampedSlug(name);
  const source = join(projectRoot, "v1", "spec", slug);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "index.md"), body);
  return { slug, source };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-"));
  projectRoot = root;
  worktreeDir = join(projectRoot, ".worktree");
  externalSpecsRoot = join(projectRoot, "external-specs");
  mkdirSync(worktreeDir, { recursive: true });
  mkdirSync(externalSpecsRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cleanupCommand", () => {
  test("no worktrees prints no merged worktrees", () => {
    const { io, out } = captureIo();
    const code = cleanupCommand({ projectRoot, io });
    expect(code).toBe(0);
    expect(out()).toBe("no merged worktrees to remove\n");
  });

  describe("abandon", () => {
    test("abandon retires a closed-PR worktree and leaves the spec in place", () => {
      const { io } = captureIo(["yes"]);
      const specName = "abandon-closed-pr";
      const worktreePath = createTrackedWorktree(specName);
      const specDir = join(projectRoot, "spec", specName);
      const specPath = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specPath, "# rerun me\n");
      const runner = fakeRunner({ [specName]: specName });
      const deleteLocalBranchCalls: string[] = [];
      const deleteRemoteBranchCalls: string[] = [];

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: (_root, branch) => {
          deleteLocalBranchCalls.push(branch);
        },
        deleteRemoteBranch: (_root, branch) => {
          deleteRemoteBranchCalls.push(branch);
        },
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(specDir)).toBe(true);
      expect(readFileSync(specPath, "utf8")).toBe("# rerun me\n");
      expect(deleteLocalBranchCalls).toEqual([specName]);
      expect(deleteRemoteBranchCalls).toEqual([specName]);
    });

    test("abandon retires a no-PR worktree", () => {
      const { io } = captureIo(["yes"]);
      const specName = "abandon-no-pr";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });
      const deleteLocalBranchCalls: string[] = [];

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: (_root, branch) => {
          deleteLocalBranchCalls.push(branch);
        },
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(deleteLocalBranchCalls).toEqual([specName]);
    });

    test("abandon closes an open draft PR before retiring", () => {
      const { io } = captureIo(["yes"]);
      const specName = "abandon-draft-pr";
      const worktreePath = createTrackedWorktree(specName);
      const closedPrs: number[] = [];
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [{ number: 42, isDraft: true }],
        closePr: (prNumber) => {
          closedPrs.push(prNumber);
        },
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(closedPrs).toEqual([42]);
      expect(existsSync(worktreePath)).toBe(false);
    });

    test("abandon skips merged worktrees", () => {
      const { io, out } = captureIo();
      const specName = "leave-merged-alone";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => true,
        runner,
      });

      expect(code).toBe(0);
      expect(out()).toBe("no abandoned worktrees to remove\n");
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("abandon skips ready PRs and multiple matching PRs", () => {
      const { io, out } = captureIo();
      const readyPath = createTrackedWorktree("skip-ready-pr");
      const multiplePath = createTrackedWorktree("skip-multiple-prs");
      const runner = fakeRunner({ "skip-ready-pr": "skip-ready-pr", "skip-multiple-prs": "skip-multiple-prs" });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: (branch) => {
          if (branch === "skip-ready-pr") {
            return [{ number: 7, isDraft: false }];
          }
          if (branch === "skip-multiple-prs") {
            return [
              { number: 8, isDraft: true },
              { number: 9, isDraft: true },
            ];
          }
          return [];
        },
        runner,
      });

      expect(code).toBe(0);
      expect(out()).toContain("skipping skip-ready-pr: open ready PR #7");
      expect(out()).toContain("skipping skip-multiple-prs: multiple open PRs match branch skip-multiple-prs");
      expect(existsSync(readyPath)).toBe(true);
      expect(existsSync(multiplePath)).toBe(true);
    });

    test("abandon force-removes a dirty worktree", () => {
      const { io } = captureIo(["yes"]);
      const specName = "dirty-abandon";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
    });

    test("abandon tolerates missing remote branches", () => {
      const { io } = captureIo(["yes"]);
      const specName = "missing-remote-abandon";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
    });

    test("abandon keeps retiring when closePr fails", () => {
      const { io, err } = captureIo(["yes"]);
      const specName = "close-pr-fails";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [{ number: 11, isDraft: true }],
        closePr: () => {
          throw new Error("already closed");
        },
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(err()).toContain("failed to close PR #11");
      expect(existsSync(worktreePath)).toBe(false);
    });

    test("abandon dry-run previews eligible worktrees and makes no changes", () => {
      const { io, out, err } = captureIo();
      const worktreePath = createTrackedWorktree("preview-me");
      const closeCalls: number[] = [];
      const runner = fakeRunner({ "preview-me": "preview-me" });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        dryRun: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [{ number: 12, isDraft: true }],
        closePr: (prNumber) => {
          closeCalls.push(prNumber);
        },
        runner,
      });

      expect(code).toBe(0);
      expect(out()).toContain("Worktrees to remove:");
      expect(out()).toContain("preview-me");
      expect(out()).not.toContain("Remove these worktrees?");
      expect(err()).toBe("");
      expect(closeCalls).toEqual([]);
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("abandon cancel leaves worktree and branches untouched", () => {
      const { io, out } = captureIo(["n"]);
      const specName = "cancel-abandon";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        runner,
      });

      expect(code).toBe(0);
      expect(out()).toContain("cancelled");
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("scoped abandon retires only the named eligible worktree", () => {
      const { io } = captureIo(["yes"]);
      const targetName = "scoped-target";
      const otherName = "scoped-other";
      const targetPath = createTrackedWorktree(targetName);
      const otherPath = createTrackedWorktree(otherName);
      const specDir = join(projectRoot, "spec", targetName);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# keep me\n");
      const runner = fakeRunner({ [targetName]: targetName, [otherName]: otherName });
      const deleteLocalBranchCalls: string[] = [];

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: targetName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: (_root, branch) => {
          deleteLocalBranchCalls.push(branch);
        },
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(targetPath)).toBe(false);
      expect(existsSync(otherPath)).toBe(true);
      expect(existsSync(specDir)).toBe(true);
      expect(deleteLocalBranchCalls).toEqual([targetName]);
    });

    test("scoped abandon prints path preview before confirmation", () => {
      const { io, out } = captureIo(["yes"]);
      const specName = "scoped-preview";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: specName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(out()).toContain("Worktree to remove:");
      expect(out()).toContain(`${worktreePath} (${specName})`);
      expect(out()).not.toContain("Worktrees to remove:");
    });

    test("scoped abandon plan branch preview includes (plan)", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "scoped-plan";
      const worktreePath = createTrackedPlanWorktree(name);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: `plan-${name}`,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(out()).toContain(`${worktreePath} (plan/${name} (plan))`);
    });

    test("scoped abandon unknown worktree refuses without changes", () => {
      const { io, err } = captureIo();
      const runner = fakeRunner({});

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: "missing-tree",
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        runner,
      });

      expect(code).toBe(1);
      expect(err()).toBe("unknown worktree: missing-tree\n");
    });

    test.each([
      [
        "merged branch",
        "scoped-merged",
        { isMergedPr: () => true },
        (name: string) => `cannot abandon ${name}: branch ${name} PR is merged\n`,
      ],
      [
        "ready PR",
        "scoped-ready-pr",
        { findMatchingOpenPrs: () => [{ number: 7, isDraft: false }] },
        (name: string) => `unsafe PR state for branch ${name}: matching open PR #7 is not draft\n`,
      ],
      [
        "multiple open PRs",
        "scoped-multi-pr",
        {
          findMatchingOpenPrs: () => [
            { number: 8, isDraft: true },
            { number: 9, isDraft: true },
          ],
        },
        (name: string) => `unsafe PR state for branch ${name}: multiple open PRs match; refusing abandon\n`,
      ],
      [
        "PR inspection failure",
        "scoped-pr-inspect",
        {
          findMatchingOpenPrs: () => {
            throw new Error("gh down");
          },
        },
        (name: string) => `failed to inspect PR state for branch ${name}: gh down\n`,
      ],
    ])("scoped abandon refuses %s", (_label, specName, opts, expectedErr) => {
      const { io, err } = captureIo();
      createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      expect(
        cleanupCommand({
          projectRoot,
          io,
          abandon: true,
          worktreeName: specName,
          isMergedPr: () => false,
          findMatchingOpenPrs: () => [],
          ...opts,
          runner,
        }),
      ).toBe(1);
      expect(err()).toBe(expectedErr(specName));
    });

    test("scoped abandon refuses when branch cannot be determined", () => {
      const { io, err } = captureIo();
      const specName = "scoped-no-branch";
      const worktreePath = join(worktreeDir, specName);
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(join(worktreePath, ".git"), "gitdir: /nonexistent/worktree-gitdir\n");

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: specName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        runner: fakeRunner({}),
      });

      expect(code).toBe(1);
      expect(err()).toBe(`cannot abandon ${specName}: could not determine branch\n`);
    });

    test("scoped abandon refuses live lock", () => {
      const { io, err } = captureIo();
      const specName = "scoped-live-lock";
      const worktreePath = createTrackedWorktree(specName);
      writeFileSync(
        join(worktreePath, ".jarvis.lock"),
        `${JSON.stringify({ pid: process.pid, started_at: "2026-06-29T00:00:00.000Z", host: "test" }, null, 2)}\n`,
      );
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: specName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        runner,
      });

      expect(code).toBe(9);
      expect(err()).toBe(`worktree is in use by process ${process.pid} (started at 2026-06-29T00:00:00.000Z)\n`);
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("scoped abandon ignores stale lock", () => {
      const { io } = captureIo(["yes"]);
      const specName = "scoped-stale-lock";
      const worktreePath = createTrackedWorktree(specName);
      writeFileSync(
        join(worktreePath, ".jarvis.lock"),
        `${JSON.stringify({ pid: 2_147_483_647, started_at: "2026-06-29T00:00:00.000Z", host: "test" }, null, 2)}\n`,
      );
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: specName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: () => {},
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
    });

    test("scoped abandon dry-run previews only named target", () => {
      const { io, out } = captureIo();
      const targetName = "scoped-dry-run";
      const otherName = "scoped-dry-other";
      const targetPath = createTrackedWorktree(targetName);
      createTrackedWorktree(otherName);
      const runner = fakeRunner({ [targetName]: targetName, [otherName]: otherName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: targetName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        dryRun: true,
        runner,
      });

      expect(code).toBe(0);
      expect(out()).toContain(targetPath);
      expect(out()).not.toContain(otherName);
      expect(out()).not.toContain("Remove these worktrees?");
      expect(existsSync(targetPath)).toBe(true);
    });

    test("scoped abandon cancel leaves worktree and branches untouched", () => {
      const { io, out } = captureIo(["n"]);
      const specName = "scoped-cancel";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: specName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        runner,
      });

      expect(code).toBe(0);
      expect(out()).toContain("cancelled");
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("scoped abandon retire failure exits 1", () => {
      const { io, err } = captureIo(["yes"]);
      const specName = "scoped-retire-fail";
      createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        abandon: true,
        worktreeName: specName,
        isMergedPr: () => false,
        findMatchingOpenPrs: () => [],
        deleteLocalBranch: () => {
          throw new Error("simulated branch delete failure");
        },
        deleteRemoteBranch: () => {},
        runner,
      });

      expect(code).toBe(1);
      expect(err()).toContain(`failed to remove ${specName}: simulated branch delete failure`);
    });
  });

  describe("merged-worktree with mocked runner", () => {
    test("archives plan-mode spec from spec/<name>", () => {
      const { io } = captureIo(["yes"]);
      const name = "plan-spec";
      const worktreePath = createTrackedPlanWorktree(name);
      const source = join(projectRoot, "spec", name);
      const destination = join(projectRoot, "spec", "completed", name);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# plan\n");
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = runMergedCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
    });

    test("archives timestamped plan-mode spec from configured targetDir", () => {
      const { io } = captureIo(["yes"]);
      const name = "plan-placeholder-safe-rendering";
      const timestampedName = `2026-05-23T17-53-16Z-${name}`;
      const worktreePath = createTrackedPlanWorktree(name);
      const source = join(projectRoot, "v1", "spec", timestampedName);
      const destination = join(projectRoot, "v1", "spec", "completed", timestampedName);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# plan\n");
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = cleanupCommand({
        projectRoot,
        io,
        targetDir: "v1/spec",
        isMergedPr: () => true,
        findMatchingOpenPrs: () => [],
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
    });

    test("dry-run does not mutate worktrees or spec directories", () => {
      const { io } = captureIo();
      const specName = "dry-run-spec";
      const worktreePath = createTrackedWorktree(specName);
      const source = join(projectRoot, "spec", specName);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# dry run\n");
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        dryRun: true,
        isMergedPr: () => true,
        runner,
      });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(true);
      expect(existsSync(source)).toBe(true);
      expect(existsSync(join(projectRoot, "spec", "completed"))).toBe(false);
    });

    test("missing source spec is non-fatal", () => {
      const { io, out, err } = captureIo(["y"]);
      const specName = "missing-spec";
      const worktreePath = createTrackedWorktree(specName);
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true, findMatchingOpenPrs: () => [], runner });

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(out()).toContain("no spec directory moved");
      expect(err()).toBe("");
    });

    test("reserved completed name reports failure and continues", () => {
      const { io, err } = captureIo(["y"]);
      const unsafe = createTrackedWorktree("completed");
      const safe = createTrackedWorktree("safe-spec");
      const safeSource = join(projectRoot, "spec", "safe-spec");
      const safeDestination = join(projectRoot, "spec", "completed", "safe-spec");
      mkdirSync(safeSource, { recursive: true });
      const runner = fakeRunner({ completed: "completed", "safe-spec": "safe-spec" });

      const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true, findMatchingOpenPrs: () => [], runner });

      expect(code).toBe(1);
      expect(existsSync(unsafe)).toBe(false);
      expect(existsSync(safe)).toBe(false);
      expect(existsSync(safeDestination)).toBe(true);
      expect(err()).toContain("unsafe spec archive mapping");
    });

    test("destination collision keeps source, reports failure, and continues", () => {
      const { io, err } = captureIo(["y"]);
      createTrackedWorktree("collide-spec");
      createTrackedWorktree("ok-spec");
      const collidingSource = join(projectRoot, "spec", "collide-spec");
      const collidingDestination = join(projectRoot, "spec", "completed", "collide-spec");
      const okSource = join(projectRoot, "spec", "ok-spec");
      const okDestination = join(projectRoot, "spec", "completed", "ok-spec");
      mkdirSync(collidingSource, { recursive: true });
      mkdirSync(collidingDestination, { recursive: true });
      mkdirSync(okSource, { recursive: true });
      const runner = fakeRunner({ "collide-spec": "collide-spec", "ok-spec": "ok-spec" });

      const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true, findMatchingOpenPrs: () => [], runner });

      expect(code).toBe(1);
      expect(existsSync(collidingSource)).toBe(true);
      expect(existsSync(collidingDestination)).toBe(true);
      expect(existsSync(okDestination)).toBe(true);
      expect(err()).toContain("spec archive destination already exists");
      expect(err()).toContain(collidingSource);
      expect(err()).toContain(collidingDestination);
    });

    test("if removal fails, spec is not moved", () => {
      const { io, err } = captureIo(["y"]);
      const specName = "remove-fails";
      createTrackedWorktree(specName);
      const source = join(projectRoot, "spec", specName);
      const destination = join(projectRoot, "spec", "completed", specName);
      mkdirSync(source, { recursive: true });
      const runner = fakeRunner({ [specName]: specName });

      const code = cleanupCommand({
        projectRoot,
        io,
        isMergedPr: () => true,
        removeItem: () => {
          throw new Error("simulated removal failure");
        },
        runner,
      });

      expect(code).toBe(1);
      expect(existsSync(source)).toBe(true);
      expect(existsSync(destination)).toBe(false);
      expect(err()).toContain("failed to remove");
    });

    test("default-spec project with coincidental v1/spec dir archives to spec/completed, not v1/spec/completed", () => {
      const { io } = captureIo(["yes"]);
      const specName = "default-spec-test";
      const worktreePath = createTrackedWorktree(specName);
      const source = join(projectRoot, "spec", specName);
      const destination = join(projectRoot, "spec", "completed", specName);
      const coincidentalV1 = join(projectRoot, "v1", "spec");
      mkdirSync(source, { recursive: true });
      mkdirSync(coincidentalV1, { recursive: true });
      writeFileSync(join(source, "index.md"), "# default spec\n");
      const runner = fakeRunner({ [specName]: specName });

      const code = runMergedCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
      expect(existsSync(join(projectRoot, "v1", "spec", "completed", specName))).toBe(false);
      expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# default spec\n");
    });

    test("merged-mode dry-run lists merged-but-dirty worktree without removing it", () => {
      const { io, out } = captureIo();
      const specName = "merged-dirty-dry-run";
      const worktreePath = createTrackedWorktree(specName);
      writeFileSync(join(worktreePath, "dirty.txt"), "dirty\n");
      const runner = fakeRunner({ [specName]: specName });

      expect(runMergedCleanup(io, runner, { dryRun: true })).toBe(0);
      expect(out()).toContain("Worktrees to remove:");
      expect(out()).toContain(specName);
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("not-merged dirty worktree is silently non-removed", () => {
      const { io, out } = captureIo(["y"]);
      const specName = "not-merged-dirty";
      const worktreePath = createTrackedWorktree(specName);
      writeFileSync(join(worktreePath, "dirty.txt"), "dirty\n");
      const runner = fakeRunner({ [specName]: specName });

      expect(runMergedCleanup(io, runner, { isMergedPr: () => false })).toBe(0);
      expect(out()).toBe("no merged worktrees to remove\n");
      expect(out()).not.toContain("Worktrees to remove:");
      expect(out()).not.toContain("uncommitted or unpushed changes");
      expect(existsSync(worktreePath)).toBe(true);
    });

    test("skips archive when an in-flight patch worktree remains for the timestamped spec name", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "skip-worktree";
      createTrackedPlanWorktree(name);
      createTrackedWorktree(timestampedSlug(name));
      const { slug, source } = writeV1TimestampedSpec(name, completeSpec(name));
      const runner = fakeRunner({
        [`plan-${name}`]: `plan/${name}`,
        [timestampedSlug(name)]: timestampedSlug(name),
      });

      const code = runMergedPlanCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(true);
      expect(out()).toContain(`skipping archival of ${slug}`);
      expect(out()).toContain("in-flight");
    });

    test("skips archive when an open implementation PR exists for the timestamped spec name", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "skip-open-pr";
      const { slug, source } = writeV1TimestampedSpec(name, completeSpec(name));
      createTrackedPlanWorktree(name);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = runMergedPlanCleanup(io, runner, {
        findMatchingOpenPrs: (branch) => (branch === slug ? [{ number: 7, isDraft: true }] : []),
      });

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(true);
      expect(out()).toContain(`skipping archival of ${slug}`);
      expect(out()).toContain("open implementation PR");
    });

    test("skips archive when the resolved spec still has an unchecked non-human-only acceptance criterion", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "skip-incomplete";
      const { slug, source } = writeV1TimestampedSpec(name, `# ${name}\n\n## Acceptance criteria\n- [ ] not done\n`);
      createTrackedPlanWorktree(name);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = runMergedPlanCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(true);
      expect(out()).toContain(`skipping archival of ${slug}`);
      expect(out()).toContain("spec not complete");
    });

    test("skips archive when a vacuous-complete spec has an in-flight patch worktree", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "skip-vacuous";
      const { slug, source } = writeV1TimestampedSpec(name, `# ${name}\n`);
      createTrackedPlanWorktree(name);
      createTrackedWorktree(slug);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}`, [slug]: slug });

      const code = runMergedPlanCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(true);
      expect(out()).toContain(`skipping archival of ${slug}`);
      expect(out()).toContain("spec not complete");
    });

    test("skips archive with a logged reason when findMatchingOpenPrs throws, and other worktrees continue", () => {
      const { io, out } = captureIo(["yes"]);
      const throwName = "skip-inspection";
      const okName = "inspection-ok";
      const { slug: throwSlug, source: throwSource } = writeV1TimestampedSpec(throwName, completeSpec(throwName));
      const { slug: okSlug, source: okSource } = writeV1TimestampedSpec(okName, completeSpec(okName));
      const okDestination = join(projectRoot, "v1", "spec", "completed", okSlug);
      createTrackedPlanWorktree(throwName);
      createTrackedPlanWorktree(okName);
      const runner = fakeRunner({ [`plan-${throwName}`]: `plan/${throwName}`, [`plan-${okName}`]: `plan/${okName}` });

      const code = runMergedPlanCleanup(io, runner, {
        findMatchingOpenPrs: (branch) => {
          if (branch === throwSlug) {
            throw new Error("gh down");
          }
          return [];
        },
      });

      expect(code).toBe(0);
      expect(existsSync(throwSource)).toBe(true);
      expect(existsSync(okSource)).toBe(false);
      expect(existsSync(okDestination)).toBe(true);
      expect(out()).toContain(`skipping archival of ${throwSlug}`);
      expect(out()).toContain("failed to inspect open PRs");
    });

    test("skips archive with a distinct reason when more than one open PR matches", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "skip-multi-pr";
      const { slug, source } = writeV1TimestampedSpec(name, completeSpec(name));
      createTrackedPlanWorktree(name);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = runMergedPlanCleanup(io, runner, {
        findMatchingOpenPrs: () => [
          { number: 1, isDraft: true },
          { number: 2, isDraft: true },
        ],
      });

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(true);
      expect(out()).toContain(`skipping archival of ${slug}`);
      expect(out()).toContain("multiple open PRs");
      expect(out()).not.toContain("open implementation PR");
    });

    test("archives when all three preconditions pass", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "all-clear";
      const { slug, source } = writeV1TimestampedSpec(name, completeSpec(name));
      const planWorktreePath = createTrackedPlanWorktree(name);
      const destination = join(projectRoot, "v1", "spec", "completed", slug);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = runMergedPlanCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(planWorktreePath)).toBe(false);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
      expect(out()).not.toContain("skipping archival of");
    });

    test("a skipped archive for one worktree does not block cleanup of other eligible merged worktrees", () => {
      const { io, out } = captureIo(["yes"]);
      const skippedName = "queue-skip";
      const archivedName = "queue-archive";
      const { slug: skippedSlug, source: skippedSource } = writeV1TimestampedSpec(
        skippedName,
        completeSpec(skippedName),
      );
      const { slug: archivedSlug, source: archivedSource } = writeV1TimestampedSpec(
        archivedName,
        completeSpec(archivedName),
      );
      const archivedDestination = join(projectRoot, "v1", "spec", "completed", archivedSlug);
      createTrackedPlanWorktree(skippedName);
      createTrackedPlanWorktree(archivedName);
      createTrackedWorktree(skippedSlug);
      const runner = fakeRunner({
        [`plan-${skippedName}`]: `plan/${skippedName}`,
        [`plan-${archivedName}`]: `plan/${archivedName}`,
        [skippedSlug]: skippedSlug,
      });

      const code = runMergedPlanCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(skippedSource)).toBe(true);
      expect(existsSync(archivedSource)).toBe(false);
      expect(existsSync(archivedDestination)).toBe(true);
      expect(out()).toContain(`skipping archival of ${skippedSlug}`);
    });

    test.each([
      [
        "uncommitted porcelain",
        "merged-dirty-porcelain",
        (path: string) => writeFileSync(join(path, "dirty.txt"), "dirty\n"),
        (name: string) => name,
      ],
      [
        "dirty plan worktree",
        "merged-dirty-plan",
        (path: string) => writeFileSync(join(path, "review-edit.txt"), "stale review\n"),
        (name: string) => `plan/${name}`,
      ],
    ])("merged-mode removes dirty worktree with %s", (_label, name, dirty, _branchFor) => {
      const { io, out } = captureIo(["y"]);
      const worktreePath = createTrackedPlanWorktree(name);
      dirty(worktreePath);
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      expect(runMergedPlanCleanup(io, runner)).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(out()).not.toContain("uncommitted or unpushed changes");
    });
  });

  describe("commit:false external archival (mock runner)", () => {
    test("archives external spec dir and prunes ready-intents by branch slug", () => {
      const { io } = captureIo(["yes"]);
      const name = "my-feature";
      createTrackedPlanWorktree(name);
      const timestampedName = `2026-06-27T05-48-27Z-${name}`;
      const source = join(externalSpecsRoot, timestampedName);
      const destination = join(externalSpecsRoot, "completed", timestampedName);
      const readyIntentPath = join(externalSpecsRoot, "ready-intents", `${name}.md`);
      mkdirSync(join(externalSpecsRoot, "ready-intents"), { recursive: true });
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# external plan\n");
      writeFileSync(readyIntentPath, "intent\n");
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}` });

      const code = runExternalCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
      expect(existsSync(readyIntentPath)).toBe(false);
      expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# external plan\n");
    });

    test("archives exact-match non-plan branch from external home", () => {
      const { io } = captureIo(["yes"]);
      const specName = "feature-branch";
      createTrackedWorktree(specName);
      const source = join(externalSpecsRoot, specName);
      const destination = join(externalSpecsRoot, "completed", specName);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# external branch\n");
      const runner = fakeRunner({ [specName]: specName });

      const code = runExternalCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
    });

    test("missing external source is non-fatal and names the external path", () => {
      const { io, out, err } = captureIo(["yes"]);
      createTrackedWorktree("missing-external");
      const runner = fakeRunner({ "missing-external": "missing-external" });

      const code = runExternalCleanup(io, runner);

      expect(code).toBe(0);
      expect(out()).toContain(
        `no spec directory moved for missing-external: missing ${join(externalSpecsRoot, "missing-external")}`,
      );
      expect(err()).toBe("");
    });

    test("destination collision keeps source and reports failure", () => {
      const { io, err } = captureIo(["yes"]);
      createTrackedWorktree("collide-external");
      const source = join(externalSpecsRoot, "collide-external");
      const destination = join(externalSpecsRoot, "completed", "collide-external");
      mkdirSync(source, { recursive: true });
      mkdirSync(destination, { recursive: true });
      const runner = fakeRunner({ "collide-external": "collide-external" });

      const code = runExternalCleanup(io, runner);

      expect(code).toBe(1);
      expect(existsSync(source)).toBe(true);
      expect(err()).toContain("spec archive destination already exists");
      expect(err()).toContain(source);
      expect(err()).toContain(destination);
    });

    test("external archival performs no git commit and works outside a git home", () => {
      const { io } = captureIo(["yes"]);
      const specName = "external-no-git";
      createTrackedWorktree(specName);
      const detachedExternalRoot = join(root, "detached-external-specs");
      const source = join(detachedExternalRoot, specName);
      const destination = join(detachedExternalRoot, "completed", specName);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# detached external\n");
      const runner = fakeRunner({ [specName]: specName });

      const code = runExternalCleanup(io, runner, detachedExternalRoot);

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
    });

    test("obeys the same archival preconditions before external rename", () => {
      const { io, out } = captureIo(["yes"]);
      const name = "external-skip";
      const slug = timestampedSlug(name);
      createTrackedPlanWorktree(name);
      createTrackedWorktree(slug);
      const source = join(externalSpecsRoot, slug);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), completeSpec(name));
      const runner = fakeRunner({ [`plan-${name}`]: `plan/${name}`, [slug]: slug });

      const code = runMergedPlanCleanup(io, runner, { commit: false, externalSpecsRoot });

      expect(code).toBe(0);
      expect(existsSync(source)).toBe(true);
      expect(out()).toContain(`skipping archival of ${slug}`);
      expect(out()).toContain("in-flight");
    });

    test("cleans up worktree after remote branch is deleted", () => {
      const { io, out } = captureIo(["y"]);
      const specName = "deleted-remote-spec";
      const worktreePath = createTrackedWorktree(specName);
      const source = join(projectRoot, "spec", specName);
      const destination = join(projectRoot, "spec", "completed", specName);
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.md"), "# spec\n");
      const runner = fakeRunner({ [specName]: specName });

      const code = runMergedCleanup(io, runner);

      expect(code).toBe(0);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(destination)).toBe(true);
      expect(out()).not.toContain("uncommitted or unpushed changes");
    });
  });
});

describe("cleanupCommand root-archival pass", () => {
  function runRootArchivalCleanup(
    io: CleanupIo,
    runner?: SubprocessRunner,
    opts: Partial<Parameters<typeof cleanupCommand>[0]> = {},
  ): number {
    return cleanupCommand({
      projectRoot,
      io,
      findMatchingOpenPrs: () => [],
      ...(runner !== undefined ? { runner } : {}),
      ...opts,
    });
  }

  function writeRootSpec(name: string, body: string): string {
    const source = join(projectRoot, "spec", name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), body);
    return source;
  }

  test("archives a root spec with no matching worktree ever having existed this run", () => {
    const { io, out } = captureIo();
    const name = "root-no-worktree";
    const source = writeRootSpec(name, completeSpec(name));
    const destination = join(projectRoot, "spec", "completed", name);
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(out()).toContain(`moved spec directory ${source}`);
  });

  test("scoped jarvis1 cleanup <spec-name> archives that one root spec", () => {
    const { io, out } = captureIo();
    const targetName = "root-scoped-target";
    const otherName = "root-scoped-other";
    const targetSource = writeRootSpec(targetName, completeSpec(targetName));
    const otherSource = writeRootSpec(otherName, completeSpec(otherName));
    const targetDestination = join(projectRoot, "spec", "completed", targetName);
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner, { worktreeName: targetName });

    expect(code).toBe(0);
    expect(existsSync(targetSource)).toBe(false);
    expect(existsSync(targetDestination)).toBe(true);
    expect(existsSync(otherSource)).toBe(true);
    expect(out()).not.toContain(otherName);
  });

  test("leaves an unchecked root spec in place", () => {
    const { io, out } = captureIo();
    const name = "root-unchecked";
    const source = writeRootSpec(name, `# ${name}\n\n## Acceptance criteria\n- [ ] not done\n`);
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(true);
    expect(out()).toContain(`skipping archival of ${name}`);
  });

  test("leaves a root spec with an open PR in place", () => {
    const { io } = captureIo();
    const name = "root-open-pr";
    const source = writeRootSpec(name, completeSpec(name));
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner, {
      findMatchingOpenPrs: (branch) => (branch === name ? [{ number: 3, isDraft: true }] : []),
    });

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(true);
  });

  test("leaves a root spec with a live worktree in place", () => {
    const { io } = captureIo();
    const name = "root-live-worktree";
    const source = writeRootSpec(name, completeSpec(name));
    createTrackedWorktree(name);
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(true);
  });

  test("runs the root-archival scan even with zero merged worktrees to remove", () => {
    const { io, out } = captureIo();
    const name = "root-zero-removed";
    const _source = writeRootSpec(name, completeSpec(name));
    const destination = join(projectRoot, "spec", "completed", name);
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner);

    expect(code).toBe(0);
    expect(existsSync(destination)).toBe(true);
    expect(out()).not.toContain("no merged worktrees to remove");
  });

  test("--dry-run lists root-archival candidates and archives nothing", () => {
    const { io, out } = captureIo();
    const name = "root-dry-run";
    const source = writeRootSpec(name, completeSpec(name));
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner, { dryRun: true });

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(true);
    expect(out()).toContain("Root specs to archive:");
    expect(out()).toContain(name);
  });

  test("--abandon does not run the root-archival pass", () => {
    const { io, out } = captureIo();
    const name = "root-abandon-skip";
    const source = writeRootSpec(name, completeSpec(name));
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner, { abandon: true });

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(true);
    expect(out()).not.toContain("Root specs to archive:");
  });

  test("two archivable root candidates in one run each get their own commit", () => {
    const { io } = captureIo();
    const nameA = "root-multi-a";
    const nameB = "root-multi-b";
    writeRootSpec(nameA, completeSpec(nameA));
    writeRootSpec(nameB, completeSpec(nameB));
    const runner = fakeRunner({});

    const code = runRootArchivalCleanup(io, runner);

    expect(code).toBe(0);
    const commitCalls = runner.calls.filter((c) => c.args[0] === "git" && c.args[1] === "commit");
    expect(commitCalls.length).toBe(2);
  });

  test("an already-archived root spec is not rescanned on a later run", () => {
    const { io } = captureIo();
    const name = "root-idempotent";
    writeRootSpec(name, completeSpec(name));
    const runner = fakeRunner({});

    const firstCode = runRootArchivalCleanup(io, runner);
    expect(firstCode).toBe(0);

    const { io: io2, out: out2 } = captureIo();
    const secondCode = runRootArchivalCleanup(io2, runner);

    expect(secondCode).toBe(0);
    expect(out2()).toBe("no merged worktrees to remove\n");
  });
});

// ── Real-subprocess tests ──────────────────────────────────────────────────────
// These tests verify real git commit content, branch ref state, or scoped
// abort-after-commit scenarios that inherently require real subprocess semantics.
// The fixture setup (init, config, commit, push) uses real git; cleanup runs with
// the default realSubprocessRunner.
describe("cleanupCommand (real subprocess)", () => {
  beforeEach(() => {
    execSync("git init -b main", { cwd: projectRoot, stdio: "pipe" });
    execSync("git config user.email 'test@example.com'", { cwd: projectRoot, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: projectRoot, stdio: "pipe" });
    writeFileSync(join(projectRoot, "README.md"), "test");
    execSync("git add README.md", { cwd: projectRoot, stdio: "pipe" });
    execSync("git commit -m 'initial'", { cwd: projectRoot, stdio: "pipe" });
    mkdirSync(join(projectRoot, "remote.git"), { recursive: true });
    execSync("git init --bare -b main", { cwd: join(projectRoot, "remote.git"), stdio: "pipe" });
    execSync(`git remote add origin ${join(projectRoot, "remote.git")}`, { cwd: projectRoot, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: projectRoot, stdio: "pipe" });
  });

  function realCreateTrackedWorktree(specName: string): string {
    const worktreePath = join(worktreeDir, specName);
    execSync(`git branch ${specName} main`, { cwd: projectRoot, stdio: "pipe" });
    execSync(`git push -u origin ${specName}`, { cwd: projectRoot, stdio: "pipe" });
    execSync(`git worktree add "${worktreePath}" ${specName}`, { cwd: projectRoot, stdio: "pipe" });
    return worktreePath;
  }

  test("archives patch-mode spec after successful cleanup", () => {
    const { io } = captureIo(["y"]);
    const specName = "patch-spec";
    const worktreePath = realCreateTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# patch\n");

    const code = runMergedCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# patch\n");
    expect(
      execSync("git show --name-status --pretty=format:%s HEAD", {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }),
    ).toContain("cleanup: archive spec patch-spec");
    expect(
      execSync("git rev-parse HEAD origin/main", {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }).trim(),
    ).toMatch(/^(.*?)\n\1$/);
    const committedRename = execSync("git show --name-status --pretty=format: HEAD", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(committedRename).toContain("A\tspec/completed/patch-spec/index.md");
    expect(committedRename).not.toContain("README.md");
  });

  test("removes pushed merged branch even when not reachable from local main", () => {
    const { io } = captureIo(["y"]);
    const specName = "squash-merged-spec";
    const worktreePath = realCreateTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# spec\n");
    writeFileSync(join(worktreePath, "feature.txt"), "feature\n");
    execSync("git add feature.txt", { cwd: worktreePath, stdio: "pipe" });
    execSync("git commit -m 'feature'", { cwd: worktreePath, stdio: "pipe" });
    execSync(`git push origin ${specName}`, { cwd: worktreePath, stdio: "pipe" });

    const code = runMergedCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(() =>
      execSync(`git rev-parse --verify ${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      }),
    ).toThrow();
  });

  test("cleanup commit does not stage or commit unrelated main-checkout changes", () => {
    const { io } = captureIo(["y"]);
    const specName = "scoped-stage-spec";
    realCreateTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# scoped\n");
    writeFileSync(join(projectRoot, "README.md"), "modified main checkout\n");
    writeFileSync(join(projectRoot, "scratch.txt"), "untracked\n");

    const code = runMergedCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    const committedRename = execSync("git show --name-status --pretty=format: HEAD", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(committedRename).toContain("A\tspec/completed/scoped-stage-spec/index.md");
    expect(committedRename).not.toContain("README.md");
    expect(committedRename).not.toContain("scratch.txt");
    const status = execSync("git status --short", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(status).toContain(" M README.md");
    expect(status).toContain("?? scratch.txt");
  });
});
