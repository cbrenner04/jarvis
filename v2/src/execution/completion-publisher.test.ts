import { afterEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../shared/error-message.ts";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import {
  AmbiguousOpenPrError,
  bindHarnessReadyFlipEvidenceLookup,
  type CompletionPublisherInput,
  createCompletionPublisher,
  ForeignRemoteTipError,
  LeaseRejectedError,
  OpenPrNotDraftError,
  OpenPrUnavailableAfterHarnessUndoError,
  publishArchiveReady,
} from "./completion-publisher.ts";
import * as prBodyRefreshModule from "./pr-body-refresh.ts";
import { publicationFailureFor } from "./publication-retry.ts";

const realRefreshPrBody = prBodyRefreshModule.refreshPrBody;

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

  function ghListJsonFields(args: readonly string[]): string {
    const index = args.indexOf("--json");
    return index >= 0 ? String(args[index + 1] ?? "") : "";
  }

  const postPushTip = "abc123def456";
  const notAncestorMergeBase = new AsyncSubprocessError("not an ancestor", 1, "", "", undefined);

  const republicationGit = async (_cwd: string, args: readonly string[]) => {
    if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
    if (args[0] === "rev-parse" && args[1] === "HEAD") return postPushTip;
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      const oid = String(args[2]).replace(/\^\{commit\}$/, "");
      if (oid === "unreadable-head") throw new Error("bad object");
      return oid;
    }
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") return "";
    return "";
  };

  function lineageGit(options?: {
    foreignHead?: boolean;
    leaseBlocks?: { head: string; leaseFromSha: string };
  }): typeof republicationGit {
    return async (cwd, args) => {
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
        const ancestor = args[2];
        const descendant = args[3];
        if (options?.leaseBlocks !== undefined) {
          const { head, leaseFromSha } = options.leaseBlocks;
          if (ancestor === head && descendant === leaseFromSha) return "";
          if (ancestor === head && descendant === postPushTip) throw notAncestorMergeBase;
        }
        if (options?.foreignHead === true) throw notAncestorMergeBase;
      }
      return republicationGit(cwd, args);
    };
  }

  function ghOpenEmptyThenAllHistory(
    history: { number: number; state: string; headRefOid?: string; createPrNumber?: number } | "throw",
  ): {
    gh: (_cwd: string, args: readonly string[]) => Promise<string>;
    ghCalls: string[];
  } {
    const ghCalls: string[] = [];
    const gh = async (_cwd: string, args: readonly string[]) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "list") {
        const state = args[args.indexOf("--state") + 1];
        if (state === "open") return JSON.stringify([]);
        if (state === "all") {
          if (history === "throw") throw new Error("gh api unavailable");
          const fields = ghListJsonFields(args);
          const row: { number: number; baseRefName: string; state?: string; headRefOid?: string } = {
            number: history.number,
            baseRefName: "main",
          };
          if (fields.includes("state")) row.state = history.state;
          if (fields.includes("headRefOid") && history.headRefOid !== undefined) {
            row.headRefOid = history.headRefOid;
          }
          return JSON.stringify([row]);
        }
      }
      if (args[0] === "pr" && args[1] === "create") {
        if (history !== "throw" && history.createPrNumber !== undefined) {
          return `https://github.com/user/repo/pull/${history.createPrNumber}`;
        }
        throw new Error("unexpected pr create");
      }
      if (args[0] === "pr" && args[1] === "view" && history !== "throw") {
        const number = history.createPrNumber ?? history.number;
        return viewPr(number, `https://github.com/user/repo/pull/${number}`);
      }
      return "";
    };
    return { gh, ghCalls };
  }

  function republicationGhForPr(prNumber: number, options?: { afterUndo?: "draft" | "gone" | "closed" }) {
    const ghCalls: string[] = [];
    let isDraft = false;
    const gh = async (_cwd: string, args: readonly string[]) => {
      ghCalls.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "ready" && args[2] === "--undo") {
        if (options?.afterUndo === "closed") throw new Error("PR is closed");
        isDraft = true;
        if (options?.afterUndo === "gone") isDraft = false;
        return "";
      }
      if (args[0] === "pr" && args[1] === "list") {
        if (options?.afterUndo === "gone" && isDraft) return JSON.stringify([]);
        return JSON.stringify([{ number: prNumber, baseRefName: "main", isDraft }]);
      }
      if (args[0] === "pr" && args[1] === "view") {
        return viewPr(prNumber, `https://github.com/user/repo/pull/${prNumber}`);
      }
      return "";
    };
    return { gh, ghCalls };
  }

  afterEach(() => {
    mock.module("./pr-body-refresh.ts", () => ({ refreshPrBody: realRefreshPrBody }));
  });

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

  it("confirms a freshly created PR by the number gh printed, never by branch", async () => {
    const ghCalls: string[] = [];
    const publisher = createCompletionPublisher({
      subprocessRunner: originPresenceRunner(new Set(["main"])),
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
          if (args[2] !== "42") throw new Error(`confirmed by ${String(args[2])}, expected number 42`);
          return viewPr(42, "https://github.com/user/repo/pull/42");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(42);
    expect(ghCalls).toContain("pr view 42 --json number,url,baseRefName");
    expect(ghCalls.some((call) => call.startsWith(`pr view ${baseInput.branch}`))).toBe(false);
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
    expect(gitCalls.filter((call) => call.startsWith("push"))).toEqual(["push origin HEAD:refs/heads/feature-branch"]);
    expect(gitCalls.some((call) => call.includes("@{u}"))).toBe(false);
  });

  it("pushes HEAD to the target branch namespace despite a same-named remote tag", async () => {
    const gitCalls: string[][] = [];
    const remoteTagRef = `refs/tags/${baseInput.branch}`;
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        gitCalls.push([...args]);
        if (args[0] === "push" && args[2] !== `HEAD:refs/heads/${baseInput.branch}`) {
          throw new Error(`ambiguous destination: ${remoteTagRef}`);
        }
        if (args[0] === "rev-parse" && args[1] === `${baseInput.branch}@{u}`) {
          return "origin/differently-named-remote-ref";
        }
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
      ...noopRefreshSeams,
    });

    await publisher(baseInput);

    expect(gitCalls.filter(([command]) => command === "push")).toEqual([
      ["push", "origin", `HEAD:refs/heads/${baseInput.branch}`],
    ]);
    expect(gitCalls.some((args) => args.some((arg) => arg.includes("@{u}")))).toBe(false);
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

    expect(gitCalls.filter((call) => call.startsWith("push"))).toEqual(["push origin HEAD:refs/heads/feature-branch"]);
    expect(gitCalls.some((call) => call.includes("@{u}"))).toBe(false);
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

  it("reuses an open draft PR without changing its title", async () => {
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
          return JSON.stringify([{ number: 99, baseRefName: "main", isDraft: true, title: "draft title" }]);
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

  it("refuses to reuse a matching open PR that is not a draft", async () => {
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 99, baseRefName: "main", isDraft: false, title: "ready title" }]);
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow(
      "PR #99 for branch feature-branch is open but not a draft (expected draft). Mark it draft again, or close/merge it, before publishing.",
    );
  });

  it("re-drafts and reuses a harness-ready PR when lineage evidence matches", async () => {
    const prNumber = 55;
    const { gh, ghCalls } = republicationGhForPr(prNumber);
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher({
      ...baseInput,
      findHarnessReadyFlipEvidenceInLineage: (args) =>
        args.branch === baseInput.branch && args.baseRef === baseInput.baseRef && args.prNumber === prNumber,
    });
    expect(result.prNumber).toBe(prNumber);
    expect(ghCalls.some((call) => call === `pr ready --undo ${prNumber}`)).toBe(true);
    expect(ghCalls.some((call) => call.startsWith("pr create"))).toBe(false);
  });

  it("refuses a non-draft PR without lineage evidence and skips undo", async () => {
    const prNumber = 55;
    const { gh, ghCalls } = republicationGhForPr(prNumber);
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    await expect(
      publisher({
        ...baseInput,
        findHarnessReadyFlipEvidenceInLineage: () => false,
      }),
    ).rejects.toBeInstanceOf(OpenPrNotDraftError);
    expect(ghCalls.some((call) => call.includes("--undo"))).toBe(false);
  });

  it("refuses when lineage evidence names a different PR number", async () => {
    const prNumber = 55;
    const { gh, ghCalls } = republicationGhForPr(prNumber);
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    await expect(
      publisher({
        ...baseInput,
        findHarnessReadyFlipEvidenceInLineage: (args) => args.prNumber === prNumber + 1,
      }),
    ).rejects.toBeInstanceOf(OpenPrNotDraftError);
    expect(ghCalls.some((call) => call.includes("--undo"))).toBe(false);
  });

  it("refuses when lineage evidence branch or base ref mismatches publication", async () => {
    const prNumber = 55;
    const { gh, ghCalls } = republicationGhForPr(prNumber);
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    await expect(
      publisher({
        ...baseInput,
        findHarnessReadyFlipEvidenceInLineage: (args) =>
          args.branch === "other-branch" && args.baseRef === baseInput.baseRef && args.prNumber === prNumber,
      }),
    ).rejects.toBeInstanceOf(OpenPrNotDraftError);
    expect(ghCalls.some((call) => call.includes("--undo"))).toBe(false);
  });

  it("finds lineage evidence under the requested base when publication retargets effective base", async () => {
    const requestedBase = "plan/merged-first";
    const resolvedBase = "main";
    const prNumber = 55;
    let isDraft = false;
    const ghCalls: string[] = [];
    const publisher = createCompletionPublisher({
      subprocessRunner: originPresenceRunner(new Set(), resolvedBase),
      git: republicationGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "ready" && args[2] === "--undo") {
          isDraft = true;
          return "";
        }
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: prNumber, baseRefName: resolvedBase, isDraft }]);
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(prNumber, `https://github.com/user/repo/pull/${prNumber}`, resolvedBase);
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const result = await publisher({
      ...baseInput,
      baseRef: requestedBase,
      findHarnessReadyFlipEvidenceInLineage: (args) =>
        args.baseRef === requestedBase && args.branch === baseInput.branch && args.prNumber === prNumber,
    });
    expect(result.prNumber).toBe(prNumber);
    expect(ghCalls.some((call) => call === `pr ready --undo ${prNumber}`)).toBe(true);
  });

  it("fails when the PR is gone after a successful harness undo", async () => {
    const prNumber = 55;
    const { gh } = republicationGhForPr(prNumber, { afterUndo: "gone" });
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    await expect(
      publisher({
        ...baseInput,
        findHarnessReadyFlipEvidenceInLineage: (args) => args.prNumber === prNumber,
      }),
    ).rejects.toBeInstanceOf(OpenPrUnavailableAfterHarnessUndoError);
  });

  it("surfaces a permanent publication failure when harness undo fails", async () => {
    const prNumber = 55;
    const { gh } = republicationGhForPr(prNumber, { afterUndo: "closed" });
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });
    const error = await publisher({
      ...baseInput,
      findHarnessReadyFlipEvidenceInLineage: (args) => args.prNumber === prNumber,
    }).then(
      () => {
        throw new Error("expected undo failure");
      },
      (caught: unknown) => caught,
    );
    expect(publicationFailureFor(error)?.operation).toBe("gh pr ready --undo");
    expect((error as { prNumber?: number }).prNumber).toBe(prNumber);
  });

  it("refuses when the branch carries more than one open PR matching the same base", async () => {
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([
            { number: 12, baseRefName: "main", isDraft: true },
            { number: 34, baseRefName: "main", isDraft: true },
          ]);
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow("#12, #34");
  });

  it("surfaces a named error when gh pr create finds no publishable commits", async () => {
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") {
          throw new Error("GraphQL: No commits between main and feature-branch (createPullRequest)");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toThrow(
      "No publishable commits between feature-branch and main: nothing to open a PR from.",
    );
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
    const gitCalls: string[][] = [];

    const mockGit = async (_cwd: string, args: readonly string[]) => {
      gitCalls.push([...args]);
      if (args[0] === "push") {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Connection reset by peer");
        }
        return "";
      }
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
    expect(gitCalls.filter(([command]) => command === "push")).toEqual([
      ["push", "origin", `HEAD:refs/heads/${baseInput.branch}`],
      ["push", "origin", `HEAD:refs/heads/${baseInput.branch}`],
      ["push", "origin", `HEAD:refs/heads/${baseInput.branch}`],
    ]);
    expect(gitCalls.some((args) => args.some((arg) => arg.includes("@{u}")))).toBe(false);
    expect(delays).toEqual([1000, 1000]);
    expect(notices).toEqual([
      "push: Connection reset by peer; exit=unknown; retrying (attempt 2/3)",
      "push: Connection reset by peer; exit=unknown; retrying (attempt 3/3)",
    ]);
  });

  it("a gh pr create that timed out after applying is not duplicated on retry: the retry resolves the existing PR", async () => {
    let prCreated = false;
    const creates: string[][] = [];
    const mockGh = async (_cwd: string, args: readonly string[]) => {
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify(prCreated ? [{ number: 77, baseRefName: "main", isDraft: true }] : []);
      }
      if (args[0] === "pr" && args[1] === "create") {
        creates.push([...args]);
        prCreated = true; // applied server-side, but the client timed out
        throw new AsyncSubprocessError(
          "Command timed out after 180000ms: gh pr create",
          undefined,
          "",
          "",
          "ETIMEDOUT",
        );
      }
      if (args[0] === "pr" && args[1] === "view") return viewPr(77, "https://github.com/user/repo/pull/77");
      return "";
    };
    const subprocessRunner: AsyncSubprocessRunner = {
      async runAsync(_cmd, args) {
        return args[0] === "ls-remote" ? "abc\trefs/heads/main\n" : "";
      },
    };

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => (args[0] === "rev-parse" ? "abc123" : ""),
      gh: mockGh,
      delay: async () => {},
      retryNotice: () => {},
      subprocessRunner,
      ...noopRefreshSeams,
    });
    const result = await publisher(baseInput);

    expect(creates).toHaveLength(1);
    expect(result.prNumber).toBe(77);
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

  it("wires title fetch/write seams and input.creationTitle/input.specPath into refreshPrBody, editing when the resolved title differs", async () => {
    mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
    const externalRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "publisher-external-"));
    try {
      const specDir = join(externalRoot, "20260101T000000Z-external-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Live Heading\n");
      const externalSpecPath = join(specDir, "index.md");

      let fetchedTitleBranch = "";
      let writtenTitle = "";
      const publisher = createCompletionPublisher({
        git: async (_cwd, args) => {
          if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
          if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
          return "";
        },
        gh: async (_cwd, args) => {
          if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
          if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
          if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
          return "";
        },
        delay: noopDelay,
        fetchPrBody: async () => "",
        writePrBody: async () => {},
        fetchPrTitle: async (branch) => {
          fetchedTitleBranch = branch;
          return "Stale Title";
        },
        writePrTitle: async (_branch, title) => {
          writtenTitle = title;
        },
        renderFooter: async () => "",
      });

      await publisher({
        ...baseInput,
        specPath: externalSpecPath,
        creationTitle: undefined,
      });

      expect(fetchedTitleBranch).toBe(baseInput.branch);
      expect(writtenTitle).toBe("Live Heading");

      await publisher({
        ...baseInput,
        specPath: externalSpecPath,
        creationTitle: "Explicit Publisher Title",
      });

      expect(writtenTitle).toBe("Explicit Publisher Title");
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("forwards a defined input.signal through to refreshPrBody", async () => {
    let capturedSignal: AbortSignal | undefined;
    mock.module("./pr-body-refresh.ts", () => ({
      refreshPrBody: async (input: { signal?: AbortSignal }) => {
        capturedSignal = input.signal;
      },
    }));
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
    });
    const controller = new AbortController();

    await publisher({ ...baseInput, signal: controller.signal });

    expect(capturedSignal).toBe(controller.signal);
  });

  it("renders the PR-body Spec line as the spec dir name, not an absolute path, for an out-of-worktree external spec", async () => {
    const externalSpecPath = "/external/specs/20260916T203232Z-external-demo/index.md";
    let writtenBody = "";
    let createBody: string | undefined;
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") {
          createBody = args[args.indexOf("--body") + 1];
          return "https://github.com/user/repo/pull/42";
        }
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

    await publisher({ ...baseInput, specPath: externalSpecPath });

    expect(createBody).toBe("Spec: 20260916T203232Z-external-demo");
    expect(writtenBody).toBe("Spec: 20260916T203232Z-external-demo");
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

  it("reuses matching open draft over closed head+base history without probing all-state", async () => {
    const ghCalls: string[] = [];
    const openNumber = 101;
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          const state = args[args.indexOf("--state") + 1];
          if (state === "open") {
            return JSON.stringify([{ number: openNumber, baseRefName: "main", isDraft: true, title: "lane draft" }]);
          }
          if (state === "all") {
            throw new Error("all-state probe must not run when open draft matches");
          }
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(openNumber, `https://github.com/user/repo/pull/${openNumber}`);
        }
        if (args[0] === "pr" && args[1] === "create") {
          throw new Error("unexpected pr create");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(openNumber);
    expect(result.lanePrOutcome).toBeUndefined();
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
    expect(ghCalls.some((c) => c.includes("--state all"))).toBe(false);
  });

  it.each([
    { state: "CLOSED" as const, number: 88, kind: "lane_pr_closed" as const },
    { state: "MERGED" as const, number: 77, kind: "lane_pr_merged" as const },
  ])("returns $kind without create when newest head+base history is $state", async ({ state, number, kind }) => {
    let writeBodyCalls = 0;
    const inLineageHead = "lane-dead-head";
    const { gh, ghCalls } = ghOpenEmptyThenAllHistory({ number, state, headRefOid: inLineageHead });

    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
      writePrBody: async () => {
        writeBodyCalls += 1;
      },
    });

    const result = await publisher(baseInput);

    expect(result.lanePrOutcome).toEqual({ kind, prNumber: number });
    if (kind === "lane_pr_merged") {
      expect(result.prNumber).toBe(number);
      expect(result.prUrl).toBe(`https://github.com/user/repo/pull/${number}`);
    } else {
      expect(result.prNumber).toBeUndefined();
      expect(result.prUrl).toBeUndefined();
    }
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
    expect(
      ghCalls
        .find((c) => c.startsWith("pr list") && c.includes("--state all"))
        ?.includes("--json number,url,baseRefName,isDraft,state,headRefOid,mergedAt"),
    ).toBe(true);
    expect(writeBodyCalls).toBe(0);
  });

  it("requests the boundary's one field set (isDraft, state, headRefOid) on both the open and history probes", async () => {
    const { gh, ghCalls } = ghOpenEmptyThenAllHistory({ number: 88, state: "CLOSED" });
    const publisher = createCompletionPublisher({ git: republicationGit, gh, delay: noopDelay, ...noopRefreshSeams });

    await publisher(baseInput);

    const listJson = (state: string) =>
      ghCalls.find((c) => c.startsWith("pr list") && c.includes(`--state ${state}`))?.split("--json ")[1];
    expect(listJson("open")).toBe("number,url,baseRefName,isDraft,state,headRefOid,mergedAt");
    expect(listJson("all")).toBe("number,url,baseRefName,isDraft,state,headRefOid,mergedAt");
  });

  it.each([
    { state: "CLOSED" as const, number: 88, createPrNumber: 99, head: "foreign-closed-head" },
    { state: "MERGED" as const, number: 77, createPrNumber: 78, head: "foreign-merged-head" },
  ])("creates a draft when newest $state PR head is outside post-push tip lineage", async ({
    state,
    number,
    createPrNumber,
    head,
  }) => {
    const { gh, ghCalls } = ghOpenEmptyThenAllHistory({
      number,
      state,
      headRefOid: head,
      createPrNumber,
    });
    const publisher = createCompletionPublisher({
      git: lineageGit({ foreignHead: true }),
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(createPrNumber);
    expect(result.lanePrOutcome).toBeUndefined();
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(true);
  });

  it("returns lane_pr_closed when dead PR head is in leaseFromSha lineage but not post-push tip lineage", async () => {
    const head = "rebased-away-head";
    const leaseFromSha = "pre-rebase-tip";
    const { gh, ghCalls } = ghOpenEmptyThenAllHistory({ number: 88, state: "CLOSED", headRefOid: head });
    const publisher = createCompletionPublisher({
      git: lineageGit({ leaseBlocks: { head, leaseFromSha } }),
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher({ ...baseInput, leaseFromSha });

    expect(result.lanePrOutcome).toEqual({ kind: "lane_pr_closed", prNumber: 88 });
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
  });

  it.each([
    { state: "CLOSED" as const, kind: "lane_pr_closed" as const },
    { state: "MERGED" as const, kind: "lane_pr_merged" as const },
  ])("returns $kind when closed/merged head is unreadable in git", async ({ state, kind }) => {
    const { gh, ghCalls } = ghOpenEmptyThenAllHistory({
      number: 55,
      state,
      headRefOid: "unreadable-head",
    });

    const publisher = createCompletionPublisher({ git: republicationGit, gh, delay: noopDelay, ...noopRefreshSeams });

    const result = await publisher(baseInput);

    expect(result.lanePrOutcome).toEqual({ kind, prNumber: 55 });
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
  });

  it.each([
    { state: "CLOSED" as const, kind: "lane_pr_closed" as const, omitHeadRefOid: true as const },
    { state: "MERGED" as const, kind: "lane_pr_merged" as const, headRefOid: "" },
  ])("returns $kind when closed/merged headRefOid is missing or empty", async ({ state, kind, ...head }) => {
    const history =
      "omitHeadRefOid" in head && head.omitHeadRefOid === true
        ? { number: 44, state }
        : { number: 44, state, headRefOid: head.headRefOid };
    const { gh, ghCalls } = ghOpenEmptyThenAllHistory(history);

    const publisher = createCompletionPublisher({ git: republicationGit, gh, delay: noopDelay, ...noopRefreshSeams });

    const result = await publisher(baseInput);

    expect(result.lanePrOutcome).toEqual({ kind, prNumber: 44 });
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(false);
  });

  it("creates a fresh draft when allowLanePrRepublish is set despite closed history", async () => {
    const ghCalls: string[] = [];

    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list" && args.includes("open")) return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/99";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(99, "https://github.com/user/repo/pull/99");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher({ ...baseInput, allowLanePrRepublish: true });

    expect(result.prNumber).toBe(99);
    expect(result.lanePrOutcome).toBeUndefined();
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(true);
    expect(ghCalls.some((c) => c.includes("--state all"))).toBe(false);
  });

  it("creates a fresh draft when allowLanePrRepublish is set despite merged history", async () => {
    const ghCalls: string[] = [];
    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list" && args.includes("open")) return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/77";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(77, "https://github.com/user/repo/pull/77");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher({ ...baseInput, allowLanePrRepublish: true });

    expect(result.prNumber).toBe(77);
    expect(result.lanePrOutcome).toBeUndefined();
    expect(ghCalls.some((c) => c.includes("pr create"))).toBe(true);
    expect(ghCalls.some((c) => c.includes("--state all"))).toBe(false);
  });

  it("fails pr publication permanently when all-state history probe throws", async () => {
    const { gh } = ghOpenEmptyThenAllHistory("throw");

    const publisher = createCompletionPublisher({
      git: republicationGit,
      gh,
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const error = await publisher(baseInput).then(
      () => {
        throw new Error("expected publication failure");
      },
      (caught: unknown) => caught,
    );
    expect(publicationFailureFor(error)?.operation).toBe("pr");
    expect(errorMessage(error)).toContain("gh api unavailable");
  });

  it("awaits push, HEAD lookup, PR lookup/create/confirm, and body refresh in order", async () => {
    const events: string[] = [];

    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        const cmd = args.join(" ");
        if (cmd === "push origin HEAD:refs/heads/feature-branch") {
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
  it("refuses when two open PRs match the same branch and base, naming both", async () => {
    // The sibling test below uses two PRs on *different* bases, which filters to a single match and
    // never reaches the ambiguity guard. This one supplies two open PRs on the same base, which is
    // the only shape with no safe default to pick.
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([
            { number: 27, baseRefName: "main", isDraft: true },
            { number: 28, baseRefName: "main", isDraft: true },
          ]);
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    await expect(publisher(baseInput)).rejects.toBeInstanceOf(AmbiguousOpenPrError);
    await expect(publisher(baseInput)).rejects.toThrow(/#27, #28/);
    await expect(publisher(baseInput)).rejects.toThrow(/resolve to one before publishing/);
  });

  it("confirms a selected PR by number when the branch carries more than one open PR", async () => {
    // A branch can carry two open PRs to different bases at once. `pr list --state open` filtered
    // to our base selects #27; `pr view <branch>` honors no base filter and answers the other open
    // PR (#50), so confirming by branch compared two differently scoped lookups and would pick the
    // wrong PR. Confirming by number has no such disagreement to resolve.
    const ghCalls: string[][] = [];
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push([...args]);
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([
            { number: 27, baseRefName: "main", isDraft: true },
            { number: 50, baseRefName: "release", isDraft: true },
          ]);
        }
        if (args[0] === "pr" && args[1] === "view") {
          // Answering by branch yields the unrelated other-base PR; answering by number yields #27.
          return args[2] === "27"
            ? viewPr(27, "https://github.com/user/repo/pull/27")
            : viewPr(50, "https://github.com/user/repo/pull/50", "release");
        }
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(27);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/27");
    const viewCall = ghCalls.find((args) => args[0] === "pr" && args[1] === "view");
    expect(viewCall?.[2]).toBe("27");
  });

  it("confirms by branch when no existing PR was selected", async () => {
    const ghCalls: string[][] = [];
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "rev-parse" && args.includes(`${baseInput.branch}@{u}`)) throw new Error("no upstream");
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
        return "";
      },
      gh: async (_cwd, args) => {
        ghCalls.push([...args]);
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "#42";
        if (args[0] === "pr" && args[1] === "view") return viewPr(42, "https://github.com/user/repo/pull/42");
        return "";
      },
      delay: noopDelay,
      ...noopRefreshSeams,
    });

    const result = await publisher(baseInput);

    expect(result.prNumber).toBe(42);
    const viewCall = ghCalls.find((args) => args[0] === "pr" && args[1] === "view");
    expect(viewCall?.[2]).toBe(baseInput.branch);
  });
});

describe("createCompletionPublisher lease-forced push", () => {
  const branch = "feature-branch";
  const noopDelay = async () => {};
  const refreshSeams = {
    fetchPrBody: async () => "",
    writePrBody: async () => {},
    fetchPrTitle: async () => "t",
    writePrTitle: async () => {},
    renderFooter: async () => "",
  };
  const gh = async (_cwd: string, args: readonly string[]) => {
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 1, url: "u", baseRefName: "main" });
    return "";
  };
  const roots: string[] = [];
  const laneInput = (worktreePath: string, leaseFromSha?: string) => ({
    worktreePath,
    baseRef: "main",
    specPath: "v2/spec/x/index.md",
    branch,
    creationTitle: "t",
    ...(leaseFromSha !== undefined ? { leaseFromSha } : {}),
  });

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function runGit(cwd: string, args: readonly string[]): string {
    const result = spawnSync("git", [...args], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TEMPLATE_DIR: "",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
    if (result.status !== 0) throw Object.assign(new Error(result.stderr.trim()), { stderr: result.stderr });
    return result.stdout.trim();
  }

  function commit(cwd: string, file: string): string {
    writeFileSync(join(cwd, file), file);
    runGit(cwd, ["add", file]);
    runGit(cwd, ["commit", "-m", file]);
    return runGit(cwd, ["rev-parse", "HEAD"]);
  }

  /** Lane clone with `branch` already pushed at `laneTip`; `other` is a second clone of the same bare remote. */
  function fixture() {
    const root = trackedMkdtempSync(join(tmpdir(), "publisher-lease-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    runGit(root, ["init", "--bare", "-b", "main", remote]);
    const lane = join(root, "lane");
    const other = join(root, "other");
    runGit(root, ["clone", remote, lane]);
    commit(lane, "base");
    runGit(lane, ["push", "origin", "HEAD:main"]);
    runGit(lane, ["checkout", "-b", branch]);
    const laneTip = commit(lane, "lane-1");
    runGit(lane, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    runGit(root, ["clone", remote, other]);
    return { lane, other, laneTip, remote };
  }

  /** Rebases the lane onto an advanced main; returns the recorded pre-rebase lane tip. */
  function advanceMainAndRebase(f: ReturnType<typeof fixture>): string {
    const preRebaseSha = runGit(f.lane, ["rev-parse", "HEAD"]);
    commit(f.other, "main-2");
    runGit(f.other, ["push", "origin", "HEAD:main"]);
    runGit(f.lane, ["fetch", "origin"]);
    runGit(f.lane, ["rebase", "origin/main"]);
    return preRebaseSha;
  }

  function publisherFor(lane: string, leaseFromSha?: string, onPush?: () => void) {
    const pushes: string[][] = [];
    const publisher = createCompletionPublisher({
      git: async (cwd, args) => {
        if (args[0] === "push") {
          pushes.push([...args]);
          onPush?.();
        }
        return runGit(cwd, args);
      },
      gh,
      delay: noopDelay,
      ...refreshSeams,
    });
    const publish = () => publisher(laneInput(lane, leaseFromSha));
    return { publish, pushes };
  }

  it("publishes a rebased lane whose branch was already pushed with a lease on the observed tip", async () => {
    const f = fixture();
    const preRebaseSha = advanceMainAndRebase(f);
    const { publish, pushes } = publisherFor(f.lane, preRebaseSha);

    await publish();

    expect(pushes).toEqual([
      ["push", `--force-with-lease=refs/heads/${branch}:${f.laneTip}`, "origin", `HEAD:refs/heads/${branch}`],
    ]);
    expect(runGit(f.remote, ["rev-parse", `refs/heads/${branch}`])).toBe(runGit(f.lane, ["rev-parse", "HEAD"]));
  });

  it("leases when the remote tip is a strict ancestor of the recorded pre-rebase SHA after post-publish local commits", async () => {
    const f = fixture();
    commit(f.lane, "lane-2");
    const preRebaseSha = advanceMainAndRebase(f);
    const { publish, pushes } = publisherFor(f.lane, preRebaseSha);

    await publish();

    expect(pushes).toEqual([
      ["push", `--force-with-lease=refs/heads/${branch}:${f.laneTip}`, "origin", `HEAD:refs/heads/${branch}`],
    ]);
    expect(runGit(f.remote, ["rev-parse", `refs/heads/${branch}`])).toBe(runGit(f.lane, ["rev-parse", "HEAD"]));
  });

  it("pushes plainly when the remote tip is an ancestor of HEAD", async () => {
    const f = fixture();
    commit(f.lane, "lane-2");
    const { publish, pushes } = publisherFor(f.lane);

    await publish();

    expect(pushes).toEqual([["push", "origin", `HEAD:refs/heads/${branch}`]]);
    expect(runGit(f.remote, ["rev-parse", `refs/heads/${branch}`])).toBe(runGit(f.lane, ["rev-parse", "HEAD"]));
  });

  it("refuses a foreign remote tip that is neither the recorded pre-rebase SHA nor its ancestor, without pushing", async () => {
    const f = fixture();
    runGit(f.other, ["checkout", branch]);
    const foreign = commit(f.other, "foreign");
    runGit(f.other, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    runGit(f.other, ["checkout", "main"]);
    const preRebaseSha = advanceMainAndRebase(f);
    const { publish, pushes } = publisherFor(f.lane, preRebaseSha);

    const error = await publish().then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ForeignRemoteTipError);
    expect((error as Error).message).toContain(branch);
    expect((error as Error).message).toContain(foreign);
    expect(pushes).toEqual([]);
    expect(runGit(f.remote, ["rev-parse", `refs/heads/${branch}`])).toBe(foreign);
  });

  it("refuses a stale-ORIG_HEAD lane over a remote rewound to an older lane commit, without forcing", async () => {
    const f = fixture();
    const laneTwo = commit(f.lane, "lane-2");
    runGit(f.lane, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    // Foreign rewind of the branch to the lane's own older commit.
    runGit(f.other, ["fetch", "origin"]);
    runGit(f.other, ["push", "--force", "origin", `${f.laneTip}:refs/heads/${branch}`]);
    // An agent's reset leaves ORIG_HEAD at lane-2, whose ancestry covers the rewound tip; this run did not rebase.
    runGit(f.lane, ["reset", "--hard", "origin/main"]);
    commit(f.lane, "redo");
    expect(runGit(f.lane, ["rev-parse", "ORIG_HEAD"])).toBe(laneTwo);
    const { publish, pushes } = publisherFor(f.lane);

    const error = await publish().then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ForeignRemoteTipError);
    expect((error as Error).message).toContain(branch);
    expect((error as Error).message).toContain(f.laneTip);
    expect(pushes).toEqual([]);
    expect(runGit(f.remote, ["rev-parse", `refs/heads/${branch}`])).toBe(f.laneTip);
  });

  it("refuses a non-ancestor remote tip when no pre-rebase SHA is recorded", async () => {
    const pushes: string[][] = [];
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "push") pushes.push([...args]);
        if (args[0] === "ls-remote") return `cafe1234\trefs/heads/${branch}`;
        if (args[0] === "merge-base") throw new Error("fatal");
        return "";
      },
      gh,
      delay: noopDelay,
      ...refreshSeams,
    });

    await expect(publisher(laneInput("/w"))).rejects.toThrow(ForeignRemoteTipError);
    expect(pushes).toEqual([]);
  });

  it("fails permanently naming expected and actual SHAs when the remote moves between observation and push", async () => {
    const f = fixture();
    const preRebaseSha = advanceMainAndRebase(f);
    runGit(f.other, ["fetch", "origin"]);
    runGit(f.other, ["checkout", branch]);
    let raced = "";
    const { publish, pushes } = publisherFor(f.lane, preRebaseSha, () => {
      raced = commit(f.other, "raced");
      runGit(f.other, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    });

    const error = await publish().then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LeaseRejectedError);
    expect((error as Error).message).toContain(branch);
    expect((error as Error).message).toContain(`expected remote ${f.laneTip}`);
    expect((error as Error).message).toContain(`actual ${raced}`);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.includes("--force")).toBe(false);
    expect(runGit(f.remote, ["rev-parse", `refs/heads/${branch}`])).toBe(raced);
  });

  it("reports the actual SHA as unknown when the post-rejection re-resolve fails", async () => {
    let lsRemoteCalls = 0;
    const pushes: string[][] = [];
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "ls-remote") {
          lsRemoteCalls += 1;
          if (lsRemoteCalls > 1) throw new Error("network down");
          return `cafe1234\trefs/heads/${branch}`;
        }
        if (args[0] === "merge-base") {
          if (args[3] === "HEAD") throw new Error("not ancestor");
          return "";
        }
        if (args[0] === "push") {
          pushes.push([...args]);
          throw new Error("! [rejected] (stale info)\nerror: failed to push some refs");
        }
        return "";
      },
      gh,
      delay: noopDelay,
      ...refreshSeams,
    });

    const error = await publisher(laneInput("/w", "cafe1234")).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LeaseRejectedError);
    expect((error as Error).message).toContain("expected remote cafe1234");
    expect((error as Error).message).toContain("actual unknown");
    expect(pushes).toHaveLength(1);
  });

  it("surfaces the original error when a lease push fails for a reason other than a lost lease", async () => {
    const pushes: string[][] = [];
    const denied = new Error("remote: Permission denied\nfatal: unable to access origin");
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "ls-remote") return `cafe1234\trefs/heads/${branch}`;
        if (args[0] === "merge-base") {
          if (args[3] === "HEAD") throw new Error("not ancestor");
          return "";
        }
        if (args[0] === "push") {
          pushes.push([...args]);
          throw denied;
        }
        return "";
      },
      gh,
      delay: noopDelay,
      ...refreshSeams,
    });

    const error = await publisher(laneInput("/w", "cafe1234")).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBe(denied);
    expect(error).not.toBeInstanceOf(LeaseRejectedError);
    expect(pushes).toHaveLength(1);
  });

  it("surfaces the original error when a non-stale push failure is followed by a failed re-resolve", async () => {
    let lsRemoteCalls = 0;
    const denied = new Error("remote: Permission denied\nfatal: unable to access origin");
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "ls-remote") {
          lsRemoteCalls += 1;
          if (lsRemoteCalls > 1) throw new Error("network down");
          return `cafe1234\trefs/heads/${branch}`;
        }
        if (args[0] === "merge-base") {
          if (args[3] === "HEAD") throw new Error("not ancestor");
          return "";
        }
        if (args[0] === "push") throw denied;
        return "";
      },
      gh,
      delay: noopDelay,
      ...refreshSeams,
    });

    const error = await publisher(laneInput("/w", "cafe1234")).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBe(denied);
  });

  it("fails as a lease rejection when a non-stale push failure coincides with a moved remote tip", async () => {
    let lsRemoteCalls = 0;
    const denied = new Error("remote: Permission denied\nfatal: unable to access origin");
    const publisher = createCompletionPublisher({
      git: async (_cwd, args) => {
        if (args[0] === "ls-remote") {
          lsRemoteCalls += 1;
          return `${lsRemoteCalls > 1 ? "beef5678" : "cafe1234"}\trefs/heads/${branch}`;
        }
        if (args[0] === "merge-base") {
          if (args[3] === "HEAD") throw new Error("not ancestor");
          return "";
        }
        if (args[0] === "push") throw denied;
        return "";
      },
      gh,
      delay: noopDelay,
      ...refreshSeams,
    });

    const error = await publisher(laneInput("/w", "cafe1234")).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LeaseRejectedError);
    expect((error as Error).message).toContain("expected remote cafe1234");
    expect((error as Error).message).toContain("actual beef5678");
  });
});

