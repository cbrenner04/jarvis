import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { cleanup } from "./cleanup.ts";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

function createTempWorktree(jarvisRoot: string, project: string, branch: string) {
  const worktreePath = join(jarvisRoot, "worktrees", project, branch);
  mkdirSync(worktreePath, { recursive: true });
  mkdirSync(join(worktreePath, ".git"), { recursive: true });
  writeFileSync(join(worktreePath, ".git", "HEAD"), `ref: refs/heads/${branch}`);
  return worktreePath;
}

function mockSubprocessRunner(responses: Record<string, string | null> = {}): AsyncSubprocessRunner {
  return {
    async runAsync(cmd: string, args: string[], _cwd: string): Promise<string> {
      const key = `${cmd} ${args.join(" ")}`;
      const response = responses[key];
      if (response === undefined) {
        throw new Error(`Unexpected command: ${key}`);
      }
      if (response === null) {
        throw new Error("subprocess error");
      }
      return response;
    },
  };
}

describe("cleanup command", () => {
  let jarvisRoot: string;
  let projectRegistry: Record<string, { root: string; origin?: string }>;
  let projectRoot: string;

  beforeEach(() => {
    jarvisRoot = mkdtempSync(join(tmpdir(), "jarvis-cleanup-test-"));
    projectRoot = mkdtempSync(join(tmpdir(), "jarvis-project-"));
    projectRegistry = {
      "test-project": { root: projectRoot, origin: "https://github.com/user/repo.git" },
    };
  });

  test("discovers merged worktrees and reports them in dry-run", async () => {
    createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("Discovered 1 worktree(s):");
    expect(output.stdout).toContain("test-project/feature-branch");
    expect(output.stdout).toContain("eligible");
  });

  test("reports non-merged PRs as ineligible", async () => {
    createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "OPEN" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("ineligible");
    expect(output.stdout).toContain("PR not merged");
  });

  test("reports worktrees with non-terminal runs as ineligible", async () => {
    const worktreePath = createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const daemonRuns: DaemonListRunRow[] = [
      {
        runId: "run-123",
        project: "test-project",
        branch: "feature-branch",
        status: "in-progress",
        isLive: false,
        worktreePath: worktreePath,
      },
    ];

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns,
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("ineligible");
    expect(output.stdout).toContain("Non-terminal durable run");
  });

  test("reports worktrees with live daemon runs as ineligible", async () => {
    const worktreePath = createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const daemonRuns: DaemonListRunRow[] = [
      {
        runId: "run-123",
        project: "test-project",
        branch: "feature-branch",
        status: "in-progress",
        isLive: true,
        worktreePath: worktreePath,
      },
    ];

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns,
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("ineligible");
    expect(output.stdout).toContain("Daemon reports run live");
  });

  test("reports PR inspection failure as ineligible (fail-closed)", async () => {
    createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": null, // simulate gh failure
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("ineligible");
    expect(output.stdout).toContain("PR state inspection unavailable");
  });

  test("removes eligible worktrees after confirmation", async () => {
    const worktreePath = createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const responses: Record<string, string | null> = {
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "MERGED" }]),
      "git worktree prune": "",
      "git branch -D feature-branch": "",
    };
    responses[`git worktree remove ${worktreePath}`] = "";

    const subprocess = mockSubprocessRunner(responses);

    let promptCalled = false;
    const result = await cleanup(io, {
      isDryRun: false,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
      prompt: async () => {
        promptCalled = true;
        return true;
      },
    });

    const output = read();
    expect(result).toBe(0);
    expect(promptCalled).toBe(true);
    expect(output.stdout).toContain("Retired");
  });

  test("cancels removal when user declines prompt", async () => {
    createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: false,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
      prompt: async () => false,
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("Cancelled");
  });

  test("exits with error code 1 on worktree removal failure", async () => {
    const worktreePath = createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const responses: Record<string, string | null> = {
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "MERGED" }]),
    };
    responses[`git worktree remove ${worktreePath}`] = null; // simulate failure

    const subprocess = mockSubprocessRunner(responses);

    const result = await cleanup(io, {
      isDryRun: false,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
      prompt: async () => true,
    });

    const output = read();
    expect(result).toBe(1);
    expect(output.stderr).toContain("Failed to remove");
  });

  test("handles nested branch paths (slash-separated)", async () => {
    createTempWorktree(jarvisRoot, "test-project", "feature/subfeature/branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature/subfeature/branch --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("feature/subfeature/branch");
  });

  test("handles multiple projects independently", async () => {
    const projectRegistry2 = {
      ...projectRegistry,
      "other-project": {
        root: mkdtempSync(join(tmpdir(), "jarvis-project-")),
        origin: "https://github.com/user/other.git",
      },
    };

    createTempWorktree(jarvisRoot, "test-project", "branch1");
    createTempWorktree(jarvisRoot, "other-project", "branch2");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head branch1 --json state": JSON.stringify([{ state: "MERGED" }]),
      "gh pr list --head branch2 --json state": JSON.stringify([{ state: "OPEN" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry2,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("test-project/branch1");
    expect(output.stdout).toContain("other-project/branch2");
    expect(output.stdout).toContain("eligible");
    expect(output.stdout).toContain("ineligible");
  });

  test("ignores empty directories under project worktree home", async () => {
    const worktreesHome = join(jarvisRoot, "worktrees", "test-project");
    mkdirSync(worktreesHome, { recursive: true });
    mkdirSync(join(worktreesHome, "empty-dir"), { recursive: true });
    createTempWorktree(jarvisRoot, "test-project", "real-branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head real-branch --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("Discovered 1 worktree(s):");
    expect(output.stdout).toContain("real-branch");
  });

  test("validates terminal vs non-terminal run statuses correctly", async () => {
    const worktreePath = createTempWorktree(jarvisRoot, "test-project", "branch1");
    const { io, read } = captureIo();

    const daemonRuns: DaemonListRunRow[] = [
      {
        runId: "completed-run",
        project: "test-project",
        branch: "branch1",
        status: "completed",
        isLive: false,
        worktreePath,
      },
      {
        runId: "blocked-run",
        project: "test-project",
        branch: "branch1",
        status: "blocked",
        isLive: false,
        worktreePath,
      },
      {
        runId: "failed-run",
        project: "test-project",
        branch: "branch1",
        status: "failed",
        isLive: false,
        worktreePath,
      },
    ];

    const subprocess = mockSubprocessRunner({
      "gh pr list --head branch1 --json state": JSON.stringify([{ state: "MERGED" }]),
    });

    const result = await cleanup(io, {
      isDryRun: true,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns,
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("eligible");
  });

  test("returns 0 when no worktrees are discovered", async () => {
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({});

    const result = await cleanup(io, {
      isDryRun: false,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("No merged worktrees to retire");
  });

  test("returns 0 when no eligible worktrees are found", async () => {
    createTempWorktree(jarvisRoot, "test-project", "feature-branch");
    const { io, read } = captureIo();

    const subprocess = mockSubprocessRunner({
      "gh pr list --head feature-branch --json state": JSON.stringify([{ state: "OPEN" }]),
    });

    const result = await cleanup(io, {
      isDryRun: false,
      jarvisRoot,
      readProjectRegistry: () => projectRegistry,
      subprocessRunner: subprocess,
      daemonRuns: [],
    });

    const output = read();
    expect(result).toBe(0);
    expect(output.stdout).toContain("No eligible worktrees to retire");
  });
});
