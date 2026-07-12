import { execFileSync } from "node:child_process";
import { type RefreshPrBodyInput, refreshPrBody } from "./pr-body-refresh.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";

export type CompletionPublisherInput = {
  worktreePath: string;
  baseRef: string;
  specPath: string;
  branch: string;
  creationTitle?: unknown;
  bodySummary?: string;
};

export type CompletionPublisherResult = {
  pushSha?: string;
  prNumber?: number;
};

export type CompletionPublisher = (input: CompletionPublisherInput) => Promise<CompletionPublisherResult>;

type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => string;
type GhCommand = (cwd: string, args: readonly string[], env?: Record<string, string>) => string;
type GhReady = (cwd: string) => boolean;
type Delay = (ms: number) => Promise<void>;
type RetryNotice = (message: string) => void;

type FetchPrBody = RefreshPrBodyInput["fetchPrBody"];
type WritePrBody = RefreshPrBodyInput["writePrBody"];
type RenderFooter = NonNullable<RefreshPrBodyInput["renderFooter"]>;
type AttributionGit = NonNullable<RefreshPrBodyInput["git"]>;

type PublisherSeams = {
  git: Git;
  gh: GhCommand;
  ghReady: GhReady;
  delay: Delay;
  retryNotice: RetryNotice;
  fetchPrBody?: FetchPrBody;
  writePrBody?: WritePrBody;
  renderFooter?: RenderFooter;
};

function defaultGit(cwd: string, args: readonly string[], env?: Record<string, string>): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

function defaultGh(cwd: string, args: readonly string[], env?: Record<string, string>): string {
  return execFileSync("gh", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

function defaultGhReady(cwd: string): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { cwd, env: process.env, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRetryNotice(message: string): void {
  console.error(message);
}

/** Publishes completion commit: push to origin and ensure open draft PR. Retryable on transient failures. */
export function createCompletionPublisher(seams?: Partial<PublisherSeams>): CompletionPublisher {
  const git = seams?.git ?? defaultGit;
  const gh = seams?.gh ?? defaultGh;
  const ghReady = seams?.ghReady ?? defaultGhReady;
  const delay = seams?.delay ?? defaultDelay;
  const retryNotice = seams?.retryNotice ?? defaultRetryNotice;

  return async (input) => {
    const specPath = normalizePublicationSpecPath(input.worktreePath, input.specPath);

    // Single gh readiness probe gates all GitHub operations
    if (!ghReady(input.worktreePath)) {
      throw new Error("GitHub auth unavailable; cannot publish PR");
    }

    const result: CompletionPublisherResult = {};

    // Push with retry
    const pushSha = await publishWithRetry(
      () => {
        const hasUpstream = checkHasUpstream(git, input.worktreePath, input.branch);
        if (hasUpstream) {
          git(input.worktreePath, ["push"]);
        } else {
          git(input.worktreePath, ["push", "-u", "origin", input.branch]);
        }
        return git(input.worktreePath, ["rev-parse", "HEAD"]);
      },
      "push",
      delay,
      retryNotice,
    );

    if (pushSha) {
      result.pushSha = pushSha;
    }

    // PR lookup/creation with retry
    const prNumber = await publishWithRetry(
      () => findOrCreatePr(gh, input.worktreePath, input.baseRef, input.branch, specPath, input.creationTitle),
      "pr",
      delay,
      retryNotice,
    );

    if (prNumber) {
      result.prNumber = prNumber;
    }

    await publishWithRetry(
      async () => {
        await refreshPrBody({
          specPath,
          branch: input.branch,
          base: input.baseRef,
          cwd: input.worktreePath,
          git: syncGitToAttributionGit(git),
          ...(input.bodySummary !== undefined ? { bodySummary: input.bodySummary } : {}),
          ...(seams?.fetchPrBody !== undefined ? { fetchPrBody: seams.fetchPrBody } : {}),
          ...(seams?.writePrBody !== undefined ? { writePrBody: seams.writePrBody } : {}),
          ...(seams?.renderFooter !== undefined ? { renderFooter: seams.renderFooter } : {}),
        });
        return true;
      },
      "pr-body-refresh",
      delay,
      retryNotice,
    );

    return result;
  };
}

function syncGitToAttributionGit(git: Git): AttributionGit {
  return async (cwd, args) => git(cwd, args);
}

function checkHasUpstream(git: Git, worktreePath: string, branch: string): boolean {
  try {
    git(worktreePath, ["rev-parse", `${branch}@{u}`]);
    return true;
  } catch {
    return false;
  }
}

type PublishResult<T> = T | null;

async function publishWithRetry<T>(
  operation: () => T | Promise<T>,
  operationName: string,
  delay: Delay,
  retryNotice: RetryNotice,
): Promise<PublishResult<T>> {
  const maxAttempts = 3;
  const backoffMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message;

      // Non-fast-forward is permanent
      if (msg.includes("non-fast-forward") || msg.includes("failed to push some refs")) {
        throw new Error("Non-fast-forward push rejection; PR head diverged from remote");
      }

      if (attempt === maxAttempts) {
        throw err;
      }

      retryNotice(`${operationName}: transient network error; retrying (attempt ${attempt + 1}/3)`);
      await delay(backoffMs);
    }
  }

  return null;
}

function findOrCreatePr(
  gh: GhCommand,
  cwd: string,
  baseRef: string,
  branch: string,
  specPath: string,
  creationTitle: unknown,
): number {
  // Find open PRs for this branch in the worktree's repository
  const prListJson = gh(cwd, ["pr", "list", "--head", branch, "--state", "open", "--json", "number,baseRefName"]);
  const prs = JSON.parse(prListJson) as Array<{ number: number; baseRefName: string }>;

  // Filter by matching base
  const matching = prs.filter((pr) => pr.baseRefName === baseRef);

  if (matching.length > 0 && matching[0]) {
    // Return first matching open PR
    return matching[0].number;
  }

  // Create new draft PR
  const createOutput = gh(cwd, [
    "pr",
    "create",
    "--draft",
    "--base",
    baseRef,
    "--title",
    resolveCreationTitle(creationTitle),
    "--body",
    `Spec: ${specPath}`,
  ]);

  // Extract PR number from output (URL or number)
  const match = createOutput.match(/(?:pull\/|#)?(\d+)/);
  if (!match?.[1]) {
    throw new Error(`Failed to parse PR number from: ${createOutput}`);
  }

  return Number.parseInt(match[1], 10);
}

function resolveCreationTitle(subject: unknown): string {
  return typeof subject === "string" && subject.trim() ? subject.trim() : "jarvis: complete run";
}
