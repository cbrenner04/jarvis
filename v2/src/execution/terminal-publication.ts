import {
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { OpenPrNotDraftError, resolveOpenDraftPr } from "./completion-publisher.ts";
import type { PipelineTerminalAction } from "./pipeline-definition.ts";
import { normalizePublicationFailure, type PublicationFailure } from "./publication-retry.ts";
import {
  createDefaultRunReadyGate,
  type GhReadyFlip,
  type GhReadyFlipByNumber,
  type ReadyGate,
  ReadyGateError,
} from "./ready-finalize.ts";

/** Raw `gh` command runner used for pre-flip open-draft resolution (`gh pr list` / `gh pr view`). */
type GhCommand = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;

export type TerminalPublicationInput = {
  terminalAction: PipelineTerminalAction;
  worktreePath: string;
  branch: string;
  baseRef: string;
  prNumber?: number;
  prUrl?: string;
  /** Aborts in-flight `gh` calls (network-bounded regardless). */
  signal?: AbortSignal;
};

export type TerminalPublicationResult = {
  prNumber?: number;
  prUrl?: string;
};

export class TerminalPublicationError extends Error {
  constructor(
    readonly terminalAction: PipelineTerminalAction,
    readonly failure: PublicationFailure,
    readonly prNumber?: number,
    readonly prUrl?: string,
  ) {
    super(`terminal publication failed (${terminalAction}): ${failure.message}`);
    this.name = "TerminalPublicationError";
  }
}

type TerminalPublicationSeams = {
  runReadyGate?: ReadyGate;
  /** Runner backing the default ready gate when `runReadyGate` is not injected. */
  asyncSubprocessRunner?: AsyncSubprocessRunner;
  /** Raw `gh` command runner for the pre-flip open-draft re-resolution; independent of `ghReadyFlip`. */
  gh?: GhCommand;
  ghReadyFlip?: GhReadyFlipByNumber;
  ghMerge?: GhReadyFlip;
  ghClose?: GhReadyFlip;
  ghDelete?: GhReadyFlip;
};

type PublicationDeps = {
  runReadyGate: ReadyGate;
  gh: GhCommand;
  ghReadyFlip: GhReadyFlipByNumber;
  ghMerge: GhReadyFlip;
  ghClose: GhReadyFlip;
  ghDelete: GhReadyFlip;
};

const OUTPUT_TAIL_MAX_CHARS = 4096;

function wrapReadyGateFailure(error: ReadyGateError): PublicationFailure {
  const messageParts = [error.message, `gateFailureKind=${error.gateFailureKind}`];
  if (error.timedOut) messageParts.push("timedOut=true");
  if (error.outsidePaths !== undefined) {
    messageParts.push(`outsidePaths=${error.outsidePaths.join(",")}`);
  }
  const text = error.output.trim();
  const outputTail =
    text.length === 0 ? undefined : text.length > OUTPUT_TAIL_MAX_CHARS ? text.slice(-OUTPUT_TAIL_MAX_CHARS) : text;
  return {
    operation: error.command,
    message: messageParts.join("; "),
    ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
    ...(outputTail !== undefined ? { stdoutTail: outputTail } : {}),
  };
}

async function maybeDestroyPrEvidence(
  _input: TerminalPublicationInput,
  _ghClose: GhReadyFlip,
  _ghDelete: GhReadyFlip,
): Promise<void> {
  // Mutation checkpoint: closing/deleting the PR here instead of returning early discards the
  // PR evidence and must turn `retains PR evidence on ready gate failure` RED.
  return;
}

async function failTerminalPublication(
  input: TerminalPublicationInput,
  failure: PublicationFailure,
  prNumber: number,
  prUrl: string,
  ghClose: GhReadyFlip,
  ghDelete: GhReadyFlip,
): Promise<never> {
  await maybeDestroyPrEvidence(input, ghClose, ghDelete);
  throw new TerminalPublicationError(input.terminalAction, failure, prNumber, prUrl);
}

function missingPrEvidenceFailure(action: PipelineTerminalAction): TerminalPublicationError {
  return new TerminalPublicationError(action, {
    operation: action,
    message: "PR evidence required: prNumber and prUrl must be present",
  });
}

function successEvidence(input: TerminalPublicationInput): TerminalPublicationResult {
  return {
    ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
    ...(input.prUrl !== undefined ? { prUrl: input.prUrl } : {}),
  };
}

function requiresReadyOrMergePublication(input: TerminalPublicationInput): boolean {
  // Mutation checkpoint: returning true for `leave-draft` must turn the leave-draft
  // no-mutation test RED.
  return input.terminalAction === "ready" || input.terminalAction === "merge";
}

async function runReadyGateOrFail(
  input: TerminalPublicationInput,
  prNumber: number,
  prUrl: string,
  deps: PublicationDeps,
): Promise<void> {
  try {
    await deps.runReadyGate(input.worktreePath, input.baseRef);
  } catch (error) {
    // Mutation checkpoint: dropping this branch ready-flips over a red gate and must turn
    // `does not ready-flip or merge after a red ready gate` RED.
    if (error instanceof ReadyGateError) {
      await failTerminalPublication(input, wrapReadyGateFailure(error), prNumber, prUrl, deps.ghClose, deps.ghDelete);
    }
    if (!(error instanceof ReadyGateError)) throw error;
  }
}

/**
 * Re-resolves the branch's current open draft immediately before flipping, instead of trusting
 * the persisted `prNumber` this call was handed — that number can predate a terminal action
 * running long after an earlier publication reused the branch. Refuses directly with a
 * `TerminalPublicationError` on an open non-draft or no open draft at all, before `gh pr ready`
 * runs and before `failTerminalPublication`'s close/delete cleanup, which would destroy the PR
 * evidence this refusal's recovery text points the operator back to.
 */
async function resolveReadyFlipTarget(
  input: TerminalPublicationInput,
  prNumber: number,
  prUrl: string,
  deps: PublicationDeps,
): Promise<number> {
  let resolved: { number: number; url: string } | undefined;
  try {
    resolved = await resolveOpenDraftPr(deps.gh, input.worktreePath, input.branch, input.baseRef);
  } catch (error) {
    if (error instanceof OpenPrNotDraftError) {
      throw new TerminalPublicationError(
        input.terminalAction,
        { operation: "gh pr ready", message: error.message },
        prNumber,
        prUrl,
      );
    }
    throw error;
  }
  if (resolved === undefined) {
    throw new TerminalPublicationError(
      input.terminalAction,
      {
        operation: "gh pr ready",
        message: `No open draft PR found for branch ${input.branch} targeting ${input.baseRef}: nothing to flip ready.`,
      },
      prNumber,
      prUrl,
    );
  }
  return resolved.number;
}

async function runReadyFlipOrFail(
  input: TerminalPublicationInput,
  prNumber: number,
  prUrl: string,
  deps: PublicationDeps,
): Promise<void> {
  const resolvedPrNumber = await resolveReadyFlipTarget(input, prNumber, prUrl, deps);
  try {
    await deps.ghReadyFlip(resolvedPrNumber, input.worktreePath);
  } catch (error) {
    await failTerminalPublication(
      input,
      normalizePublicationFailure("gh pr ready", error),
      prNumber,
      prUrl,
      deps.ghClose,
      deps.ghDelete,
    );
  }
}

async function runMergeOrFail(
  input: TerminalPublicationInput,
  prNumber: number,
  prUrl: string,
  deps: PublicationDeps,
): Promise<void> {
  try {
    await deps.ghMerge(input.branch, input.worktreePath);
  } catch (error) {
    await failTerminalPublication(
      input,
      normalizePublicationFailure("gh pr merge", error),
      prNumber,
      prUrl,
      deps.ghClose,
      deps.ghDelete,
    );
  }
}

async function executeReadyOrMergePublication(
  input: TerminalPublicationInput,
  deps: PublicationDeps,
): Promise<TerminalPublicationResult> {
  if (input.prNumber === undefined || input.prUrl === undefined) {
    throw missingPrEvidenceFailure(input.terminalAction);
  }
  const { prNumber, prUrl } = input;

  await runReadyGateOrFail(input, prNumber, prUrl, deps);
  await runReadyFlipOrFail(input, prNumber, prUrl, deps);

  if (input.terminalAction === "merge") {
    await runMergeOrFail(input, prNumber, prUrl, deps);
  }

  return { prNumber, prUrl };
}

async function defaultGhPr(
  subcommand: "ready" | "merge",
  branch: string,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<void> {
  await realAsyncSubprocessRunner.runAsync(
    "gh",
    ["pr", subcommand, branch],
    worktreePath,
    networkSubprocessOptions({ signal }),
  );
}

async function defaultGhReadyFlipByNumber(
  prNumber: number | undefined,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<void> {
  await realAsyncSubprocessRunner.runAsync(
    "gh",
    ["pr", "ready", String(prNumber)],
    worktreePath,
    networkSubprocessOptions({ signal }),
  );
}

async function defaultGhCommand(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return (await realAsyncSubprocessRunner.runAsync("gh", [...args], cwd, networkSubprocessOptions({ signal }))).trim();
}

const noopGh: GhReadyFlip = async () => {};

export function createExecuteTerminalPublication(seams?: TerminalPublicationSeams) {
  const runReadyGate =
    seams?.runReadyGate ?? createDefaultRunReadyGate(seams?.asyncSubprocessRunner ?? realAsyncSubprocessRunner);
  const depsFor = (signal: AbortSignal | undefined): PublicationDeps => ({
    runReadyGate,
    gh: seams?.gh ?? ((cwd, args) => defaultGhCommand(cwd, args, signal)),
    ghReadyFlip:
      seams?.ghReadyFlip ?? ((prNumber, worktreePath) => defaultGhReadyFlipByNumber(prNumber, worktreePath, signal)),
    ghMerge: seams?.ghMerge ?? ((branch, worktreePath) => defaultGhPr("merge", branch, worktreePath, signal)),
    ghClose: seams?.ghClose ?? noopGh,
    ghDelete: seams?.ghDelete ?? noopGh,
  });

  return async (input: TerminalPublicationInput): Promise<TerminalPublicationResult> => {
    const deps = depsFor(input.signal);
    // Mutation checkpoint: dropping this early return mutates a leave-draft PR and must turn
    // the leave-draft no-mutation test RED.
    if (input.terminalAction === "leave-draft") {
      return successEvidence(input);
    }

    if (requiresReadyOrMergePublication(input)) {
      return executeReadyOrMergePublication(input, deps);
    }

    return successEvidence(input);
  };
}

export const executeTerminalPublication = createExecuteTerminalPublication();
