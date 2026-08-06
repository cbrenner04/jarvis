import { describe, expect, it } from "bun:test";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { type CompletionPublisherInput, createCompletionPublisher } from "./completion-publisher.ts";
import { publicationFailureFor } from "./publication-retry.ts";

describe("createCompletionPublisher", () => {
  const baseInput: CompletionPublisherInput = {
    worktreePath: "/tmp/worktree",
    baseRef: "main",
    specPath: "v2/spec/test/index.md",
    branch: "feature-branch",
    creationTitle: "Spec title",
  };

  const noopDelay = async () => {};
  const noopRefreshSeams = {
    fetchPrBody: async () => "",
    writePrBody: async () => {},
    renderFooter: async () => "",
  };
  const viewPr = (number: number, url: string, baseRefName = "main") => JSON.stringify({ number, url, baseRefName });

  function originPresenceRunner(presentRefs: ReadonlySet<string>, defaultBranch = "main"): AsyncSubprocessRunner {
    return {
      runAsync: async (command, args, _cwd) => {
        if (command === "git" && args[0] === "ls-remote" && args[1] === "--heads") {
          const branch = args[3];
          if (branch !== undefined && presentRefs.has(branch)) {
            return `deadbeef\trefs/heads/${branch}\n`;
          }
          return "";
        }
        if (command === "gh" && args.includes("defaultBranchRef")) {
          return defaultBranch;
        }
        throw new Error(`unexpected subprocess: ${command} ${args.join(" ")}`);
      },
    };
  }

  it("augments publication failure with retarget metadata when requested base ref is absent from remote", async () => {
    const requestedBase = "plan/merged-first";
    const resolvedBase = "main";
    const publisher = createCompletionPublisher({
      subprocessRunner: originPresenceRunner(new Set(), resolvedBase),
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        if (args[0] === "push") throw new Error("push failed after retarget");
        return "";
      },
      gh: async () => "",
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const error = await publisher({ ...baseInput, baseRef: requestedBase }).then(
      () => {
        throw new Error("expected publication failure");
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      message: "push failed after retarget",
      requestedBase,
      resolvedBase,
    });
  });

  it("retargets PR base to repository base when requested base ref is absent from remote", async () => {
    // @mutate v2/src/execution/completion-publisher.ts "if (!(await branchExistsOnOriginAsync" -> "if (false && !(await branchExistsOnOriginAsync"
    const requestedBase = "plan/merged-first";
    const resolvedBase = "main";
    const ghCalls: string[] = [];
    let refreshBase = "";

    const publisher = createCompletionPublisher({
      subprocessRunner: originPresenceRunner(new Set(), resolvedBase),
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(42, "https://github.com/user/repo/pull/42", resolvedBase);
        }
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "",
      writePrBody: async () => {},
      renderFooter: async ({ base }) => {
        refreshBase = base;
        return "";
      },
    });

    const result = await publisher({ ...baseInput, baseRef: requestedBase });

    expect(result.prNumber).toBe(42);
    expect(result.requestedBase).toBe(requestedBase);
    expect(result.resolvedBase).toBe(resolvedBase);
    const createCall = ghCalls.find((call) => call.startsWith("pr create"));
    expect(createCall).toContain(`--base ${resolvedBase}`);
    expect(createCall).not.toContain(`--base ${requestedBase}`);
    expect(refreshBase).toBe(resolvedBase);
  });

  it("preserves requested base when branch exists on origin", async () => {
    const requestedBase = "develop";
    const ghCalls: string[] = [];
    let refreshBase = "";

    const publisher = createCompletionPublisher({
      subprocessRunner: originPresenceRunner(new Set([requestedBase])),
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(42, "https://github.com/user/repo/pull/42", requestedBase);
        }
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "",
      writePrBody: async () => {},
      renderFooter: async ({ base }) => {
        refreshBase = base;
        return "";
      },
    });

    const result = await publisher({ ...baseInput, baseRef: requestedBase });

    expect(result.prNumber).toBe(42);
    expect(result.requestedBase).toBeUndefined();
    expect(result.resolvedBase).toBeUndefined();
    const createCall = ghCalls.find((call) => call.startsWith("pr create"));
    expect(createCall).toContain(`--base ${requestedBase}`);
    expect(refreshBase).toBe(requestedBase);
  });

  it("publishes push with new upstream and creates draft PR", async () => {
    const gitCalls: string[] = [];
    const ghCalls: string[] = [];

    const mockGit = async (_cwd: string, args: readonly string[]) => {
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

    const mockGh = async (_cwd: string, _args: readonly string[]) => {
      ghCalls.push(_args.join(" "));
      if (_args[0] === "pr" && _args[1] === "list") {
        return JSON.stringify([]); // No existing PRs
      }
      if (_args[0] === "pr" && _args[1] === "create") {
        return "https://github.com/user/repo/pull/42";
      }
      if (_args[0] === "pr" && _args[1] === "view") {
        return viewPr(42, "https://github.com/user/repo/pull/42");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(result.pushSha).toBe("abc123def456");
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/42");
    expect(gitCalls.some((c) => c.includes("push -u origin feature-branch"))).toBe(true);
  });

  it("threads a supplied narrative through refreshPrBody into the written PR body marker block", async () => {
    let writtenBody = "";
    const narrative = "Refactored the widget to simplify Z.\nVerify: all tests pass and the diff is clean.";
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "#42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "", // no existing narrative in the fetched body
      writePrBody: async (_branch: string, body: string) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    await publisher({ ...baseInput, narrative });

    expect(writtenBody).toContain("<!-- jarvis:narrative:start -->");
    expect(writtenBody).toContain("<!-- jarvis:narrative:end -->");
    expect(writtenBody).toContain("Refactored the widget to simplify Z.");
    // Distinct from the Spec: header — the narrative is a real block, not the header echoed back.
    expect(writtenBody).toContain("Verify: all tests pass");
  });

  it("uses the supplied title when creating a draft PR", async () => {
    let createArgs: readonly string[] | undefined;
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") {
          createArgs = args;
          return "#42";
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(42, "https://github.com/user/repo/pull/42");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await publisher({ ...baseInput, creationTitle: "  intent: add titles  " });

    expect(createArgs).toContain("intent: add titles");
  });

  it.each([
    undefined,
    null,
    42,
    {},
    "",
    " \t\n ",
  ])("rejects an unusable supplied subject when the index is unreadable", async (creationTitle) => {
    let createArgs: readonly string[] | undefined;
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") {
          createArgs = args;
          return "#42";
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(42, "https://github.com/user/repo/pull/42");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher({ ...baseInput, creationTitle })).rejects.toThrow("Title resolution");
    expect(createArgs).toBeUndefined();
  });

  it("runs all gh commands in the completed run worktree context", async () => {
    const ghCwds: string[] = [];

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (cwd, args) => {
        ghCwds.push(cwd);
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await publisher(baseInput);

    expect(ghCwds.every((cwd) => cwd === baseInput.worktreePath)).toBe(true);
    expect(ghCwds.length).toBeGreaterThan(0);
  });

  it("publishes push with existing upstream", async () => {
    const gitCalls: string[] = [];

    const mockGit = async (_cwd: string, args: readonly string[]) => {
      gitCalls.push(args.join(" "));
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) {
        return "upstream/feature-branch"; // Has upstream
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "abc123def456";
      }
      return "";
    };

    const mockGh = async (_cwd: string, _args: readonly string[]) => {
      if (_args[0] === "pr" && _args[1] === "list") return JSON.stringify([]);
      if (_args[0] === "pr" && _args[1] === "create") return "https://github.com/user/repo/pull/42";
      if (_args[0] === "pr" && _args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    await publisher(baseInput);

    expect(gitCalls.some((c) => c === "push")).toBe(true);
    expect(gitCalls.some((c) => c.includes("-u"))).toBe(false);
  });

  it("reuses existing open PR with matching base", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) {
        throw new Error("no upstream");
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "abc123def456";
      }
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 99, baseRefName: "main" }]);
      }
      if (args[0] === "pr" && args[1] === "view") {
        return viewPr(99, "https://github.com/user/repo/pull/99");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(99);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/99");
  });

  it.each([
    [true, "draft title"],
    [false, "ready title"],
  ])("reuses an open PR without changing its title", async (isDraft, title) => {
    const ghCalls: string[] = [];
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 99, baseRefName: "main", isDraft, title }]);
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(99, "https://github.com/user/repo/pull/99");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await publisher({ ...baseInput, creationTitle: "replacement title" });

    expect(ghCalls.some((call) => call.startsWith("pr create") || call.startsWith("pr edit"))).toBe(false);
  });

  it("ignores open PRs with different base", async () => {
    const ghCalls: string[] = [];

    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([{ number: 88, baseRefName: "develop" }]); // Different base
      }
      if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/99";
      if (args[0] === "pr" && args[1] === "view") return viewPr(99, "https://github.com/user/repo/pull/99");
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(99);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/99");
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(true);
  });

  it("throws on non-fast-forward push rejection", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        throw new Error("failed to push some refs to origin");
      }
      return "";
    };

    const mockGh = async () => "";

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow("failed to push some refs");
  });

  it("normalizes push failure evidence on a rejected push", async () => {
    const failure = Object.assign(new Error("remote rejected push"), {
      code: 7,
      stdout: "push stdout",
      stderr: "push stderr",
    });

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "push") throw failure;
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        return "";
      },
      gh: async () => "",
      delay: noopDelay,
    });

    const error = await publisher(baseInput).then(
      () => {
        throw new Error("expected push failure");
      },
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ message: "remote rejected push" });
    expect(publicationFailureFor(error)).toEqual({
      operation: "push",
      message: "remote rejected push",
      exitCode: 7,
      stdoutTail: "push stdout",
      stderrTail: "push stderr",
    });
  });

  it("normalizes PR command failure evidence at the publication retry boundary", async () => {
    const failure = Object.assign(new Error("PR creation rejected"), {
      status: 22,
      stdout: "pr stdout",
      stderr: "pr stderr",
    });
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) return "origin/feature-branch";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") throw failure;
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const error = await publisher(baseInput).then(
      () => {
        throw new Error("expected PR failure");
      },
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ message: "PR creation rejected" });
    expect(publicationFailureFor(error)).toEqual({
      operation: "pr",
      message: "PR creation rejected",
      exitCode: 22,
      stdoutTail: "pr stdout",
      stderrTail: "pr stderr",
    });
  });

  it("retries transient push errors up to 3 attempts using the injected delay and retry-notice seams", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const notices: string[] = [];

    const mockGit = async (_cwd: string, args: readonly string[]) => {
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

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") return "#42";
      if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: async (ms) => {
        delays.push(ms);
      },
      retryNotice: (message) => {
        notices.push(message);
      },
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(attempts).toBe(3);
    expect(result.pushSha).toBe("abc123def456");
    expect(delays).toEqual([1000, 1000]);
    expect(notices).toEqual([
      "push: Connection reset by peer; exit=unknown; retrying (attempt 2/3)",
      "push: Connection reset by peer; exit=unknown; retrying (attempt 3/3)",
    ]);
  });

  it("throws after 3 failed push attempts", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "push") {
        throw new Error("Connection timeout");
      }
      return "";
    };

    const mockGh = async () => "";

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow("Connection timeout");
  });

  it("parses draft PR creation output correctly", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/org/repo/pull/123\n"; // URL format
      }
      if (args[0] === "pr" && args[1] === "view") {
        return viewPr(123, "https://github.com/org/repo/pull/123");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(123);
    expect(result.prUrl).toBe("https://github.com/org/repo/pull/123");
  });

  it("confirms PR number after creation when owner slug contains digits", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        // Pre-fix would extract "4" from cbrenner04 in this URL
        return "https://github.com/cbrenner04/jarvis/pull/42";
      }
      if (args[0] === "pr" && args[1] === "view") {
        // Confirmation returns the correct PR number
        return viewPr(42, "https://github.com/cbrenner04/jarvis/pull/42");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe("https://github.com/cbrenner04/jarvis/pull/42");
  });

  it("fails publication when confirmation finds no open PR for the branch", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/org/repo/pull/123";
      }
      if (args[0] === "pr" && args[1] === "view") {
        throw new Error("no pull requests found for this branch");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow("no pull requests found for this branch");
  });

  it("fails publication when confirmed PR has a different base than requested", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/org/repo/pull/123";
      }
      if (args[0] === "pr" && args[1] === "view") {
        return viewPr(123, "https://github.com/org/repo/pull/123", "develop");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow("PR base develop does not match requested base main");
  });

  it("makes one confirmation attempt (no transient retry) when PR is not found", async () => {
    let confirmAttempts = 0;
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/org/repo/pull/123";
      }
      if (args[0] === "pr" && args[1] === "view") {
        confirmAttempts += 1;
        throw new Error("no pull requests found for this branch");
      }
      return "";
    };

    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: mockGh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow("no pull requests found for this branch");
    expect(confirmAttempts).toBe(1);
  });

  it("refreshes ensured PR body with attribution footer via injected seams", async () => {
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    let writtenBody = "";
    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => `Spec: ${baseInput.specPath}`,
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () =>
        "- abc123 jarvis: complete run \u2014 Claude Opus 4.8\n\nWritten by Claude Opus 4.8 through Jarvis.",
    });

    await publisher(baseInput);

    expect(writtenBody).toContain(`Spec: ${baseInput.specPath}`);
    expect(writtenBody).toContain("Written by Claude Opus 4.8 through Jarvis.");
    expect(writtenBody).toContain("---");
  });

  it("passes bodySummary through to PR body refresh", async () => {
    const summary = "## Summary\n\nWhat landed.";
    const mockGit = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    };

    let writtenBody = "";
    const publisher = createCompletionPublisher({
      git: mockGit,
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "",
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    await publisher({ ...baseInput, bodySummary: summary });

    expect(writtenBody).toBe(`Spec: ${baseInput.specPath}\n\n${summary}`);
  });

  it("reuses existing PR and refreshes its body without creating a second PR", async () => {
    const ghCalls: string[] = [];
    let writtenBody = "";

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 99, baseRefName: "main" }]);
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(99, "https://github.com/user/repo/pull/99");
        }
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "Spec: stale",
      writePrBody: async (_branch, body) => {
        writtenBody = body;
      },
      renderFooter: async () => "",
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(99);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/99");
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
    expect(writtenBody).toBe(`Spec: ${baseInput.specPath}`);
  });

  it("retries transient pr-body-refresh errors up to 3 attempts", async () => {
    let refreshAttempts = 0;
    const delays: number[] = [];
    const notices: string[] = [];

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "#42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: async (ms) => {
        delays.push(ms);
      },
      retryNotice: (message) => {
        notices.push(message);
      },
      fetchPrBody: async () => "",
      writePrBody: async () => {
        refreshAttempts += 1;
        if (refreshAttempts < 3) {
          throw new Error("Connection reset by peer");
        }
      },
      renderFooter: async () => "",
    });

    await publisher(baseInput);

    expect(refreshAttempts).toBe(3);
    expect(delays).toEqual([1000, 1000]);
    expect(notices).toEqual([
      "pr-body-refresh: Connection reset by peer; exit=unknown; retrying (attempt 2/3)",
      "pr-body-refresh: Connection reset by peer; exit=unknown; retrying (attempt 3/3)",
    ]);
  });

  it("throws after 3 failed pr-body-refresh attempts", async () => {
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "#42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "",
      writePrBody: async () => {
        throw new Error("gh pr edit failed");
      },
      renderFooter: async () => "",
    });

    await expect(publisher(baseInput)).rejects.toThrow("gh pr edit failed");
  });

  it("returns a merged PR without creating a second PR when the branch already has a merged PR", async () => {
    const ghCalls: string[] = [];

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          if (args.includes("--state") && args.includes("open")) {
            return JSON.stringify([]); // No open PRs
          }
          if (args.includes("--state") && args.includes("merged")) {
            return JSON.stringify([{ number: 88, baseRefName: "main" }]); // Merged PR found
          }
          return JSON.stringify([]);
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(88, "https://github.com/user/repo/pull/88");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(88);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/88");
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
  });

  it("awaits upstream detection, push, HEAD lookup, PR lookup/create/confirm, and body refresh in order", async () => {
    const events: string[] = [];

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        const cmd = args.join(" ");
        if (cmd.includes("@{u}")) {
          events.push("upstream");
          throw new Error("no upstream");
        }
        if (cmd === "push -u origin feature-branch") {
          events.push("push");
        }
        if (cmd === "rev-parse HEAD") {
          events.push("head");
          return "abc123def456";
        }
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          events.push("pr-lookup");
          return JSON.stringify([]);
        }
        if (args[0] === "pr" && args[1] === "create") {
          events.push("pr-create");
          return "#42";
        }
        if (args[0] === "pr" && args[1] === "view") {
          events.push("pr-confirm");
          return viewPr(42, "https://github.com/user/repo/pull/42");
        }
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => {
        events.push("fetch-body");
        return "";
      },
      writePrBody: async () => {
        events.push("write-body");
      },
      renderFooter: async () => "",
    });

    await publisher(baseInput);

    expect(events).toEqual([
      "upstream",
      "push",
      "head",
      "pr-lookup",
      "pr-lookup",
      "pr-create",
      "pr-confirm",
      "fetch-body",
      "write-body",
    ]);
  });

  it("fails refresh when attribution git read is rejected", async () => {
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        if (args[0] === "log") throw new Error("git log failed");
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "#42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      fetchPrBody: async () => "",
      writePrBody: async () => {},
    });

    await expect(publisher(baseInput)).rejects.toThrow("git log failed");
  });
});