describe("publishArchiveReady", () => {
  const archiveInput = {
    worktreePath: "/tmp/archive-worktree",
    branch: "cleanup/archive-20261002T120000Z",
    baseRef: "main",
    title: "Archive completed specs",
    body: "Moves completed spec dirs into completed/.",
  };
  const viewPr = (number: number, url: string, baseRefName = "main") => JSON.stringify({ number, url, baseRefName });
  const archivePushGit = async (_cwd: string, args: readonly string[]) =>
    args[0] === "rev-parse" && args[1] === "HEAD" ? "archive-push-sha" : "";

  it("creates a ready PR with caller title and body when no open PR exists", async () => {
    const ghCalls: string[] = [];
    const result = await publishArchiveReady(archiveInput, {
      git: archivePushGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/user/repo/pull/501";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(501, "https://github.com/user/repo/pull/501");
        }
        return "";
      },
    });

    expect(result.pushSha).toBe("archive-push-sha");
    expect(result.prNumber).toBe(501);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/501");
    const creates = ghCalls.filter((c) => c.startsWith("pr create"));
    expect(creates).toHaveLength(1);
    expect(creates[0]).not.toContain("--draft");
    expect(creates[0]).toContain(`--base ${archiveInput.baseRef}`);
    expect(creates[0]).toContain(archiveInput.title);
    expect(creates[0]).toContain(archiveInput.body);
    expect(ghCalls.some((c) => c.startsWith("pr view"))).toBe(true);
  });

  it("reuses a sole open ready PR without create", async () => {
    const ghCalls: string[] = [];
    const result = await publishArchiveReady(archiveInput, {
      git: archivePushGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 88, baseRefName: archiveInput.baseRef, isDraft: false }]);
        }
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(88, "https://github.com/user/repo/pull/88");
        }
        return "";
      },
    });

    expect(result.prNumber).toBe(88);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/88");
    expect(ghCalls.some((c) => c.startsWith("pr create"))).toBe(false);
    expect(ghCalls.filter((c) => c.startsWith("pr view"))).toHaveLength(1);
  });

  it("promotes a sole open PR when isDraft is omitted from the list probe", async () => {
    const ghCalls: string[] = [];
    const result = await publishArchiveReady(archiveInput, {
      git: archivePushGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 79, baseRefName: archiveInput.baseRef }]);
        }
        if (args[0] === "pr" && args[1] === "ready" && args[2] !== "--undo") return "";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(79, "https://github.com/user/repo/pull/79");
        }
        return "";
      },
    });

    expect(result.prNumber).toBe(79);
    expect(ghCalls.filter((c) => c === "pr ready 79")).toHaveLength(1);
    expect(ghCalls.some((c) => c.startsWith("pr create"))).toBe(false);
  });

  it("promotes a sole open draft with gh pr ready and reuses without create", async () => {
    const ghCalls: string[] = [];
    const result = await publishArchiveReady(archiveInput, {
      git: archivePushGit,
      gh: async (_cwd, args) => {
        ghCalls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 77, baseRefName: archiveInput.baseRef, isDraft: true }]);
        }
        if (args[0] === "pr" && args[1] === "ready" && args[2] !== "--undo") return "";
        if (args[0] === "pr" && args[1] === "view") {
          return viewPr(77, "https://github.com/user/repo/pull/77");
        }
        return "";
      },
    });

    expect(result.prNumber).toBe(77);
    expect(result.prUrl).toBe("https://github.com/user/repo/pull/77");
    expect(ghCalls.filter((c) => c === "pr ready 77")).toHaveLength(1);
    expect(ghCalls.some((c) => c.startsWith("pr create"))).toBe(false);
  });

  it("surfaces confirmPr failure after create without a second create", async () => {
    let createCount = 0;
    await expect(
      publishArchiveReady(archiveInput, {
        git: archivePushGit,
        gh: async (_cwd, args) => {
          if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
          if (args[0] === "pr" && args[1] === "create") {
            createCount += 1;
            return "https://github.com/user/repo/pull/502";
          }
          if (args[0] === "pr" && args[1] === "view") {
            throw new Error("no pull requests found for this branch");
          }
          return "";
        },
      }),
    ).rejects.toThrow("no pull requests found for this branch");
    expect(createCount).toBe(1);
  });
});

