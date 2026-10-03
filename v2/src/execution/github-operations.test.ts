import { describe, expect, test } from "bun:test";
import {
  AsyncSubprocessError,
  type AsyncSubprocessOptions,
  type AsyncSubprocessRunner,
  NETWORK_SUBPROCESS_TIMEOUT_MS,
} from "../../../shared/subprocess.ts";
import {
  checkAuthStatus,
  closePr,
  commentPr,
  createPr,
  type GitHubFailureReason,
  type GitHubOperation,
  GitHubOperationError,
  ghCommandRunner,
  graphql,
  isRetryableGitHubError,
  listPrs,
  markPrReady,
  mergePr,
  repoIdentity,
  undoPrReady,
  viewPr,
  viewPrReviewActivity,
  viewPrState,
} from "./github-operations.ts";

type Call = { args: string[]; cwd: string; options: AsyncSubprocessOptions | undefined };

/** Canned runner keyed by the full argv; rejects on an unexpected command so a stray gh call is a test failure. */
function fakeGh(results: Record<string, string | Error>): AsyncSubprocessRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async runAsync(cmd, args, cwd, options) {
      calls.push({ args: [cmd, ...args], cwd, options });
      const result = results[[cmd, ...args].join(" ")];
      if (result === undefined) throw new Error(`fakeGh: no canned result for "${[cmd, ...args].join(" ")}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function ghFailure(stderr: string, status = 1, stdout = ""): AsyncSubprocessError {
  return new AsyncSubprocessError("Command failed: gh", status, stdout, stderr, undefined);
}

async function rejection(promise: Promise<unknown>): Promise<GitHubOperationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitHubOperationError) return error;
    throw new Error(`expected GitHubOperationError, got ${String(error)}`);
  }
  throw new Error("expected rejection");
}

function expectFailure(
  error: GitHubOperationError,
  operation: GitHubOperation,
  reason: GitHubFailureReason,
  retryable: boolean,
) {
  expect(error.name).toBe("GitHubOperationError");
  expect(error.operation).toBe(operation);
  expect(error.reason).toBe(reason);
  expect(error.retryable).toBe(retryable);
  expect(isRetryableGitHubError(error)).toBe(retryable);
}

const LIST_OPEN = "gh pr list --head feat --state open --json number,url,baseRefName,isDraft,state,headRefOid";
const LIST_ALL = "gh pr list --head feat --state all --json number,url,baseRefName,isDraft,state,headRefOid";

describe("listPrs", () => {
  test("pins the command, uses network-bounded options, and parses rows", async () => {
    const runner = fakeGh({
      [LIST_OPEN]: JSON.stringify([
        { number: 7, url: "https://x/pull/7", baseRefName: "main", isDraft: true, state: "OPEN", headRefOid: "abc" },
      ]),
    });
    const controller = new AbortController();
    const rows = await listPrs(runner, "/repo", { branch: "feat", state: "open" }, { signal: controller.signal });
    expect(rows).toEqual([
      { number: 7, url: "https://x/pull/7", baseRefName: "main", isDraft: true, state: "OPEN", headRefOid: "abc" },
    ]);
    expect(runner.calls[0]?.cwd).toBe("/repo");
    expect(runner.calls[0]?.options?.timeoutMs).toBe(NETWORK_SUBPROCESS_TIMEOUT_MS);
    expect(runner.calls[0]?.options?.signal).toBe(controller.signal);
    expect(runner.calls[0]?.options?.env?.GIT_TERMINAL_PROMPT).toBe("0");
  });

  test("includes closed and merged history under state all and omits null optionals", async () => {
    const runner = fakeGh({
      [LIST_ALL]: JSON.stringify([
        { number: 9, baseRefName: "main", state: "MERGED", headRefOid: null, url: null, isDraft: null },
        { number: 8, baseRefName: "main", state: "WEIRD" },
      ]),
    });
    expect(await listPrs(runner, "/repo", { branch: "feat", state: "all" })).toEqual([
      { number: 9, baseRefName: "main", state: "MERGED" },
      { number: 8, baseRefName: "main" },
    ]);
  });

  test("rejects a row without number/baseRefName and non-array output as failed", async () => {
    const bad = fakeGh({ [LIST_OPEN]: JSON.stringify([{ url: "x" }]) });
    expectFailure(
      await rejection(listPrs(bad, "/repo", { branch: "feat", state: "open" })),
      "pr-list",
      "failed",
      false,
    );
    const scalar = fakeGh({ [LIST_OPEN]: JSON.stringify({ number: 1 }) });
    const error = await rejection(listPrs(scalar, "/repo", { branch: "feat", state: "open" }));
    expect(error.message).toContain("non-array");
    const nonJson = fakeGh({ [LIST_OPEN]: "<html>" });
    expect((await rejection(listPrs(nonJson, "/repo", { branch: "feat", state: "open" }))).message).toContain(
      "non-JSON",
    );
  });
});

describe("viewPr", () => {
  test("addresses by number or branch and returns the identity triple", async () => {
    const payload = JSON.stringify({ number: 7, url: "https://x/pull/7", baseRefName: "main" });
    const runner = fakeGh({
      "gh pr view 7 --json number,url,baseRefName": payload,
      "gh pr view feat --json number,url,baseRefName": payload,
    });
    expect(await viewPr(runner, "/repo", 7)).toEqual({ number: 7, url: "https://x/pull/7", baseRefName: "main" });
    expect(await viewPr(runner, "/repo", "feat")).toEqual({ number: 7, url: "https://x/pull/7", baseRefName: "main" });
  });

  test("rejects an incomplete record as failed", async () => {
    const runner = fakeGh({ "gh pr view 7 --json number,url,baseRefName": JSON.stringify({ number: 7 }) });
    expectFailure(await rejection(viewPr(runner, "/repo", 7)), "pr-view", "failed", false);
  });
});

describe("viewPrState", () => {
  test("reports merged with its timestamp, open and closed without", async () => {
    const runner = fakeGh({
      "gh pr view 1 --json state,mergedAt": JSON.stringify({ state: "MERGED", mergedAt: "2024-01-01T00:00:00Z" }),
      "gh pr view 2 --json state,mergedAt": JSON.stringify({ state: "OPEN", mergedAt: null }),
      "gh pr view 3 --json state,mergedAt": JSON.stringify({ state: "CLOSED", mergedAt: null }),
    });
    expect(await viewPrState(runner, "/repo", 1)).toEqual({
      state: "MERGED",
      merged: true,
      mergedAt: "2024-01-01T00:00:00Z",
    });
    expect(await viewPrState(runner, "/repo", 2)).toEqual({ state: "OPEN", merged: false, mergedAt: null });
    expect(await viewPrState(runner, "/repo", 3)).toEqual({ state: "CLOSED", merged: false, mergedAt: null });
  });

  test("rejects an unknown state as failed, naming the PR", async () => {
    const runner = fakeGh({ "gh pr view 7 --json state,mergedAt": JSON.stringify({ state: 1 }) });
    const error = await rejection(viewPrState(runner, "/repo", 7));
    expectFailure(error, "pr-view", "failed", false);
    expect(error.message).toContain("unexpected gh pr view state for #7");
  });
});

describe("viewPrReviewActivity", () => {
  test("returns the reviews/comments envelope and rejects a non-object", async () => {
    const payload = { reviews: [{ id: 1, submittedAt: "t", state: "APPROVED" }], comments: [] };
    const runner = fakeGh({
      "gh pr view 7 --json reviews,comments": JSON.stringify(payload),
      "gh pr view 8 --json reviews,comments": "[]",
    });
    expect(await viewPrReviewActivity(runner, "/repo", 7)).toEqual(payload);
    expectFailure(await rejection(viewPrReviewActivity(runner, "/repo", 8)), "pr-view", "failed", false);
  });
});

describe("createPr", () => {
  test("builds a draft create and parses the printed URL", async () => {
    const runner = fakeGh({ "gh pr create --draft --base main --title T --body B": "https://x/pull/7\n" });
    expect(await createPr(runner, "/repo", { base: "main", title: "T", body: "B", draft: true })).toEqual({
      url: "https://x/pull/7",
    });
  });

  test("omits --draft for a ready PR and reports no URL when gh prints none", async () => {
    const runner = fakeGh({ "gh pr create --base main --title T --body B": "#7" });
    expect(await createPr(runner, "/repo", { base: "main", title: "T", body: "B", draft: false })).toEqual({
      url: undefined,
    });
    expect(runner.calls[0]?.args).not.toContain("--draft");
  });

  test("classifies nothing-to-publish as no-commits", async () => {
    const runner = fakeGh({
      "gh pr create --draft --base main --title T --body B": ghFailure(
        "GraphQL: No commits between main and feat (createPullRequest)",
      ),
    });
    expectFailure(
      await rejection(createPr(runner, "/repo", { base: "main", title: "T", body: "B", draft: true })),
      "pr-create",
      "no-commits",
      false,
    );
  });
});

describe("mutations", () => {
  test("markPrReady, undoPrReady, mergePr, commentPr pin their commands", async () => {
    const runner = fakeGh({
      "gh pr ready 7": "",
      "gh pr ready feat": "",
      "gh pr ready --undo 7": "",
      "gh pr merge feat": "",
      "gh pr comment 7 --body hi": "",
    });
    await markPrReady(runner, "/repo", 7);
    await markPrReady(runner, "/repo", "feat");
    await undoPrReady(runner, "/repo", 7);
    await mergePr(runner, "/repo", "feat");
    await commentPr(runner, "/repo", 7, "hi");
    expect(runner.calls.map((call) => call.args.join(" "))).toEqual([
      "gh pr ready 7",
      "gh pr ready feat",
      "gh pr ready --undo 7",
      "gh pr merge feat",
      "gh pr comment 7 --body hi",
    ]);
    expect(runner.calls.every((call) => call.cwd === "/repo")).toBe(true);
  });

  test("closePr is idempotent on an already-closed PR and surfaces other failures", async () => {
    const runner = fakeGh({
      "gh pr close 7": "",
      "gh pr close 8": ghFailure("X Pull request #8 (t) is already closed"),
      "gh pr close 9": ghFailure("HTTP 502: Bad gateway"),
    });
    expect(await closePr(runner, "/repo", 7)).toEqual({ status: "closed" });
    expect(await closePr(runner, "/repo", 8)).toEqual({ status: "already-closed" });
    expectFailure(await rejection(closePr(runner, "/repo", 9)), "pr-close", "service", true);
  });
});

describe("repoIdentity and graphql", () => {
  test("splits owner/name and rejects a malformed identity", async () => {
    const runner = fakeGh({ "gh repo view --json nameWithOwner -q .nameWithOwner": "octo/repo\n" });
    expect(await repoIdentity(runner, "/repo")).toEqual({ owner: "octo", name: "repo" });
    const bad = fakeGh({ "gh repo view --json nameWithOwner -q .nameWithOwner": "octo/\n" });
    const error = await rejection(repoIdentity(bad, "/repo"));
    expectFailure(error, "repo-view", "failed", false);
    expect(error.message).toContain('invalid gh repo identity: "octo/"');
  });

  test("passes the query with -f and typed variables with -F, returning parsed JSON", async () => {
    const runner = fakeGh({
      "gh api graphql -f query=query { x } -F owner=octo -F name=repo -F prNumber=7": JSON.stringify({ data: 1 }),
    });
    expect(
      await graphql(runner, "/repo", { query: "query { x }", variables: { owner: "octo", name: "repo", prNumber: 7 } }),
    ).toEqual({ data: 1 });
  });
});

describe("checkAuthStatus", () => {
  test("resolves on success, honors a timeout override, and classifies a missing login as auth", async () => {
    const runner = fakeGh({ "gh auth status": "" });
    await checkAuthStatus(runner, "/repo", { timeoutMs: 5_000 });
    expect(runner.calls[0]?.options?.timeoutMs).toBe(5_000);
    const loggedOut = fakeGh({
      "gh auth status": ghFailure("You are not logged into any GitHub hosts. Run gh auth login"),
    });
    expectFailure(await rejection(checkAuthStatus(loggedOut, "/repo")), "auth-status", "auth", false);
  });
});

describe("error classification", () => {
  const cases: Array<[string, GitHubFailureReason, boolean]> = [
    ["HTTP 401: Bad credentials", "auth", false],
    ["HTTP 403: Resource not accessible by integration", "auth", false],
    ["HTTP 404: Not Found (https://api.github.com/repos/x)", "not-found", false],
    ['no pull requests found for branch "feat"', "not-found", false],
    ["GraphQL: Could not resolve to a PullRequest with the number of 1.", "not-found", false],
    ["HTTP 502: Bad gateway", "service", true],
    ["GraphQL: Something went wrong while executing your query.", "service", true],
    ["dial tcp: lookup api.github.com: no such host", "network", true],
    ["error connecting to api.github.com", "network", true],
    ["some other gh failure", "failed", false],
  ];
  for (const [stderr, reason, retryable] of cases) {
    test(`"${stderr}" is ${reason}`, async () => {
      const runner = fakeGh({ "gh pr ready 7": ghFailure(stderr, 1, "out") });
      const error = await rejection(markPrReady(runner, "/repo", 7));
      expectFailure(error, "pr-ready", reason, retryable);
      expect(error.stderr).toBe(stderr);
      expect(error.stdout).toBe("out");
      expect(error.status).toBe(1);
      expect(error.message).toBe("Command failed: gh");
    });
  }

  test("timeout and abort come before stderr rules", async () => {
    const timeout = fakeGh({
      "gh pr ready 7": new AsyncSubprocessError("Command timed out after 1ms: gh", undefined, "", "", "ETIMEDOUT"),
    });
    expectFailure(await rejection(markPrReady(timeout, "/repo", 7)), "pr-ready", "timeout", true);
    const controller = new AbortController();
    controller.abort();
    const aborted = fakeGh({ "gh pr ready 7": ghFailure("HTTP 502") });
    expectFailure(
      await rejection(markPrReady(aborted, "/repo", 7, { signal: controller.signal })),
      "pr-ready",
      "aborted",
      false,
    );
  });

  test("preserves the underlying message verbatim and unwraps execFile-shaped rejections", async () => {
    const shaped = Object.assign(new Error("PR creation rejected"), { status: 22, stdout: "o", stderr: "e" });
    const runner = fakeGh({ "gh pr ready 7": shaped });
    const error = await rejection(markPrReady(runner, "/repo", 7));
    expect(error.message).toBe("PR creation rejected");
    expect(error.status).toBe(22);
    expect(error.stdout).toBe("o");
    expect(error.stderr).toBe("e");
    expect(error.cause).toBe(shaped);
    expect(isRetryableGitHubError(new Error("plain"))).toBe(false);
  });
});

describe("ghCommandRunner", () => {
  test("routes boundary calls through a raw (cwd, args) seam", async () => {
    const seen: Array<{ cwd: string; args: readonly string[] }> = [];
    const runner = ghCommandRunner(async (cwd, args) => {
      seen.push({ cwd, args });
      return JSON.stringify({ state: "OPEN", mergedAt: null });
    });
    expect(await viewPrState(runner, "/wt", 3)).toEqual({ state: "OPEN", merged: false, mergedAt: null });
    expect(seen).toEqual([{ cwd: "/wt", args: ["pr", "view", "3", "--json", "state,mergedAt"] }]);
  });
});
