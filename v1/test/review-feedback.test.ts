import { describe, expect, test } from "bun:test";
import { collectActionableReviewFeedback, renderReviewPrompt } from "../src/review-feedback.ts";

describe("collectActionableReviewFeedback", () => {
  test("excludes resolved threads and bot-authored inline comments", async () => {
    const ghRunner = async (args: string[]) => {
      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: "owner/repo\n",
          stderr: "",
        };
      }
      if (args[0] === "api") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [
                      {
                        isResolved: true,
                        comments: {
                          nodes: [
                            {
                              author: { login: "reviewer-a" },
                              body: "resolved feedback",
                              createdAt: "2026-05-01T00:00:00Z",
                              path: "a.ts",
                              line: 1,
                              diffHunk: "@@",
                            },
                          ],
                        },
                      },
                      {
                        isResolved: false,
                        comments: {
                          nodes: [
                            {
                              author: { login: "bot[bot]" },
                              body: "bot noise",
                              createdAt: "2026-05-01T00:00:00Z",
                              path: "b.ts",
                              line: 2,
                              diffHunk: "@@",
                            },
                            {
                              author: { login: "reviewer-b" },
                              body: "keep this",
                              createdAt: "2026-05-01T00:01:00Z",
                              path: "b.ts",
                              line: 3,
                              diffHunk: "@@",
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          reviews: [],
          comments: [],
        }),
        stderr: "",
      };
    };
    const out = await collectActionableReviewFeedback({
      prNumber: 7,
      cwd: "/tmp/repo",
      // biome-ignore lint/suspicious/noExplicitAny: test seam
      ghRunner: ghRunner as any,
    });
    expect(out.inlineThreads).toHaveLength(1);
    expect(out.inlineThreads[0]?.comments).toHaveLength(1);
    expect(out.inlineThreads[0]?.comments[0]?.author).toBe("reviewer-b");
  });

  test("filters top-level comments to latest submitted review boundary and excludes bots", async () => {
    const ghRunner = async (args: string[]) => {
      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: "owner/repo\n",
          stderr: "",
        };
      }
      if (args[0] === "api") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              repository: { pullRequest: { reviewThreads: { nodes: [] } } },
            },
          }),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          reviews: [{ submittedAt: "2026-05-10T00:00:00Z" }],
          comments: [
            {
              author: { login: "reviewer-1" },
              body: "too old",
              createdAt: "2026-05-09T00:00:00Z",
            },
            {
              author: { login: "build[bot]" },
              body: "bot",
              createdAt: "2026-05-10T00:00:01Z",
            },
            {
              author: { login: "reviewer-2" },
              body: "keep",
              createdAt: "2026-05-10T00:00:02Z",
            },
          ],
        }),
        stderr: "",
      };
    };
    const out = await collectActionableReviewFeedback({
      prNumber: 7,
      cwd: "/tmp/repo",
      // biome-ignore lint/suspicious/noExplicitAny: test seam
      ghRunner: ghRunner as any,
    });
    expect(out.topLevelComments).toHaveLength(1);
    expect(out.topLevelComments[0]?.author).toBe("reviewer-2");
  });

  test("keeps non-bot top-level comments when there is no submitted review", async () => {
    const ghRunner = async (args: string[]) => {
      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: "owner/repo\n",
          stderr: "",
        };
      }
      if (args[0] === "api") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: {
              repository: { pullRequest: { reviewThreads: { nodes: [] } } },
            },
          }),
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          reviews: [{ submittedAt: null }],
          comments: [
            {
              author: { login: "reviewer-1" },
              body: "keep",
              createdAt: "2026-05-01T00:00:00Z",
            },
            {
              author: { login: "ci[bot]" },
              body: "skip",
              createdAt: "2026-05-01T00:00:01Z",
            },
          ],
        }),
        stderr: "",
      };
    };
    const out = await collectActionableReviewFeedback({
      prNumber: 7,
      cwd: "/tmp/repo",
      // biome-ignore lint/suspicious/noExplicitAny: test seam
      ghRunner: ghRunner as any,
    });
    expect(out.topLevelComments).toHaveLength(1);
    expect(out.topLevelComments[0]?.author).toBe("reviewer-1");
  });
});

describe("renderReviewPrompt", () => {
  test("renders PR identity, thread context, top-level comments, and patch rules", () => {
    const prompt = renderReviewPrompt({
      branch: "feature/test",
      prNumber: 42,
      feedback: {
        inlineThreads: [
          {
            comments: [
              {
                author: "reviewer-a",
                body: "please rename this",
                createdAt: "2026-05-10T00:00:00Z",
                path: "src/file.ts",
                line: 9,
                diffHunk: "@@ -1,2 +1,2 @@",
              },
              {
                author: "author",
                body: "done?",
                createdAt: "2026-05-10T00:01:00Z",
                path: "src/file.ts",
                line: 9,
                diffHunk: "@@ -1,2 +1,2 @@",
              },
            ],
          },
        ],
        topLevelComments: [
          {
            author: "lead",
            body: "please add a test",
            createdAt: "2026-05-10T00:02:00Z",
          },
        ],
      },
      patchRulesText: "# Patch Mode\n- Do work",
    });
    expect(prompt).toContain("branch feature/test");
    expect(prompt).toContain("PR #42");
    expect(prompt).toContain("src/file.ts:9");
    expect(prompt).toContain("reviewer-a: please rename this");
    expect(prompt).toContain("lead: please add a test");
    expect(prompt).toContain("Do not create commits or push");
    expect(prompt).toContain("# Patch Mode");
  });
});