describe("bindHarnessReadyFlipEvidenceLookup", () => {
  it("returns undefined when the owning run row is missing", () => {
    const store = {
      loadRun: () => null,
      findNewestHarnessReadyFlipEvidenceInLineage: () => {
        throw new Error("should not be called");
      },
    } as unknown as StateStore;
    expect(bindHarnessReadyFlipEvidenceLookup(store, "missing")).toBeUndefined();
  });

  it("returns true only when the store finds lineage evidence", () => {
    let evidence: object | null = null;
    const store = {
      loadRun: () => ({ project: "p", specRef: "s" }),
      findNewestHarnessReadyFlipEvidenceInLineage: () => evidence,
    } as unknown as StateStore;
    const lookup = bindHarnessReadyFlipEvidenceLookup(store, "r");
    const args = { branch: "b", baseRef: "main", prNumber: 1 };
    expect(lookup?.(args)).toBe(false);
    evidence = { prNumber: 1 };
    expect(lookup?.(args)).toBe(true);
    evidence = null;
    expect(lookup?.(args)).toBe(false);
  });

  it("reads persisted lineage evidence for the run row project and specRef", () => {
    const stateDbPath = join(trackedMkdtempSync(join(tmpdir(), "completion-publisher-bind-")), "state.db");
    const store = openStateStore(stateDbPath);
    const branch = "feature-branch";
    const baseRef = "main";
    const prNumber = 42;
    const runId = store.createRun({
      project: "demo",
      specRef: baseRef,
      worktreePath: "/tmp/worktree",
      branch,
      specPath: "spec.md",
    });
    try {
      setSystemTime(new Date(10_000));
      store.recordHarnessReadyFlipEvidence({ runId, prNumber, branch, baseRef });
      const lookup = bindHarnessReadyFlipEvidenceLookup(store, runId);
      const args = { branch, baseRef, prNumber };
      expect(lookup?.(args)).toBe(true);
      expect(lookup?.({ ...args, prNumber: prNumber + 1 })).toBe(false);
    } finally {
      setSystemTime();
      store.close();
      removeOrchestrationStore(stateDbPath);
    }
  });
});
