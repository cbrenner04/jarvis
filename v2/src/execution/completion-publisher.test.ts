import { describe, expect, it } from "bun:test";
import { type CompletionPublisherInput, createCompletionPublisher } from "./completion-publisher.ts";

describe("createCompletionPublisher", () => {
  const baseInput: CompletionPublisherInput = {
    worktreePath: "/tmp/worktree",
    baseRef: "main",
    specPath: "v2/spec/test/index.md",
    branch: "feature-branch",
  };

  const noopDelay = async () => {};
  const readyGh = () => true;

  it("publishes push with new upstream and creates draft PR", async () => {
    const gitCalls: string[] = [];
    const ghCalls: string[] = [];

    const mockGit = (_cwd: string, args: readonly string[]) => {
      gitCalls.push(args.join(" "));
      if (args.includes("push") && gitCalls.filter((c) => c.includes("push")).length === 1) {
        return ""; // Successful push
      }
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) {
        throw new Error("no tracking branch");
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "abc123def456";
      }
      return "";
    };

    const mockGh = (_args: readonly string[]) => {
      ghCalls.push(_args.join(" "));
      if (_args[0] === "pr" && _args[1] === "list") {
        return JSON.stringify([]); // No existing PRs
      }
      if (_args[0] === "pr" && _args[1] === "create") {
        return "https://github.com/user/repo/pull/42";
      }
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });
    const result = await publisher(baseInput);

    expect(result.pushSha).toBe("abc123def456");
    expect(result.prNumber).toBe(42);
    expect(gitCalls.some((c) => c.includes("push -u origin feature-branch"))).toBe(true);
  });

  it("publishes push with existing upstream", async () => {
    const gitCalls: string[] = [];

    const mockGit = (_cwd: string, args: readonly string[]) => {
      gitCalls.push(args.join(" "));
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) {
        return "upstream/feature-branch"; // Has upstream
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "abc123def456";
      }
      return "";
    };

    const mockGh = (_args: readonly string[]) => {
      if (_args[0] === "pr" && _args[1] === "list") return JSON.stringify([]);
      if (_args[0] === "pr" && _args[1] === "create") return "https://github.com/user/repo/pull/42";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });
    await publisher(baseInput);

    expect(gitCalls.some((c) => c === "push")).toBe(true);
    expect(gitCalls.some((c) => c.includes("-u"))).toBe(false);
  });

  it("reuses existing open PR with matching base", async () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) {
        throw new Error("no upstream");
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "abc123def456";
      }
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 99, baseRefName: "main" }]);
      }
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(99);
  });

  it("ignores open PRs with different base", async () => {
    const ghCalls: string[] = [];

    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 88, baseRefName: "develop" }]); // Different base
      }
      if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/99";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(99);
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(true);
  });

  it("throws on non-fast-forward push rejection", async () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        throw new Error("failed to push some refs to origin");
      }
      return "";
    };

    const mockGh = () => "";

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });

    await expect(publisher(baseInput)).rejects.toThrow("Non-fast-forward push rejection");
  });

  it("throws when gh readiness probe fails", async () => {
    const mockGit = () => "";
    const mockGh = () => "";
    const notReadyGh = () => false;

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      ghReady: notReadyGh,
      delay: noopDelay,
    });

    await expect(publisher(baseInput)).rejects.toThrow("GitHub auth unavailable");
  });

  it("retries transient push errors up to 3 attempts using the injected delay and retry-notice seams", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const notices: string[] = [];

    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Connection reset by peer");
        }
        return "";
      }
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") return "#42";
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      ghReady: readyGh,
      delay: async (ms) => {
        delays.push(ms);
      },
      retryNotice: (message) => {
        notices.push(message);
      },
    });
    const result = await publisher(baseInput);

    expect(attempts).toBe(3);
    expect(result.pushSha).toBe("abc123def456");
    expect(delays).toEqual([1000, 1000]);
    expect(notices).toEqual([
      "push: transient network error; retrying (attempt 2/3)",
      "push: transient network error; retrying (attempt 3/3)",
    ]);
  });

  it("throws after 3 failed push attempts", async () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        throw new Error("Connection timeout");
      }
      return "";
    };

    const mockGh = () => "";

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });

    await expect(publisher(baseInput)).rejects.toThrow("Connection timeout");
  });

  it("parses draft PR creation output correctly", async () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/org/repo/pull/123\n"; // URL format
      }
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh, ghReady: readyGh, delay: noopDelay });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(123);
  });
});
