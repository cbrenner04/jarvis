import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { createArchivePublicationSession } from "./cleanup-archive-publication.ts";
import type { ArtifactSpec } from "./cleanup-artifacts.ts";
import { createArchivePublicationSessions, inspectStrandedArtifacts } from "./cleanup.ts";
import type { StateStore } from "../persistence/state-store.ts";

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
});
