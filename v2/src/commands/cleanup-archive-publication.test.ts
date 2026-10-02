import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { createArchivePublicationSessions, inspectStrandedArtifacts, runCleanupCommand } from "./cleanup.ts";
import { createArchivePublicationSession } from "./cleanup-archive-publication.ts";
import type { ArtifactSpec } from "./cleanup-artifacts.ts";

function isCleanupArchiveBranchProbe(cmd: string, args: readonly string[]): boolean {
  if (cmd !== "gh" || args[0] !== "pr" || args[1] !== "view") return false;
  const branch = args[2];
  return typeof branch === "string" && branch.startsWith("cleanup/archive-");
}

function cleanupArchiveBranchProbeResponse(args: readonly string[], prNumber = 42): string {
  if (args[1] === "view") {
    const jsonIndex = args.indexOf("--json");
    if (jsonIndex >= 0) {
      return JSON.stringify({
        number: prNumber,
        url: `https://github.com/example/test/pull/${prNumber}`,
        baseRefName: "main",
      });
    }
    return JSON.stringify({ state: "OPEN", mergedAt: null });
  }
  return "[]";
}

function archivePublicationRunner(
  projectRoot: string,
  ghCalls: string[],
  options: {
    pushFails?: boolean;
    prCreateFails?: boolean;
    openPrNumber?: number;
    revListCommitCount?: number;
    foreignRemoteTip?: string;
  } = {},
): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (
        cmd === "git" &&
        args[0] === "rev-list" &&
        args[1] === "--count" &&
        options.revListCommitCount !== undefined
      ) {
        return `${options.revListCommitCount}\n`;
      }
      if (cmd === "git" && args[0] === "push") {
        if (options.pushFails) throw new AsyncSubprocessError("push failed", 1, "", "push failed", undefined);
        return "";
      }
      if (cmd === "git" && args[0] === "ls-remote") {
        return options.foreignRemoteTip === undefined ? "" : `${options.foreignRemoteTip}\t${args[2] ?? ""}\n`;
      }
      if (cmd === "gh" && args[0] === "pr") ghCalls.push(args.join(" "));
      if (isCleanupArchiveBranchProbe(cmd, args)) {
        return cleanupArchiveBranchProbeResponse(args, options.openPrNumber ?? 42);
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") {
        if (options.prCreateFails) {
          throw new AsyncSubprocessError("pr create failed", 1, "", "pr create failed", undefined);
        }
        return "https://github.com/example/test/pull/42";
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
        const jsonIndex = args.indexOf("--json");
        if (jsonIndex >= 0) {
          const selector = args[2];
          const num =
            selector !== undefined && /^\d+$/.test(selector)
              ? Number.parseInt(selector, 10)
              : (options.openPrNumber ?? 42);
          return JSON.stringify({
            number: num,
            url: `https://github.com/example/test/pull/${num}`,
            baseRefName: "main",
          });
        }
        return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        const headIndex = args.indexOf("--head");
        const head = headIndex >= 0 ? args[headIndex + 1] : undefined;
        const stateIndex = args.indexOf("--state");
        const state = stateIndex >= 0 ? args[stateIndex + 1] : undefined;
        if (state === "open") {
          if (options.openPrNumber !== undefined && typeof head === "string" && head.startsWith("cleanup/archive-")) {
            return JSON.stringify([{ number: options.openPrNumber, baseRefName: "main", isDraft: false }]);
          }
          return "[]";
        }
        if (state === "all" && typeof head === "string") {
          try {
            const oid = (
              await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", head], cwd ?? projectRoot)
            ).trim();
            return JSON.stringify([{ number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid }]);
          } catch {
            return "[]";
          }
        }
        return "[]";
      }
      return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
    },
  };
}

