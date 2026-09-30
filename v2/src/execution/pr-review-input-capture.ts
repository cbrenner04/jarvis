import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";

export const PR_REVIEW_INPUT_ARTIFACT_NAME = ".jarvis-pr-review-input.json";

export type PrReviewInputCaptureComment = {
  commentId: string;
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line: number | null;
  diffHunk: string | null;
  outdated: boolean;
};

export type PrReviewInputCaptureThread = {
  threadId: string;
  outdated: boolean;
  comments: PrReviewInputCaptureComment[];
};

export type PrReviewInputTopLevelComment = {
  commentId: string;
  author: string;
  body: string;
  createdAt: string;
};

export type PrReviewInputCaptureArtifact = {
  captureVersion: 1;
  prNumber: number;
  threads: PrReviewInputCaptureThread[];
  topLevelComments: PrReviewInputTopLevelComment[];
};

export function resolvePrReviewInputArtifactPath(laneWorktreePath: string): string {
  return join(laneWorktreePath, PR_REVIEW_INPUT_ARTIFACT_NAME);
}

export async function refreshPrReviewInputCapture(args: {
  laneWorktreePath: string;
  prNumber: number;
  runner?: AsyncSubprocessRunner;
}): Promise<PrReviewInputCaptureArtifact> {
  const runner = args.runner ?? realAsyncSubprocessRunner;
  const artifact = await collectPrReviewInputCapture({
    laneWorktreePath: args.laneWorktreePath,
    prNumber: args.prNumber,
    runner,
  });
  writePrReviewInputArtifactAtomically(resolvePrReviewInputArtifactPath(args.laneWorktreePath), artifact);
  return artifact;
}

export async function collectPrReviewInputCapture(args: {
  laneWorktreePath: string;
  prNumber: number;
  runner: AsyncSubprocessRunner;
}): Promise<PrReviewInputCaptureArtifact> {
  const threads = await fetchReviewThreads(args);
  const topLevelComments = await fetchTopLevelComments(args);
  return {
    captureVersion: 1,
    prNumber: args.prNumber,
    threads,
    topLevelComments,
  };
}

function writePrReviewInputArtifactAtomically(path: string, artifact: PrReviewInputCaptureArtifact): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(artifact, null, 2)}\n`;
  try {
    writeFileSync(temporaryPath, payload, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              id
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

async function fetchReviewThreads(args: {
  laneWorktreePath: string;
  prNumber: number;
  runner: AsyncSubprocessRunner;
}): Promise<PrReviewInputCaptureThread[]> {
  const { owner, name } = await resolveRepoOwnerAndName(args.laneWorktreePath, args.runner);
  const stdout = await runGh(args.runner, args.laneWorktreePath, [
    "api",
    "graphql",
    "-f",
    `query=${REVIEW_THREADS_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `prNumber=${String(args.prNumber)}`,
  ]);
  const parsed = JSON.parse(stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              id?: string | null;
              isResolved?: boolean;
              isOutdated?: boolean;
              comments?: {
                nodes?: Array<{
                  id?: string | null;
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
  const out: PrReviewInputCaptureThread[] = [];
  for (const thread of nodes) {
    if (thread.isResolved === true) {
      continue;
    }
    const threadOutdated = thread.isOutdated === true;
    const comments = (thread.comments?.nodes ?? [])
      .filter((comment) => !isBotLogin(comment.author?.login))
      .map((comment) => ({
        commentId: comment.id ?? "",
        author: comment.author?.login ?? "unknown",
        body: comment.body ?? "",
        createdAt: comment.createdAt ?? "",
        path: comment.path ?? "",
        line: comment.line ?? null,
        diffHunk: comment.diffHunk ?? null,
        outdated: threadOutdated,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (comments.length === 0) {
      continue;
    }
    out.push({
      threadId: thread.id ?? "",
      outdated: threadOutdated,
      comments,
    });
  }
  out.sort((a, b) => (a.comments[0]?.createdAt ?? "").localeCompare(b.comments[0]?.createdAt ?? ""));
  return out;
}

async function fetchTopLevelComments(args: {
  laneWorktreePath: string;
  prNumber: number;
  runner: AsyncSubprocessRunner;
}): Promise<PrReviewInputTopLevelComment[]> {
  const stdout = await runGh(args.runner, args.laneWorktreePath, [
    "pr",
    "view",
    String(args.prNumber),
    "--json",
    "reviews,comments",
  ]);
  const parsed = JSON.parse(stdout) as {
    reviews?: Array<{ submittedAt?: string | null }>;
    comments?: Array<{
      id?: string | null;
      author?: { login?: string | null } | null;
      body?: string | null;
      createdAt?: string | null;
    }>;
  };
  const latestSubmittedReview = latestSubmittedAt(parsed.reviews ?? []);
  return (parsed.comments ?? [])
    .filter((comment) => !isBotLogin(comment.author?.login))
    .filter((comment) => isTopLevelCommentEligible(comment.createdAt ?? "", latestSubmittedReview))
    .map((comment) => ({
      commentId: comment.id ?? "",
      author: comment.author?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? "",
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function isBotLogin(login: string | null | undefined): boolean {
  if (login === null || login === undefined) {
    return false;
  }
  return login.endsWith("[bot]");
}

export function latestSubmittedAt(reviews: Array<{ submittedAt?: string | null }>): string | null {
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

export function isTopLevelCommentEligible(createdAt: string, latestSubmittedReview: string | null): boolean {
  if (latestSubmittedReview === null) {
    return true;
  }
  return createdAt >= latestSubmittedReview;
}

async function resolveRepoOwnerAndName(
  cwd: string,
  runner: AsyncSubprocessRunner,
): Promise<{ owner: string; name: string }> {
  const value = (await runGh(runner, cwd, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim();
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`invalid gh repo identity: ${JSON.stringify(value)}`);
  }
  return {
    owner: value.slice(0, slash),
    name: value.slice(slash + 1),
  };
}

async function runGh(runner: AsyncSubprocessRunner, cwd: string, args: string[]): Promise<string> {
  try {
    return await runner.runAsync("gh", args, cwd, networkSubprocessOptions());
  } catch (error) {
    throwGhError(`gh ${args.join(" ")} failed`, error);
  }
}

function throwGhError(context: string, error: unknown): never {
  if (error instanceof AsyncSubprocessError) {
    const detail = error.stderr.trim() || error.stdout.trim() || error.message;
    throw new Error(`${context}: ${detail}`);
  }
  throw error;
}
