import { execFile } from "node:child_process";
import { type RefreshPrBodyInput, refreshPrBody } from "./pr-body-refresh.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";

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

type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;
type GhCommand = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;
type GhReady = (cwd: string) => Promise<boolean>;
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

function defaultGit(cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function defaultGh(cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

async function defaultGhReady(cwd: string): Promise<boolean> {
  try {
    await defaultGh(cwd, ["auth", "status"]);
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

    if (!(await ghReady(input.worktreePath))) {
      throw new Error("GitHub auth unavailable; cannot publish PR");
    }

    const result: CompletionPublisherResult = {};

    const pushSha = await publishWithRetry(
      async () => {
        const hasUpstream = await checkHasUpstream(git, input.worktreePath, input.branch);
        if (hasUpstream) {
          await git(input.worktreePath, ["push"]);
        } else {
          await git(input.worktreePath, ["push", "-u", "origin", input.branch]);
        }
        return await git(input.worktreePath, ["rev-parse", "HEAD"]);
      },
      "push",
      delay,
      retryNotice,
    );

    if (pushSha) {
      result.pushSha = pushSha;
    }

    const creationTitle = resolvePublicationTitle(input.worktreePath, input.specPath, input.creationTitle);
    const prNumber = await publishWithRetry(
      () => findOrCreatePr(gh, input.worktreePath, input.baseRef, input.branch, specPath, creationTitle),
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

async function checkHasUpstream(git: Git, worktreePath: string, branch: string): Promise<boolean> {
  try {
    await git(worktreePath, ["rev-parse", `${branch}@{u}`]);
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

async function findOrCreatePr(
  gh: GhCommand,
  cwd: string,
  baseRef: string,
  branch: string,
  specPath: string,
  creationTitle: string,
): Promise<number> {
  const prListJson = await gh(cwd, ["pr", "list", "--head", branch, "--state", "open", "--json", "number,baseRefName"]);
  const prs = JSON.parse(prListJson) as Array<{ number: number; baseRefName: string }>;

  const matching = prs.filter((pr) => pr.baseRefName === baseRef);

  if (matching.length > 0 && matching[0]) {
    return matching[0].number;
  }

  const createOutput = await gh(cwd, [
    "pr",
    "create",
    "--draft",
    "--base",
    baseRef,
    "--title",
    creationTitle,
    "--body",
    `Spec: ${specPath}`,
  ]);

  const match = createOutput.match(/(?:pull\/|#)?(\d+)/);
  if (!match?.[1]) {
    throw new Error(`Failed to parse PR number from: ${createOutput}`);
  }

  return Number.parseInt(match[1], 10);
}
