import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import {
  type PrReviewInputCaptureArtifact,
  refreshPrReviewInputCapture,
  resolvePrReviewInputArtifactPath,
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
