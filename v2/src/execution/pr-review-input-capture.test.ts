import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import {
  hasSubmittedPrReview,
  type PrReviewInputCaptureArtifact,
  PrReviewInputTruncatedError,
  refreshPrReviewInputCapture,
  resolvePrReviewInputArtifactPath,
  writePrReviewInputArtifactAtomically,
} from "./pr-review-input-capture.ts";

const FIXTURE = {
  owner: "owner",
  repo: "repo",
  prNumber: 42,
  threadResolved: "RT_resolved",
  threadActive: "RT_active",
  threadOutdated: "RT_outdated",
  commentResolved: "PRRC_resolved",
  commentBot: "PRRC_bot",
  commentHumanA: "PRRC_human_a",
  commentHumanB: "PRRC_human_b",
  commentOutdated: "PRRC_outdated",
  topOld: "IC_old",
  topBot: "IC_bot",
  topKeep: "IC_keep",
} as const;

function reviewThreadsGraphqlPayload(): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: FIXTURE.threadResolved,
                isResolved: true,
                isOutdated: false,
                comments: {
                  nodes: [
                    {
                      id: FIXTURE.commentResolved,
                      author: { login: "reviewer-resolved" },
                      body: "resolved feedback",
                      createdAt: "2026-05-01T00:00:00Z",
                      path: "resolved.ts",
                      line: 1,
                      diffHunk: "@@ resolved",
                    },
                  ],
                },
              },
              {
                id: FIXTURE.threadActive,
                isResolved: false,
                isOutdated: false,
                comments: {
                  nodes: [
                    {
                      id: FIXTURE.commentBot,
                      author: { login: "dependabot[bot]" },
                      body: "bot inline",
                      createdAt: "2026-05-02T00:00:00Z",
                      path: "active.ts",
                      line: 2,
                      diffHunk: "@@ bot",
                    },
                    {
                      id: FIXTURE.commentHumanA,
                      author: { login: "reviewer-a" },
                      body: "first human",
                      createdAt: "2026-05-02T00:01:00Z",
                      path: "active.ts",
                      line: 3,
                      diffHunk: "@@ a",
                    },
                    {
                      id: FIXTURE.commentHumanB,
                      author: { login: "reviewer-b" },
                      body: "second human",
                      createdAt: "2026-05-02T00:02:00Z",
                      path: "active.ts",
                      line: 4,
                      diffHunk: "@@ b",
                    },
                  ],
                },
              },
              {
                id: FIXTURE.threadOutdated,
                isResolved: false,
                isOutdated: true,
                comments: {
                  nodes: [
                    {
                      id: FIXTURE.commentOutdated,
                      author: { login: "reviewer-outdated" },
                      body: "stale anchor",
                      createdAt: "2026-05-03T00:00:00Z",
                      path: "old.ts",
                      line: 9,
                      diffHunk: "@@ outdated",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });
}

function prViewPayload(): string {
  return JSON.stringify({
    reviews: [{ submittedAt: "2026-05-10T00:00:00Z" }, { submittedAt: "2026-05-01T00:00:00Z" }],
    comments: [
      {
        id: FIXTURE.topOld,
        author: { login: "reviewer-old" },
        body: "pre-review conversation",
        createdAt: "2026-05-09T23:59:59Z",
      },
      {
        id: FIXTURE.topBot,
        author: { login: "github-actions[bot]" },
        body: "bot top-level",
        createdAt: "2026-05-10T00:00:01Z",
      },
      {
        id: FIXTURE.topKeep,
        author: { login: "reviewer-new" },
        body: "post-review conversation",
        createdAt: "2026-05-10T00:00:02Z",
      },
    ],
  });
}

function createFixtureRunner(laneWorktreePath: string): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
      if (args[0] === "repo" && args[1] === "view") return `${FIXTURE.owner}/${FIXTURE.repo}\n`;
      if (args[0] === "api" && args[1] === "graphql") return reviewThreadsGraphqlPayload();
      if (args[0] === "pr" && args[1] === "view" && args.includes("reviews,comments")) return prViewPayload();
      throw new Error(`unexpected gh invocation: ${args.join(" ")} in ${cwd ?? laneWorktreePath}`);
    },
  };
}

async function withFixtureArtifact(
  run: (artifact: PrReviewInputCaptureArtifact) => void | Promise<void>,
): Promise<void> {
  const laneWorktreePath = trackedMkdtempSync("pr-review-input-capture-");
  try {
    await refreshPrReviewInputCapture({
      laneWorktreePath,
      prNumber: FIXTURE.prNumber,
      runner: createFixtureRunner(laneWorktreePath),
    });
    const path = resolvePrReviewInputArtifactPath(laneWorktreePath);
    expect(existsSync(path)).toBe(true);
    await run(JSON.parse(readFileSync(path, "utf8")) as PrReviewInputCaptureArtifact);
  } finally {
    rmSync(laneWorktreePath, { recursive: true, force: true });
  }
}