describe("cleanup archive publication session", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  async function commitFixtures(root: string): Promise<void> {
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], root);
    try {
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-q", "-m", "fixtures"], root);
    } catch {
      // nothing new
    }
  }

  function inRepoSpec(
    name: string,
    criterion: string,
    intent?: string,
    readyIntentBody?: string,
  ): { spec: ArtifactSpec; readyIntent?: string } {
    const home = join(projectRoot, "v2", "spec");
    const source = join(home, name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), `# Spec\n\n## Acceptance criteria\n\n- ${criterion}\n`);
    if (intent === undefined) {
      return { spec: { home, source, name, branch: "plan/example" } };
    }
    writeFileSync(join(source, "intent.md"), intent);
    if (readyIntentBody === undefined) {
      return { spec: { home, source, name, branch: "plan/example" } };
    }
    const readyIntent = join(home, "ready-intents", `${name}.md`);
    mkdirSync(dirname(readyIntent), { recursive: true });
    writeFileSync(readyIntent, readyIntentBody);
    return { spec: { home, source, name, branch: "plan/example" }, readyIntent };
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-archive-pub-${Date.now()}-${Math.random()}`);
    projectRoot = join(tempRoot, "project");
    jarvisRoot = join(tempRoot, "jarvis-home");
    mkdirSync(projectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "test@test.com"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "Test User"], projectRoot);
    writeFileSync(join(projectRoot, "README.md"), "# Test\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("publishConsumedReadyIntentOnly skips when no consumed ready-intent matches", async () => {
    const intent = "---\nname: example\n---\n";
    const { spec } = inRepoSpec("20260930T000000Z-example", "[x] Done", intent, "different queue bytes\n");
    await commitFixtures(projectRoot);
    const session = createArchivePublicationSession({
      runner: realAsyncSubprocessRunner,
      projectRoot,
      jarvisRoot,
      project: "project",
      stamp: "20260930T000000Z",
    });

    expect(await session.publishConsumedReadyIntentOnly(spec)).toEqual({
      status: "skipped",
      reason: "no consumed ready-intent to prune",
    });
    expect(session.commits()).toBe(0);
  });

  test("publishConsumedReadyIntentOnly commits ready-intent prune on the cleanup branch", async () => {
    const intent = "---\nname: prune-only\n---\n";
    const { spec, readyIntent } = inRepoSpec("20260930T000001Z-prune-only", "[x] Done", intent, intent);
    if (readyIntent === undefined) throw new Error("fixture must write a ready-intent");
    await commitFixtures(projectRoot);
    const session = createArchivePublicationSession({
      runner: realAsyncSubprocessRunner,
      projectRoot,
      jarvisRoot,
      project: "project",
      stamp: "20260930T000001Z",
    });

    const result = await session.publishConsumedReadyIntentOnly(spec);
    expect(result).toMatchObject({
      status: "intentPruned",
      readyIntent,
      branch: "cleanup/archive-20260930T000001Z",
    });
    expect(session.commits()).toBe(1);
    expect(existsSync(readyIntent)).toBe(true);
    const relReady = `v2/spec/ready-intents/20260930T000001Z-prune-only.md`;
    const tree = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["ls-tree", "-r", "--name-only", session.branch],
      projectRoot,
    );
    expect(tree).not.toContain(relReady);
    const log = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["log", "-1", "--format=%s", session.branch],
      projectRoot,
    );
    expect(log.trim()).toBe("spec: prune consumed ready-intent for 20260930T000001Z-prune-only");
    expect(readFileSync(readyIntent, "utf8")).toBe(intent);
  });

  async function stageSpecOnCleanupBranch(stagedBranch: string, specName: string): Promise<string> {
    const worktreePath = join(jarvisRoot, "worktrees", "project", stagedBranch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["worktree", "add", "-b", stagedBranch, worktreePath, "HEAD"],
      projectRoot,
    );
    const relSource = `v2/spec/${specName}`;
    const relDest = `v2/spec/completed/${specName}`;
    mkdirSync(dirname(join(worktreePath, relDest)), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["mv", relSource, relDest], worktreePath);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-q", "-m", "archive"], worktreePath);
    return worktreePath;
  }

  test("publish staged skip registers apply-end publication target", async () => {
    const specName = "20261002T100000Z-staged-publish";
    const stagedBranch = "cleanup/archive-20261002T100000Z";
    const { spec } = inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const worktreePath = await stageSpecOnCleanupBranch(stagedBranch, specName);
    const sessions = createArchivePublicationSessions(realAsyncSubprocessRunner, jarvisRoot, "20261002T999999Z");
    const session = sessions.for("project", projectRoot);
    expect(await session.publish(spec)).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining(`already staged on cleanup branch ${stagedBranch}`),
    });
    expect(session.commits()).toBe(0);
    expect(sessions.publicationTargets()).toEqual([
      {
        project: "project",
        projectRoot,
        branch: stagedBranch,
        worktreePath,
      },
    ]);
  });

  test("stranded inspection staged skip registers apply-end publication target", async () => {
    const specName = "20261002T100001Z-staged-stranded";
    const stagedBranch = "cleanup/archive-20261002T100001Z";
    inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const worktreePath = await stageSpecOnCleanupBranch(stagedBranch, specName);
    const home = join(projectRoot, "v2", "spec");
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch: "implement/staged-stranded",
          worktreePath: projectRoot,
          specPath: join(home, specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    const registry = { project: { root: projectRoot } };
    const sessions = createArchivePublicationSessions(realAsyncSubprocessRunner, jarvisRoot);
    await inspectStrandedArtifacts(
      [{ home, source: join(home, specName), name: specName, project: "project" }],
      registry,
      [],
      jarvisRoot,
      store,
      realAsyncSubprocessRunner,
      { stdout: () => {} },
      undefined,
      sessions,
    );
    expect(sessions.publicationTargets()).toEqual([
      {
        project: "project",
        projectRoot,
        branch: stagedBranch,
        worktreePath,
      },
    ]);
  });

  test("publicationTargetSession adopts staged branch without minting a new archive branch", async () => {
    const specName = "20261002T100002Z-staged-adopt";
    const stagedBranch = "cleanup/archive-20261002T100002Z";
    const newStamp = "20261002T888888Z";
    const { spec } = inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    await stageSpecOnCleanupBranch(stagedBranch, specName);
    const sessions = createArchivePublicationSessions(realAsyncSubprocessRunner, jarvisRoot, newStamp);
    const provisional = sessions.for("project", projectRoot);
    expect(await provisional.publish(spec)).toMatchObject({ status: "skipped" });
    expect(provisional.branch).toBe(`cleanup/archive-${newStamp}`);

    const adopted = sessions.publicationTargetSession("project", projectRoot);
    expect(adopted?.branch).toBe(stagedBranch);
    const branches = (
      await realAsyncSubprocessRunner.runAsync("git", ["branch", "--format=%(refname:short)"], projectRoot)
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(branches).toContain(stagedBranch);
    expect(branches).not.toContain(`cleanup/archive-${newStamp}`);
  });

  test("publicationTargetSession keeps session branch when this run already archived", async () => {
    const freshSpecName = "20261002T100003Z-fresh-archive";
    const stagedSpecName = "20261002T100004Z-staged-other";
    const stagedBranch = "cleanup/archive-20261002T100004Z";
    const runStamp = "20261002T777777Z";
    const runBranch = `cleanup/archive-${runStamp}`;
    const { spec: freshSpec } = inRepoSpec(freshSpecName, "[x] Done");
    const { spec: stagedSpec } = inRepoSpec(stagedSpecName, "[x] Done");
    await commitFixtures(projectRoot);
    await stageSpecOnCleanupBranch(stagedBranch, stagedSpecName);
    const sessions = createArchivePublicationSessions(realAsyncSubprocessRunner, jarvisRoot, runStamp);
    const session = sessions.for("project", projectRoot);
    expect(await session.publish(freshSpec)).toMatchObject({ status: "archived", branch: runBranch });
    expect(session.commits()).toBe(1);
    expect(await session.publish(stagedSpec)).toMatchObject({ status: "skipped" });

    const resolved = sessions.publicationTargetSession("project", projectRoot);
    expect(resolved?.branch).toBe(runBranch);
    expect(resolved?.commits()).toBe(1);
    expect(resolved).toBe(session);
  });
});

describe("cleanup apply-end archive publication", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  async function commitFixtures(root: string): Promise<void> {
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], root);
    try {
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-q", "-m", "fixtures"], root);
    } catch {
      // nothing new
    }
  }

  function inRepoSpec(name: string, criterion: string, intent?: string, readyIntentBody?: string): ArtifactSpec {
    const home = join(projectRoot, "v2", "spec");
    const source = join(home, name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), `# Spec\n\n## Acceptance criteria\n\n- ${criterion}\n`);
    if (intent !== undefined) writeFileSync(join(source, "intent.md"), intent);
    if (intent !== undefined && readyIntentBody !== undefined) {
      const readyIntent = join(home, "ready-intents", `${name}.md`);
      mkdirSync(dirname(readyIntent), { recursive: true });
      writeFileSync(readyIntent, readyIntentBody);
    }
    return { home, source, name, branch: "plan/example" };
  }

  async function stageSpecOnCleanupBranch(stagedBranch: string, specName: string): Promise<string> {
    const worktreePath = join(jarvisRoot, "worktrees", "project", stagedBranch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["worktree", "add", "-b", stagedBranch, worktreePath, "HEAD"],
      projectRoot,
    );
    const relSource = `v2/spec/${specName}`;
    const relDest = `v2/spec/completed/${specName}`;
    mkdirSync(dirname(join(worktreePath, relDest)), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["mv", relSource, relDest], worktreePath);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-q", "-m", "archive"], worktreePath);
    return worktreePath;
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-archive-apply-${Date.now()}-${Math.random()}`);
    projectRoot = join(tempRoot, "project");
    jarvisRoot = join(tempRoot, "jarvis-home");
    mkdirSync(projectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "test@test.com"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "Test User"], projectRoot);
    writeFileSync(join(projectRoot, "README.md"), "# Test\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("apply with new archive commits pushes once and opens a ready archive PR", async () => {
    const specName = "20261002T120000Z-apply-publish";
    const branch = "implement/apply-publish";
    const intent = "---\nname: apply\n---\n";
    inRepoSpec(specName, "[x] Done", intent, intent);
    await commitFixtures(projectRoot);
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    const ghCalls: string[] = [];
    const gitCalls: string[] = [];
    let stdout = "";
    let stderr = "";
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "push") gitCalls.push(args.join(" "));
        return archivePublicationRunner(projectRoot, ghCalls).runAsync(cmd, args, cwd);
      },
    };
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      runner,
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("https://github.com/example/test/pull/42");
    const creates = ghCalls.filter((call) => call.startsWith("pr create"));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain("--base main");
    expect(creates[0]).toContain("Archive completed specs for project");
    expect(gitCalls.some((call) => call.startsWith("push"))).toBe(true);
  });

  async function materializeWorktree(branch: string, message: string): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-q", "-m", message], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    return worktreePath;
  }

  test("apply publishes a pre-existing staged cleanup archive branch", async () => {
    const branch = "plan/staged-archive";
    const specName = "20261002T120001Z-staged-apply";
    const stagedBranch = "cleanup/archive-20261002T120001Z";
    inRepoSpec(specName, "[x] Done");
    const worktreePath = await materializeWorktree(branch, "spec");
    await stageSpecOnCleanupBranch(stagedBranch, specName);
    const store = {
      findRunByProjectBranch: () => null,
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath,
          specPath: join(worktreePath, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    const ghCalls: string[] = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (isCleanupArchiveBranchProbe(cmd, args)) return cleanupArchiveBranchProbeResponse(args);
        if (cmd === "git" && args[0] === "push") return "";
        if (cmd === "git" && args[0] === "ls-remote") return "";
        if (cmd === "gh" && args[0] === "pr") ghCalls.push(args.join(" "));
        if (cmd === "gh" && args[0] === "pr" && args[1] === "create") {
          return "https://github.com/example/test/pull/42";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          const jsonIndex = args.indexOf("--json");
          if (jsonIndex >= 0) {
            return JSON.stringify({
              number: 42,
              url: "https://github.com/example/test/pull/42",
              baseRefName: "main",
            });
          }
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          if (args.includes("--state") && args[args.indexOf("--state") + 1] === "all") {
            const headIndex = args.indexOf("--head");
            const branchName = headIndex >= 0 ? args[headIndex + 1] : undefined;
            if (branchName === branch) {
              const oid = (
                await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], cwd ?? projectRoot)
              ).trim();
              return JSON.stringify([
                { number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid },
              ]);
            }
            return "[]";
          }
          return "[]";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      runner,
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("https://github.com/example/test/pull/42");
    expect(ghCalls.filter((call) => call.startsWith("pr create"))).toHaveLength(1);
    expect(ghCalls.some((call) => call.includes(stagedBranch))).toBe(true);
  });

  test("apply reuses a sole open archive PR without a second create", async () => {
    const specName = "20261002T120002Z-reuse-pr";
    const branch = "implement/reuse-pr";
    inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    const ghCalls: string[] = [];
    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      archivePublicationRunner(projectRoot, ghCalls, { openPrNumber: 88 }),
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("https://github.com/example/test/pull/88");
    expect(ghCalls.some((call) => call.startsWith("pr create"))).toBe(false);
  });

  test("push failure keeps local archive commits and prints manual fallback", async () => {
    const specName = "20261002T120003Z-push-fail";
    const branch = "implement/push-fail";
    inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    let stdout = "";
    let stderr = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      archivePublicationRunner(projectRoot, [], { pushFails: true }),
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Archive publication failed at push:");
    expect(stdout).toMatch(
      /Archive branch for project: cleanup\/archive-\d{8}T\d{6}Z \(1 commit\(s\)\) at .* — push it and open one archive PR\./,
    );
    const archiveBranch = (
      await realAsyncSubprocessRunner.runAsync(
        "git",
        ["for-each-ref", "--format=%(refname:short)", "refs/heads/cleanup/archive-*"],
        projectRoot,
      )
    )
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    expect(archiveBranch).toBeDefined();
    const tree = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["ls-tree", "-r", "--name-only", archiveBranch!],
      projectRoot,
    );
    expect(tree).toContain(`v2/spec/completed/${specName}/index.md`);
  });

  test("push failure manual fallback uses session commit count when this run archived on the target branch", async () => {
    const specName = "20261002T130002Z-session-commit-count";
    const branch = "implement/session-commit-count";
    inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      archivePublicationRunner(projectRoot, [], { pushFails: true, revListCommitCount: 2 }),
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );
    expect(code).toBe(1);
    expect(stdout).toMatch(
      /Archive branch for project: cleanup\/archive-\d{8}T\d{6}Z \(1 commit\(s\)\) at .* — push it and open one archive PR\./,
    );
    expect(stdout).not.toMatch(/\(2 commit\(s\)\)/);
  });

  test("push failure manual fallback uses rev-list for staged branch when session has commits elsewhere", async () => {
    const freshSpecName = "20261002T130000Z-fresh-dual";
    const stagedSpecName = "20261002T130001Z-staged-dual";
    const stagedBranch = "cleanup/archive-20261002T130001Z";
    const branch = "implement/dual-fail";
    inRepoSpec(freshSpecName, "[x] Done");
    inRepoSpec(stagedSpecName, "[x] Done");
    await commitFixtures(projectRoot);
    const worktreePath = await stageSpecOnCleanupBranch(stagedBranch, stagedSpecName);
    writeFileSync(join(worktreePath, "extra-archive.txt"), "x\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "extra-archive.txt"], worktreePath);
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["commit", "-q", "-m", "second staged archive commit"],
      worktreePath,
    );
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", freshSpecName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    let stdout = "";
    let stderr = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      archivePublicationRunner(projectRoot, [], { pushFails: true }),
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Archive publication failed at push:");
    const escapedBranch = stagedBranch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(stdout).toMatch(
      new RegExp(
        `Archive branch for project: ${escapedBranch} \\(2 commit\\(s\\)\\) at ${worktreePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — push it and open one archive PR\\.`,
      ),
    );
  });

  test("stepless publication failure (foreign remote tip) reports push step", async () => {
    const specName = "20261002T120005Z-foreign-tip";
    const branch = "implement/foreign-tip";
    inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    let stdout = "";
    let stderr = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      archivePublicationRunner(projectRoot, [], { foreignRemoteTip: "f".repeat(40) }),
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Archive publication failed at push:");
    expect(stderr).not.toContain("failed at undefined");
    expect(stdout).toMatch(
      /Archive branch for project: cleanup\/archive-\d{8}T\d{6}Z \(1 commit\(s\)\) at .* — push it and open one archive PR\./,
    );
  });

  test("PR failure after push keeps commits and prints manual fallback", async () => {
    const specName = "20261002T120004Z-pr-fail";
    const branch = "implement/pr-fail";
    inRepoSpec(specName, "[x] Done");
    await commitFixtures(projectRoot);
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(projectRoot, "v2", "spec", specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
    let stdout = "";
    let stderr = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      archivePublicationRunner(projectRoot, [], { prCreateFails: true }),
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Archive publication failed at pr:");
    expect(stdout).toMatch(
      /Archive branch for project: cleanup\/archive-\d{8}T\d{6}Z \(1 commit\(s\)\) at .* — push it and open one archive PR\./,
    );
  });
});
