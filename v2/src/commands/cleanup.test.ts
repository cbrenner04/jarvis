import { describe, expect, it } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { CleanupIo } from "./cleanup.ts";
import { cleanupCommand } from "./cleanup.ts";

function createTestIo(): { io: CleanupIo; getStdout: () => string; getStderr: () => string; responses: string[] } {
  let stdout = "";
  let stderr = "";
  let responseIndex = 0;
  const responses: string[] = [];

  return {
    getStdout: () => stdout,
    getStderr: () => stderr,
    responses: responses,
    io: {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
      readlineSync: (_prompt) => {
        const response = responses[responseIndex] ?? "n";
        responseIndex++;
        return response;
      },
    },
  };
}

describe("cleanupCommand", () => {
  it("returns 0 when no worktrees exist", async () => {
    const { io, getStdout } = createTestIo();
    const result = await cleanupCommand({
      io,
      dryRun: false,
      projectRegistry: {},
    });

    expect(result).toBe(0);
    expect(getStdout()).toContain("no merged worktrees to remove");
  });

  it("discovers merged v2 worktrees and previews in dry-run mode", async () => {
    const { io, responses } = createTestIo();
    responses.push("n");

    const result = await cleanupCommand({
      io,
      dryRun: true,
      projectRegistry: {
        testproj: { root: "/path/to/repo" },
      },
      isMergedPr: (branch) => branch === "merged-branch",
    });

    expect(result).toBe(0);
  });

  it("prompts for confirmation before removal", async () => {
    const { io, responses } = createTestIo();
    responses.push("n");

    const result = await cleanupCommand({
      io,
      dryRun: false,
      projectRegistry: {
        testproj: { root: "/path/to/repo" },
      },
      isMergedPr: () => false,
    });

    expect(result).toBe(0);
  });

  it("filters out non-merged PRs", async () => {
    const { io } = createTestIo();

    const result = await cleanupCommand({
      io,
      dryRun: true,
      projectRegistry: {
        testproj: { root: "/path/to/repo" },
      },
      isMergedPr: (branch) => branch === "merged-branch",
    });

    expect(result).toBe(0);
  });

  it("excludes worktrees referenced by non-terminal durable runs", async () => {
    const { io, getStdout } = createTestIo();

    const mockRuns: DaemonListRunRow[] = [
      {
        runId: "run1",
        project: "testproj",
        branch: "some-branch",
        status: "in-progress",
        isLive: false,
        worktreePath: "/path/to/worktree",
      },
    ];

    const result = await cleanupCommand({
      io,
      dryRun: true,
      projectRegistry: {
        testproj: { root: "/path/to/repo" },
      },
      isMergedPr: () => true,
      listRunsFromDaemon: async () => mockRuns,
    });

    expect(result).toBe(0);
    expect(getStdout()).toContain("no merged worktrees to remove");
  });

  it("excludes worktrees reported as live by daemon", async () => {
    const { io, getStdout } = createTestIo();

    const mockRuns: DaemonListRunRow[] = [
      {
        runId: "run1",
        project: "testproj",
        branch: "some-branch",
        status: "completed",
        isLive: true,
        worktreePath: "/path/to/worktree",
      },
    ];

    const result = await cleanupCommand({
      io,
      dryRun: true,
      projectRegistry: {
        testproj: { root: "/path/to/repo" },
      },
      isMergedPr: () => true,
      listRunsFromDaemon: async () => mockRuns,
    });

    expect(result).toBe(0);
    expect(getStdout()).toContain("no merged worktrees to remove");
  });

  it("cancels when user declines confirmation", async () => {
    const { io, responses } = createTestIo();
    responses.push("no");

    const result = await cleanupCommand({
      io,
      dryRun: false,
      projectRegistry: {},
      isMergedPr: () => false,
    });

    expect(result).toBe(0);
  });
});
