import { errorMessage } from "../../../shared/error-message.ts";
import { branchExistsOnOriginAsync, getBaseBranch } from "../../../shared/git.ts";
import {
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { type ExternalSpecGitScope, externalSpecGitScope } from "./external-spec-git.ts";
import { type RefreshPrBodyInput, refreshPrBody } from "./pr-body-refresh.ts";
import {
  defaultPublicationDelay,
  defaultPublicationRetryNotice,
  runPublicationWithRetry,
} from "./publication-retry.ts";
import { formatPublicationSpecPathForPrBody } from "./publication-spec-path.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";

export type CompletionPublisherInput = ExternalSpecGitScope & {
  worktreePath: string;
  baseRef: string;
  specPath: string;
  branch: string;
  creationTitle?: unknown;
  bodySummary?: string;
  specTemplate?: boolean;
  narrative?: string;
  /** Run abort signal: aborts in-flight push/PR calls (network-bounded regardless). */
  signal?: AbortSignal;
};

type CompletionPublisherResult = {
  pushSha?: string;
  prNumber?: number;
  prUrl?: string;
  requestedBase?: string;
  resolvedBase?: string;
};

export type CompletionPublisher = (input: CompletionPublisherInput) => Promise<CompletionPublisherResult>;

type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;
type GhCommand = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;
type Delay = (ms: number) => Promise<void>;
type RetryNotice = (message: string) => void;

type FetchPrBody = RefreshPrBodyInput["fetchPrBody"];
type WritePrBody = RefreshPrBodyInput["writePrBody"];
type RenderFooter = NonNullable<RefreshPrBodyInput["renderFooter"]>;

type PublisherSeams = {
  git: Git;
  gh: GhCommand;
  delay: Delay;
  retryNotice: RetryNotice;
  fetchPrBody?: FetchPrBody;
  writePrBody?: WritePrBody;
  renderFooter?: RenderFooter;
  subprocessRunner?: AsyncSubprocessRunner;
};

function defaultCommand(
  command: string,
  cwd: string,
  args: readonly string[],
  env: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  return realAsyncSubprocessRunner
    .runAsync(command, [...args], cwd, networkSubprocessOptions({ env: { ...process.env, ...env }, signal }))
    .then((stdout) => stdout.trim());
}

/** Publishes completion commit: push to origin and ensure open draft PR. Retryable on transient failures. */
export function createCompletionPublisher(seams?: Partial<PublisherSeams>): CompletionPublisher {
  const delay = seams?.delay ?? defaultPublicationDelay;
  const retryNotice = seams?.retryNotice ?? defaultPublicationRetryNotice;

  return async (input) => {
    const git: Git = seams?.git ?? ((cwd, args, env) => defaultCommand("git", cwd, args, env, input.signal));
    const gh: GhCommand = seams?.gh ?? ((cwd, args, env) => defaultCommand("gh", cwd, args, env, input.signal));
    const specPath = formatPublicationSpecPathForPrBody(input.worktreePath, input.specPath);
    const subprocessRunner = seams?.subprocessRunner ?? realAsyncSubprocessRunner;
    const requestedBaseRef = input.baseRef;
    let effectiveBaseRef = requestedBaseRef;
    const baseOnOrigin = await runPublicationWithRetry(
      "base-resolve",
      () => branchExistsOnOriginAsync(input.worktreePath, requestedBaseRef, subprocessRunner),
      { delay, retryNotice },
    );
    if (!baseOnOrigin) {
      effectiveBaseRef = await getBaseBranch(input.worktreePath, subprocessRunner);
    }
    const retargetMeta =
      effectiveBaseRef !== requestedBaseRef
        ? { requestedBase: requestedBaseRef, resolvedBase: effectiveBaseRef }
        : undefined;

    const result: CompletionPublisherResult = {};

    try {
      const pushSha = await runPublicationWithRetry(
        "push",
        async () => {
          await git(input.worktreePath, ["push", "origin", `HEAD:refs/heads/${input.branch}`]);
          return await git(input.worktreePath, ["rev-parse", "HEAD"]);
        },
        { delay, retryNotice },
      );

      if (pushSha) {
        result.pushSha = pushSha;
      }

      const creationTitle = resolvePublicationTitle(input.worktreePath, input.specPath, input.creationTitle);
      const prEvidence = await runPublicationWithRetry(
        "pr",
        () => findOrCreatePr(gh, input.worktreePath, effectiveBaseRef, input.branch, specPath, creationTitle),
        { delay, retryNotice },
      );

      if (prEvidence) {
        result.prNumber = prEvidence.number;
        result.prUrl = prEvidence.url;
      }

      await runPublicationWithRetry(
        "pr-body-refresh",
        async () => {
          const bodySummary = input.specTemplate
            ? await deriveSpecRunBodySummary({
                worktreePath: input.worktreePath,
                specPath: input.specPath,
                baseRef: effectiveBaseRef,
                git: async (cwd, args) => git(cwd, args),
                ...externalSpecGitScope(input),
              })
            : input.bodySummary;
          await refreshPrBody({
            specPath,
            branch: input.branch,
            base: effectiveBaseRef,
            cwd: input.worktreePath,
            git,
            ...(bodySummary !== undefined ? { bodySummary } : {}),
            ...(input.narrative !== undefined ? { narrative: input.narrative } : {}),
            ...(seams?.fetchPrBody !== undefined ? { fetchPrBody: seams.fetchPrBody } : {}),
            ...(seams?.writePrBody !== undefined ? { writePrBody: seams.writePrBody } : {}),
            ...(input.signal !== undefined ? { signal: input.signal } : {}),
            ...(seams?.renderFooter !== undefined ? { renderFooter: seams.renderFooter } : {}),
          });
          return true;
        },
        { delay, retryNotice },
      );

      if (retargetMeta !== undefined) {
        result.requestedBase = retargetMeta.requestedBase;
        result.resolvedBase = retargetMeta.resolvedBase;
      }
      return result;
    } catch (error) {
      if (retargetMeta !== undefined) {
        if (error instanceof Error) {
          throw Object.assign(error, retargetMeta);
        }
        throw Object.assign(new Error(String(error)), retargetMeta);
      }
      throw error;
    }
  };
}

type PrEvidence = {
  number: number;
  url: string;
};

type OpenPrRecord = { number: number; baseRefName: string; isDraft?: boolean };

/** Raised when a branch carries more than one open PR matching the same base; no safe default to pick. */
export class AmbiguousOpenPrError extends Error {
  readonly numbers: readonly number[];

  constructor(branch: string, baseRef: string, numbers: readonly number[]) {
    super(
      `Branch ${branch} has ${numbers.length} open PRs targeting ${baseRef} (${numbers.map((n) => `#${n}`).join(", ")}); resolve to one before publishing.`,
    );
    this.name = "AmbiguousOpenPrError";
    this.numbers = numbers;
  }
}

/** Raised when the matching open PR has already left draft state; reusing it would misrepresent it. */
export class OpenPrNotDraftError extends Error {
  readonly number: number;

  constructor(number: number, branch: string) {
    super(
      `PR #${number} for branch ${branch} is open but not a draft (expected draft). Mark it draft again, or close/merge it, before publishing.`,
    );
    this.name = "OpenPrNotDraftError";
    this.number = number;
  }
}

/** Raised when `gh pr create` reports no diff between branch and base; a reused branch with no publishable commits. */
class NoPublishableCommitsError extends Error {
  constructor(branch: string, baseRef: string) {
    super(`No publishable commits between ${branch} and ${baseRef}: nothing to open a PR from.`);
    this.name = "NoPublishableCommitsError";
  }
}

async function listMatchingOpenPrs(
  gh: GhCommand,
  cwd: string,
  branch: string,
  baseRef: string,
): Promise<OpenPrRecord[]> {
  const prListJson = await gh(cwd, [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number,baseRefName,isDraft",
  ]);
  const prs = JSON.parse(prListJson) as OpenPrRecord[];
  return prs.filter((pr) => pr.baseRefName === baseRef);
}

/**
 * Resolve the open PR matching branch/base, ignoring merged/closed history. Returns `undefined`
 * when none matches. Refuses when more than one matches (no safe default) or when the sole match
 * has left draft state (reusing it would misrepresent it as still in progress).
 */
export async function resolveOpenDraftPr(
  gh: GhCommand,
  cwd: string,
  branch: string,
  baseRef: string,
): Promise<PrEvidence | undefined> {
  const matches = await listMatchingOpenPrs(gh, cwd, branch, baseRef);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new AmbiguousOpenPrError(
      branch,
      baseRef,
      matches.map((pr) => pr.number),
    );
  }

  const match = matches[0];
  if (match === undefined) return undefined;
  if (match.isDraft === false) {
    throw new OpenPrNotDraftError(match.number, branch);
  }

  return confirmPr(gh, cwd, branch, baseRef, match.number);
}

