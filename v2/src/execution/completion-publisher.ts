import { branchExistsOnOriginAsync, getBaseBranch } from "../../../shared/git.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { type RefreshPrBodyInput, refreshPrBody } from "./pr-body-refresh.ts";
import {
  defaultPublicationDelay,
  defaultPublicationRetryNotice,
  runPublicationWithRetry,
} from "./publication-retry.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";

export type CompletionPublisherInput = {
  worktreePath: string;
  baseRef: string;
  specPath: string;
  branch: string;
  creationTitle?: unknown;
  bodySummary?: string;
  specTemplate?: boolean;
  narrative?: string;
};

export type CompletionPublisherResult = {
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
  env?: Record<string, string>,
): Promise<string> {
  return realAsyncSubprocessRunner
    .runAsync(command, [...args], cwd, { env: { ...process.env, ...env } })
    .then((stdout) => stdout.trim());
}

const defaultGit: Git = (cwd, args, env) => defaultCommand("git", cwd, args, env);
const defaultGh: GhCommand = (cwd, args, env) => defaultCommand("gh", cwd, args, env);

/** Publishes completion commit: push to origin and ensure open draft PR. Retryable on transient failures. */
export function createCompletionPublisher(seams?: Partial<PublisherSeams>): CompletionPublisher {
  const git = seams?.git ?? defaultGit;
  const gh = seams?.gh ?? defaultGh;
  const delay = seams?.delay ?? defaultPublicationDelay;
  const retryNotice = seams?.retryNotice ?? defaultPublicationRetryNotice;

  return async (input) => {
    const specPath = normalizePublicationSpecPath(input.worktreePath, input.specPath);
    const subprocessRunner = seams?.subprocessRunner ?? realAsyncSubprocessRunner;
    const requestedBaseRef = input.baseRef;
    let effectiveBaseRef = requestedBaseRef;
    if (!(await branchExistsOnOriginAsync(input.worktreePath, requestedBaseRef, subprocessRunner))) {
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
          const hasUpstream = await checkHasUpstream(git, input.worktreePath, input.branch);
          if (hasUpstream) {
            await git(input.worktreePath, ["push"]);
          } else {
            await git(input.worktreePath, ["push", "-u", "origin", input.branch]);
          }
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

async function checkHasUpstream(git: Git, worktreePath: string, branch: string): Promise<boolean> {
  try {
    await git(worktreePath, ["rev-parse", `${branch}@{u}`]);
    return true;
  } catch {
    return false;
  }
}

type PrEvidence = {
  number: number;
  url: string;
};

async function findMatchingPr(
  gh: GhCommand,
  cwd: string,
  branch: string,
  baseRef: string,
  state: "open" | "merged",
): Promise<number | undefined> {
  const prListJson = await gh(cwd, ["pr", "list", "--head", branch, "--state", state, "--json", "number,baseRefName"]);
  const prs = JSON.parse(prListJson) as Array<{ number: number; baseRefName: string }>;
  return prs.find((pr) => pr.baseRefName === baseRef)?.number;
}

async function findOrCreatePr(
  gh: GhCommand,
  cwd: string,
  baseRef: string,
  branch: string,
  specPath: string,
  creationTitle: string,
): Promise<PrEvidence> {
  const openPr = await findMatchingPr(gh, cwd, branch, baseRef, "open");
  if (openPr !== undefined) {
    return confirmPr(gh, cwd, branch, baseRef, openPr);
  }

  const mergedPr = await findMatchingPr(gh, cwd, branch, baseRef, "merged");
  if (mergedPr !== undefined) {
    return confirmPr(gh, cwd, branch, baseRef, mergedPr);
  }

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

  return confirmPr(gh, cwd, branch, baseRef);
}

async function confirmPr(
  gh: GhCommand,
  cwd: string,
  branch: string,
  baseRef: string,
  expectedNumber?: number,
): Promise<PrEvidence> {
  const prViewJson = await gh(cwd, ["pr", "view", branch, "--json", "number,url,baseRefName"]);
  const pr = JSON.parse(prViewJson) as { number: number; url: string; baseRefName: string };

  if (expectedNumber !== undefined && pr.number !== expectedNumber) {
    throw new Error(`Confirmed PR number ${pr.number} does not match expected number ${expectedNumber}`);
  }

  if (pr.baseRefName !== baseRef) {
    throw new Error(`PR base ${pr.baseRefName} does not match requested base ${baseRef}`);
  }

  return { number: pr.number, url: pr.url };
}