describe("hasSubmittedPrReview", () => {
  test("returns false when no review has submittedAt", () => {
    expect(hasSubmittedPrReview([{ submittedAt: null }, {}])).toBe(false);
  });

  test("returns true when at least one review has submittedAt", () => {
    expect(hasSubmittedPrReview([{ submittedAt: null }, { submittedAt: "2026-05-10T00:00:00Z" }])).toBe(true);
  });
});

describe("refreshPrReviewInputCapture", () => {
  test("refresh writes actionable PR review threads and comments with stable GitHub ids", async () => {
    await withFixtureArtifact((artifact) => {
      expect(artifact.captureVersion).toBe(1);
      expect(artifact.prNumber).toBe(FIXTURE.prNumber);
      expect(artifact.threads.map((thread) => thread.threadId)).toEqual([FIXTURE.threadActive, FIXTURE.threadOutdated]);
      const active = artifact.threads.find((thread) => thread.threadId === FIXTURE.threadActive);
      expect(active?.comments.map((comment) => comment.commentId)).toEqual([
        FIXTURE.commentHumanA,
        FIXTURE.commentHumanB,
      ]);
      expect(artifact.topLevelComments.map((comment) => comment.commentId)).toEqual([FIXTURE.topKeep]);
    });
  });

  test("resolved threads are excluded from the artifact", async () => {
    await withFixtureArtifact((artifact) => {
      expect(artifact.threads.some((thread) => thread.threadId === FIXTURE.threadResolved)).toBe(false);
    });
  });

  test("outdated threads are kept and flagged outdated", async () => {
    await withFixtureArtifact((artifact) => {
      const outdated = artifact.threads.find((thread) => thread.threadId === FIXTURE.threadOutdated);
      expect(outdated).toBeDefined();
      expect(outdated?.outdated).toBe(true);
      expect(outdated?.comments.every((comment) => comment.outdated)).toBe(true);
      const active = artifact.threads.find((thread) => thread.threadId === FIXTURE.threadActive);
      expect(active?.outdated).toBe(false);
      expect(active?.comments.every((comment) => !comment.outdated)).toBe(true);
    });
  });

  test("captures a submitted review body when there are no threads or top-level comments", async () => {
    const reviewId = "PRR_review_body_only";
    const laneWorktreePath = trackedMkdtempSync("pr-review-input-capture-review-body-only-");
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
        if (args[0] === "repo" && args[1] === "view") return `${FIXTURE.owner}/${FIXTURE.repo}\n`;
        if (args[0] === "api" && args[1] === "graphql") {
          return JSON.stringify({
            data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
          });
        }
        if (args[0] === "pr" && args[1] === "view" && args.includes("reviews,comments")) {
          return JSON.stringify({
            reviews: [
              {
                id: reviewId,
                author: { login: "reviewer-body" },
                body: "findings in review body",
                submittedAt: "2026-05-10T00:00:00Z",
                state: "COMMENTED",
              },
            ],
            comments: [],
          });
        }
        throw new Error(`unexpected gh invocation: ${args.join(" ")}`);
      },
    };
    try {
      await refreshPrReviewInputCapture({ laneWorktreePath, prNumber: FIXTURE.prNumber, runner });
      const artifact = JSON.parse(
        readFileSync(resolvePrReviewInputArtifactPath(laneWorktreePath), "utf8"),
      ) as PrReviewInputCaptureArtifact;
      expect(artifact.threads).toEqual([]);
      expect(artifact.topLevelComments).toEqual([]);
      expect(artifact.reviewBodies).toEqual([
        {
          reviewId,
          author: "reviewer-body",
          body: "findings in review body",
          submittedAt: "2026-05-10T00:00:00Z",
          state: "COMMENTED",
        },
      ]);
    } finally {
      rmSync(laneWorktreePath, { recursive: true, force: true });
    }
  });

  test("bot comments and pre-review top-level comments are dropped", async () => {
    await withFixtureArtifact((artifact) => {
      const active = artifact.threads.find((thread) => thread.threadId === FIXTURE.threadActive);
      expect(active?.comments.some((comment) => comment.commentId === FIXTURE.commentBot)).toBe(false);
      expect(artifact.topLevelComments.some((comment) => comment.commentId === FIXTURE.topOld)).toBe(false);
      expect(artifact.topLevelComments.some((comment) => comment.commentId === FIXTURE.topBot)).toBe(false);
      expect(artifact.topLevelComments).toHaveLength(1);
    });
  });

  test("uses the latest submitted review when an earlier submission is also present", async () => {
    const laneWorktreePath = trackedMkdtempSync("pr-review-input-capture-latest-review-");
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
        if (args[0] === "repo" && args[1] === "view") return `${FIXTURE.owner}/${FIXTURE.repo}\n`;
        if (args[0] === "api" && args[1] === "graphql") return reviewThreadsGraphqlPayload();
        if (args[0] === "pr" && args[1] === "view" && args.includes("reviews,comments")) {
          return JSON.stringify({
            reviews: [{ submittedAt: "2026-05-01T00:00:00Z" }, { submittedAt: "2026-05-10T00:00:00Z" }],
            comments: [
              {
                id: FIXTURE.topOld,
                author: { login: "reviewer-old" },
                body: "pre-review conversation",
                createdAt: "2026-05-09T23:59:59Z",
              },
              {
                id: FIXTURE.topKeep,
                author: { login: "reviewer-new" },
                body: "post-review conversation",
                createdAt: "2026-05-10T00:00:02Z",
              },
            ],
          });
        }
        throw new Error(`unexpected gh invocation: ${args.join(" ")} in ${cwd ?? laneWorktreePath}`);
      },
    };
    try {
      await refreshPrReviewInputCapture({
        laneWorktreePath,
        prNumber: FIXTURE.prNumber,
        runner,
      });
      const artifact = JSON.parse(
        readFileSync(resolvePrReviewInputArtifactPath(laneWorktreePath), "utf8"),
      ) as PrReviewInputCaptureArtifact;
      expect(artifact.topLevelComments.map((comment) => comment.commentId)).toEqual([FIXTURE.topKeep]);
      expect(artifact.topLevelComments.some((comment) => comment.commentId === FIXTURE.topOld)).toBe(false);
    } finally {
      rmSync(laneWorktreePath, { recursive: true, force: true });
    }
  });
});

