import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";

type PrReviewInputCaptureComment = {
  commentId: string;
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line: number | null;
  diffHunk: string | null;
  outdated: boolean;
};

type PrReviewInputCaptureThread = {
  threadId: string;
  outdated: boolean;
  comments: PrReviewInputCaptureComment[];
};

type PrReviewInputTopLevelComment = {
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

type CaptureArgs = {
  laneWorktreePath: string;
  prNumber: number;
  runner: AsyncSubprocessRunner;
};

export function resolvePrReviewInputArtifactPath(laneWorktreePath: string): string {
  return join(laneWorktreePath, ".jarvis-pr-review-input.json");
}

export async function refreshPrReviewInputCapture(args: {
  laneWorktreePath: string;
  prNumber: number;
  runner?: AsyncSubprocessRunner;
}): Promise<PrReviewInputCaptureArtifact> {
  const capture: CaptureArgs = {
    laneWorktreePath: args.laneWorktreePath,
    prNumber: args.prNumber,
    runner: args.runner ?? realAsyncSubprocessRunner,
  };
  const artifact: PrReviewInputCaptureArtifact = {
    captureVersion: 1,
    prNumber: args.prNumber,
    threads: await fetchReviewThreads(capture),
    topLevelComments: await fetchTopLevelComments(capture),
  };
  writePrReviewInputArtifactAtomically(resolvePrReviewInputArtifactPath(args.laneWorktreePath), artifact);
  return artifact;
}

/** Thrown when GitHub reports more review threads or thread comments than one 100-item page. */
export class PrReviewInputTruncatedError extends Error {
  constructor(what: string) {
    super(`PR review input capture truncated: ${what} exceed one page of 100`);
    this.name = "PrReviewInputTruncatedError";
  }
}

type PrReviewInputArtifactFs = {
  writeFileSync: (path: string, data: string, options: { flag: string }) => void;
  renameSync: (from: string, to: string) => void;
};

const realArtifactFs: PrReviewInputArtifactFs = { writeFileSync, renameSync };

export function writePrReviewInputArtifactAtomically(
  path: string,
  artifact: PrReviewInputCaptureArtifact,
  fs: PrReviewInputArtifactFs = realArtifactFs,
): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(artifact, null, 2)}\n`;
  try {
    fs.writeFileSync(temporaryPath, payload, { flag: "wx" });
    fs.renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            pageInfo { hasNextPage }
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

type GraphqlReviewThreadNode = {
  id?: string | null;
  isResolved?: boolean;
  isOutdated?: boolean;
  comments?: {
    pageInfo?: { hasNextPage?: boolean } | null;
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
};

async function fetchReviewThreads(args: CaptureArgs): Promise<PrReviewInputCaptureThread[]> {
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
  const reviewThreads = (
    JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: { pageInfo?: { hasNextPage?: boolean } | null; nodes?: GraphqlReviewThreadNode[] };
          };
        };
      };
    }
  ).data?.repository?.pullRequest?.reviewThreads;
  if (reviewThreads?.pageInfo?.hasNextPage === true) throw new PrReviewInputTruncatedError("review threads");
  const out: PrReviewInputCaptureThread[] = [];
  for (const thread of reviewThreads?.nodes ?? []) {
    if (thread.comments?.pageInfo?.hasNextPage === true) {
      throw new PrReviewInputTruncatedError(`comments in thread ${thread.id ?? "?"}`);
    }
    if (thread.isResolved === true) continue;
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
    if (comments.length === 0) continue;
    out.push({ threadId: thread.id ?? "", outdated: threadOutdated, comments });
  }
  out.sort((a, b) => (a.comments[0]?.createdAt ?? "").localeCompare(b.comments[0]?.createdAt ?? ""));
  return out;
}

async function fetchTopLevelComments(args: CaptureArgs): Promise<PrReviewInputTopLevelComment[]> {
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
    .filter((comment) => {
      if (latestSubmittedReview === null) return true;
      return (comment.createdAt ?? "") >= latestSubmittedReview;
    })
    .map((comment) => ({
      commentId: comment.id ?? "",
      author: comment.author?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? "",
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function isBotLogin(login: string | null | undefined): boolean {
  return login != null && login.endsWith("[bot]");
}

function latestSubmittedAt(reviews: Array<{ submittedAt?: string | null }>): string | null {
  let latest: string | null = null;
  for (const review of reviews) {
    const submittedAt = review.submittedAt ?? null;
    if (submittedAt === null) continue;
    if (latest === null || submittedAt > latest) latest = submittedAt;
  }
  return latest;
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
  return { owner: value.slice(0, slash), name: value.slice(slash + 1) };
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
