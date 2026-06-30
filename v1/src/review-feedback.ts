import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FailingCiCheck } from "./ci-checks.ts";
import { runGhCommand } from "./gh.ts";

export type ReviewThreadComment = {
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line: number | null;
  diffHunk: string | null;
};

export type ActionableInlineThread = {
  comments: ReviewThreadComment[];
};

export type TopLevelReviewComment = {
  author: string;
  body: string;
  createdAt: string;
};

export type ActionableReviewFeedback = {
  inlineThreads: ActionableInlineThread[];
  topLevelComments: TopLevelReviewComment[];
};

type GhRunner = typeof runGhCommand;

export async function collectActionableReviewFeedback(args: {
  prNumber: number;
  cwd: string;
  ghRunner?: GhRunner;
}): Promise<ActionableReviewFeedback> {
  const ghRunner = args.ghRunner ?? runGhCommand;
  const inlineThreads = await fetchUnresolvedInlineThreads({
    prNumber: args.prNumber,
    cwd: args.cwd,
    ghRunner,
  });
  const topLevelComments = await fetchEligibleTopLevelComments({
    prNumber: args.prNumber,
    cwd: args.cwd,
    ghRunner,
  });
  return { inlineThreads, topLevelComments };
}

async function fetchUnresolvedInlineThreads(args: {
  prNumber: number;
  cwd: string;
  ghRunner: GhRunner;
}): Promise<ActionableInlineThread[]> {
  const query = `query($owner: String!, $name: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 100) {
            nodes {
              author { login }
              body
              createdAt
              path
              line
              diffHunk
            }
          }
        }
      }
    }
  }
}`;
  const { owner, name } = await resolveRepoOwnerAndName(args.cwd, args.ghRunner);
  const result = await args.ghRunner(
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `prNumber=${String(args.prNumber)}`,
    ],
    args.cwd,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to fetch review threads");
  }
  const parsed = JSON.parse(result.stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              isResolved?: boolean;
              comments?: {
                nodes?: Array<{
                  author?: { login?: string | null } | null;
                  body?: string | null;
                  createdAt?: string | null;
                  path?: string | null;
                  line?: number | null;
                  diffHunk?: string | null;
                }>;
              } | null;
            }>;
          } | null;
        } | null;
      } | null;
    };
  };
  const nodes = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const out: ActionableInlineThread[] = [];
  for (const thread of nodes) {
    if (thread.isResolved === true) {
      continue;
    }
    const comments = (thread.comments?.nodes ?? [])
      .filter((c) => !isBotLogin(c.author?.login))
      .map((c) => ({
        author: c.author?.login ?? "unknown",
        body: c.body ?? "",
        createdAt: c.createdAt ?? "",
        path: c.path ?? "",
        line: c.line ?? null,
        diffHunk: c.diffHunk ?? null,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (comments.length === 0) {
      continue;
    }
    out.push({ comments });
  }
  out.sort((a, b) => (a.comments[0]?.createdAt ?? "").localeCompare(b.comments[0]?.createdAt ?? ""));
  return out;
}

async function fetchEligibleTopLevelComments(args: {
  prNumber: number;
  cwd: string;
  ghRunner: GhRunner;
}): Promise<TopLevelReviewComment[]> {
  const prView = await args.ghRunner(["pr", "view", String(args.prNumber), "--json", "reviews,comments"], args.cwd);
  if (prView.exitCode !== 0) {
    throw new Error(prView.stderr || prView.stdout || "failed to fetch PR comments");
  }
  const parsed = JSON.parse(prView.stdout) as {
    reviews?: Array<{ submittedAt?: string | null }>;
    comments?: Array<{
      author?: { login?: string | null } | null;
      body?: string | null;
      createdAt?: string | null;
    }>;
  };
  const latestSubmittedReview = latestSubmittedAt(parsed.reviews ?? []);
  return (parsed.comments ?? [])
    .filter((comment) => !isBotLogin(comment.author?.login))
    .filter((comment) => {
      if (latestSubmittedReview === null) {
        return true;
      }
      const createdAt = comment.createdAt ?? "";
      return createdAt >= latestSubmittedReview;
    })
    .map((comment) => ({
      author: comment.author?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? "",
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function latestSubmittedAt(reviews: Array<{ submittedAt?: string | null }>): string | null {
  let latest: string | null = null;
  for (const review of reviews) {
    const submittedAt = review.submittedAt ?? null;
    if (submittedAt === null) {
      continue;
    }
    if (latest === null || submittedAt > latest) {
      latest = submittedAt;
    }
  }
  return latest;
}

function isBotLogin(login: string | null | undefined): boolean {
  if (login === null || login === undefined) {
    return false;
  }
  return login.endsWith("[bot]");
}

async function resolveRepoOwnerAndName(cwd: string, ghRunner: GhRunner): Promise<{ owner: string; name: string }> {
  const result = await ghRunner(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to resolve repository");
  }
  const value = result.stdout.trim();
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`invalid gh repo identity: ${JSON.stringify(value)}`);
  }
  return {
    owner: value.slice(0, slash),
    name: value.slice(slash + 1),
  };
}

export function readPatchRulesText(): string {
  return readFileSync(join(import.meta.dir, "..", "..", "prompts", "patch", "rules.md"), "utf8");
}

export function renderReviewPrompt(args: {
  branch: string;
  prNumber: number;
  feedback: ActionableReviewFeedback;
  patchRulesText: string;
}): string {
  const lines: string[] = [];
  lines.push(`Address open review feedback on branch ${args.branch} for PR #${args.prNumber}.`);
  lines.push("Review mode instructions:");
  lines.push("- Address every included comment in one pass.");
  lines.push("- Do not create commits or push; Jarvis owns commit/push.");
  lines.push("- If any request cannot be handled safely, leave it unresolved and explain why in your response.");
  lines.push("");
  lines.push("Actionable unresolved inline threads:");
  if (args.feedback.inlineThreads.length === 0) {
    lines.push("- (none)");
  }
  for (const [index, thread] of args.feedback.inlineThreads.entries()) {
    const head = thread.comments[0];
    lines.push(`- Thread ${index + 1} (${head?.path ?? "unknown path"}:${head?.line ?? "?"})`);
    if (head?.diffHunk) {
      lines.push("  Diff context:");
      lines.push(`  ${head.diffHunk}`);
    }
    for (const comment of thread.comments) {
      lines.push(`  - ${comment.createdAt} ${comment.author}: ${comment.body.replaceAll("\n", " ")}`);
    }
  }
  lines.push("");
  lines.push("Actionable top-level PR comments:");
  if (args.feedback.topLevelComments.length === 0) {
    lines.push("- (none)");
  }
  for (const comment of args.feedback.topLevelComments) {
    lines.push(`- ${comment.createdAt} ${comment.author}: ${comment.body.replaceAll("\n", " ")}`);
  }
  lines.push("");
  lines.push("Patch mode rules:");
  lines.push(args.patchRulesText.trimEnd());
  lines.push("");
  return lines.join("\n");
}

/** CI-failure agent prompt when no open review comments are present. */
export function renderCiFailurePrompt(args: {
  branch: string;
  prNumber: number;
  failingChecks: FailingCiCheck[];
  patchRulesText: string;
}): string {
  const lines: string[] = [];
  lines.push(`Fix failing CI on branch ${args.branch} for PR #${args.prNumber}.`);
  lines.push("CI fix instructions:");
  lines.push("- Fix every listed failing check in one pass.");
  lines.push("- Do not create commits or push; Jarvis owns commit/push.");
  lines.push("- If any failure cannot be handled safely, leave it unresolved and explain why in your response.");
  lines.push("");
  lines.push("Failing CI checks:");
  if (args.failingChecks.length === 0) {
    lines.push("- (none)");
  }
  for (const check of args.failingChecks) {
    lines.push(`- ${check.name}`);
    lines.push(`  ${check.excerpt}`);
  }
  lines.push("");
  lines.push("Patch mode rules:");
  lines.push(args.patchRulesText.trimEnd());
  lines.push("");
  return lines.join("\n");
}