type ThreadFixture = {
  id: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  hasNextPage?: boolean;
  comments: Array<{ id: string; login: string | null; createdAt: string }>;
};

function graphqlPayload(threads: ThreadFixture[], hasNextPage = false): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage },
            nodes: threads.map((thread) => ({
              id: thread.id,
              isResolved: thread.isResolved ?? false,
              isOutdated: thread.isOutdated ?? false,
              comments: {
                pageInfo: { hasNextPage: thread.hasNextPage ?? false },
                nodes: thread.comments.map((comment) => ({
                  id: comment.id,
                  author: comment.login === null ? null : { login: comment.login },
                  body: "b",
                  createdAt: comment.createdAt,
                  path: "f.ts",
                  line: 1,
                  diffHunk: "@@",
                })),
              },
            })),
          },
        },
      },
    },
  });
}

async function captureWith(graphql: string, prView: string): Promise<PrReviewInputCaptureArtifact> {
  const laneWorktreePath = trackedMkdtempSync("pr-review-input-capture-case-");
  const runner: AsyncSubprocessRunner = {
    runAsync: async (cmd, args) => {
      if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
      if (args[0] === "repo") return "owner/repo\n";
      if (args[0] === "api") return graphql;
      if (args[0] === "pr") return prView;
      throw new Error(`unexpected gh ${args.join(" ")}`);
    },
  };
  try {
    return await refreshPrReviewInputCapture({ laneWorktreePath, prNumber: 7, runner });
  } finally {
    rmSync(laneWorktreePath, { recursive: true, force: true });
  }
}

const EMPTY_PR_VIEW = JSON.stringify({ reviews: [], comments: [] });

