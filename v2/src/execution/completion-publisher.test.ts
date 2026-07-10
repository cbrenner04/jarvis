import { describe, expect, it } from "bun:test";
import { createCompletionPublisher, type CompletionPublisherInput } from "./completion-publisher.ts";

describe("createCompletionPublisher", () => {
  const baseInput: CompletionPublisherInput = {
    worktreePath: "/tmp/worktree",
    baseRef: "main",
    specPath: "v2/spec/test/index.md",
    branch: "feature-branch",
  };

  it("publishes push with new upstream and creates draft PR", () => {
    let gitCalls: string[] = [];
    let ghCalls: string[] = [];

    const mockGit = (cwd: string, args: readonly string[]) => {
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
      if (_args[0] === "auth" && _args[1] === "status") {
        return ""; // Authenticated
      }
      if (_args[0] === "pr" && _args[1] === "list") {
        return JSON.stringify([]); // No existing PRs
      }
      if (_args[0] === "pr" && _args[1] === "create") {
        return "https://github.com/user/repo/pull/42";
      }
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });
    const result = publisher(baseInput);

    expect(result.pushSha).toBe("abc123def456");
    expect(result.prNumber).toBe(42);
    expect(gitCalls.some((c) => c.includes("push -u origin feature-branch"))).toBe(true);
  });

  it("publishes push with existing upstream", () => {
    let gitCalls: string[] = [];

    const mockGit = (cwd: string, args: readonly string[]) => {
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
      if (_args[0] === "auth") return "";
      if (_args[0] === "pr" && _args[1] === "list") return JSON.stringify([]);
      if (_args[0] === "pr" && _args[1] === "create") return "https://github.com/user/repo/pull/42";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });
    publisher(baseInput);

    expect(gitCalls.some((c) => c === "push")).toBe(true);
    expect(gitCalls.some((c) => c.includes("-u"))).toBe(false);
  });

  it("reuses existing open PR with matching base", () => {
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
      if (args[0] === "auth") return "";
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 99, baseRefName: "main" }]);
      }
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });
    const result = publisher(baseInput);

    expect(result.prNumber).toBe(99);
  });

  it("ignores open PRs with different base", () => {
    let ghCalls: string[] = [];

    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "auth") return "";
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 88, baseRefName: "develop" }]); // Different base
      }
      if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/99";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });
    const result = publisher(baseInput);

    expect(result.prNumber).toBe(99);
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(true);
  });

  it("throws on non-fast-forward push rejection", () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        throw new Error("failed to push some refs to origin");
      }
      return "";
    };

    const mockGh = (_args: readonly string[]) => {
      if (_args[0] === "auth") return "";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });

    expect(() => publisher(baseInput)).toThrow("Non-fast-forward push rejection");
  });

  it("throws when gh auth status fails", () => {
    const mockGit = () => "";
    const mockGh = (args: readonly string[]) => {
      if (args[0] === "auth") throw new Error("not authenticated");
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });

    expect(() => publisher(baseInput)).toThrow("GitHub auth unavailable");
  });

  it("retries transient push errors up to 3 attempts", () => {
    let attempts = 0;

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
      if (args[0] === "auth") return "";
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") return "#42";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });
    const result = publisher(baseInput);

    expect(attempts).toBe(3);
    expect(result.pushSha).toBe("abc123def456");
  });

  it("throws after 3 failed push attempts", () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        throw new Error("Connection timeout");
      }
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      if (args[0] === "auth") return "";
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });

    expect(() => publisher(baseInput)).toThrow("Connection timeout");
  });

  it("parses draft PR creation output correctly", () => {
    const mockGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = (args: readonly string[]) => {
      if (args[0] === "auth") return "";
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/org/repo/pull/123\n"; // URL format
      }
      return "";
    };

    const publisher = createCompletionPublisher({ git: mockGit, gh: mockGh });
    const result = publisher(baseInput);

    expect(result.prNumber).toBe(123);
  });
});