async function createDraftPr(
  gh: GhCommand,
  cwd: string,
  baseRef: string,
  branch: string,
  specPath: string,
  creationTitle: string,
): Promise<void> {
  try {
    await gh(cwd, [
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
  } catch (error) {
    const message = errorMessage(error);
    if (/no commits between/i.test(message)) {
      throw new NoPublishableCommitsError(branch, baseRef);
    }
    throw error;
  }
}

async function findOrCreatePr(
  gh: GhCommand,
  cwd: string,
  baseRef: string,
  branch: string,
  specPath: string,
  creationTitle: string,
): Promise<PrEvidence> {
  const existing = await resolveOpenDraftPr(gh, cwd, branch, baseRef);
  if (existing !== undefined) return existing;

  await createDraftPr(gh, cwd, baseRef, branch, specPath, creationTitle);

  return confirmPr(gh, cwd, branch, baseRef);
}

async function confirmPr(
  gh: GhCommand,
  cwd: string,
  branch: string,
  baseRef: string,
  expectedNumber?: number,
): Promise<PrEvidence> {
  // Confirm by number once `resolveOpenDraftPr` has selected one. `gh pr view <branch>` resolves
  // its own notion of "the" PR for a branch and honors no state filter, so on a branch carrying
  // more than one PR it can return a different PR than the open/base-filtered list selected — an
  // open PR on another base, for instance. Comparing one lookup against a differently-scoped
  // lookup then fails on branches whose PR history is longer than one, which is every branch a
  // pipeline has been re-run on. Addressing the PR by number has no such disagreement to resolve.
  const selector = expectedNumber === undefined ? branch : String(expectedNumber);
  const prViewJson = await gh(cwd, ["pr", "view", selector, "--json", "number,url,baseRefName"]);
  const pr = JSON.parse(prViewJson) as { number: number; url: string; baseRefName: string };

  if (pr.baseRefName !== baseRef) {
    throw new Error(`PR base ${pr.baseRefName} does not match requested base ${baseRef}`);
  }

  return { number: pr.number, url: pr.url };
}