describe("refreshPrReviewInputCapture edge cases", () => {
  test("missing author is kept as unknown", async () => {
    const artifact = await captureWith(
      graphqlPayload([{ id: "T", comments: [{ id: "C", login: null, createdAt: "2026-01-01T00:00:00Z" }] }]),
      JSON.stringify({
        reviews: [],
        comments: [{ id: "IC", author: null, body: "x", createdAt: "2026-01-01T00:00:00Z" }],
      }),
    );
    expect(artifact.threads[0]?.comments[0]?.author).toBe("unknown");
    expect(artifact.topLevelComments[0]?.author).toBe("unknown");
  });

  test("a thread whose only comments are bots is dropped", async () => {
    const artifact = await captureWith(
      graphqlPayload([
        { id: "T_bot", comments: [{ id: "C1", login: "ci[bot]", createdAt: "2026-01-01T00:00:00Z" }] },
        { id: "T_human", comments: [{ id: "C2", login: "human", createdAt: "2026-01-02T00:00:00Z" }] },
      ]),
      EMPTY_PR_VIEW,
    );
    expect(artifact.threads.map((thread) => thread.threadId)).toEqual(["T_human"]);
  });

  test("with no submitted review all non-bot top-level comments are kept", async () => {
    const artifact = await captureWith(
      graphqlPayload([]),
      JSON.stringify({
        reviews: [{ submittedAt: null }],
        comments: [
          { id: "A", author: { login: "a" }, body: "x", createdAt: "2026-01-01T00:00:00Z" },
          { id: "B", author: { login: "b" }, body: "y", createdAt: "2026-01-02T00:00:00Z" },
        ],
      }),
    );
    expect(artifact.topLevelComments.map((comment) => comment.commentId)).toEqual(["A", "B"]);
  });

  test("out-of-order input sorts by createdAt at every level", async () => {
    const artifact = await captureWith(
      graphqlPayload([
        {
          id: "T_late",
          comments: [
            { id: "L2", login: "h", createdAt: "2026-01-05T00:00:00Z" },
            { id: "L1", login: "h", createdAt: "2026-01-04T00:00:00Z" },
          ],
        },
        { id: "T_early", comments: [{ id: "E1", login: "h", createdAt: "2026-01-01T00:00:00Z" }] },
      ]),
      JSON.stringify({
        reviews: [],
        comments: [
          { id: "Z", author: { login: "a" }, body: "x", createdAt: "2026-01-03T00:00:00Z" },
          { id: "Y", author: { login: "a" }, body: "x", createdAt: "2026-01-02T00:00:00Z" },
        ],
      }),
    );
    expect(artifact.threads.map((thread) => thread.threadId)).toEqual(["T_early", "T_late"]);
    expect(artifact.threads[1]?.comments.map((comment) => comment.commentId)).toEqual(["L1", "L2"]);
    expect(artifact.topLevelComments.map((comment) => comment.commentId)).toEqual(["Y", "Z"]);
  });

  test("more review threads than one page fails with PrReviewInputTruncatedError", async () => {
    await expect(captureWith(graphqlPayload([], true), EMPTY_PR_VIEW)).rejects.toBeInstanceOf(
      PrReviewInputTruncatedError,
    );
  });

  test("more thread comments than one page fails with PrReviewInputTruncatedError", async () => {
    const threads = [
      { id: "T", hasNextPage: true, comments: [{ id: "C", login: "h", createdAt: "2026-01-01T00:00:00Z" }] },
    ];
    await expect(captureWith(graphqlPayload(threads), EMPTY_PR_VIEW)).rejects.toBeInstanceOf(
      PrReviewInputTruncatedError,
    );
  });
});

describe("writePrReviewInputArtifactAtomically", () => {
  const artifact: PrReviewInputCaptureArtifact = {
    captureVersion: 1,
    prNumber: 1,
    threads: [],
    topLevelComments: [],
    reviewBodies: [],
  };

  test("writes a sibling temp file then renames it onto the target", () => {
    const dir = trackedMkdtempSync("pr-review-input-atomic-");
    const target = resolvePrReviewInputArtifactPath(dir);
    const ops: string[] = [];
    try {
      writePrReviewInputArtifactAtomically(target, artifact, {
        writeFileSync: (path, data, options) => {
          ops.push(`write:${path}`);
          writeFileSync(path, data, options);
        },
        renameSync: (from, to) => {
          ops.push(`rename:${from}->${to}`);
          expect(existsSync(to)).toBe(false);
          renameSync(from, to);
        },
      });
      const temp = ops[0]?.slice("write:".length) ?? "";
      expect(temp).not.toBe(target);
      expect(dirname(temp)).toBe(dir);
      expect(ops).toEqual([`write:${temp}`, `rename:${temp}->${target}`]);
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(artifact);
      expect(readdirSync(dir)).toEqual([".jarvis-pr-review-input.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed rename leaves the prior artifact intact and removes the temp file", () => {
    const dir = trackedMkdtempSync("pr-review-input-atomic-fail-");
    const target = resolvePrReviewInputArtifactPath(dir);
    writeFileSync(target, "prior\n");
    try {
      expect(() =>
        writePrReviewInputArtifactAtomically(target, artifact, {
          writeFileSync: (path, data, options) => writeFileSync(path, data, options),
          renameSync: () => {
            throw new Error("rename failed");
          },
        }),
      ).toThrow("rename failed");
      expect(readFileSync(target, "utf8")).toBe("prior\n");
      expect(readdirSync(dir)).toEqual([".jarvis-pr-review-input.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
