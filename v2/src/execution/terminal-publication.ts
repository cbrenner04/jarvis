import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { PipelineTerminalAction } from "./pipeline-definition.ts";
import { normalizePublicationFailure, type PublicationFailure } from "./publication-retry.ts";
import { type GhReadyFlip, type ReadyGate, ReadyGateError } from "./ready-finalize.ts";

export type TerminalPublicationInput = {
  terminalAction: PipelineTerminalAction;
  worktreePath: string;
  branch: string;
  baseRef: string;
  prNumber?: number;
  prUrl?: string;
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

export type TerminalPublicationSeams = {
  runReadyGate?: ReadyGate;
  ghReadyFlip?: GhReadyFlip;
  ghMerge?: GhReadyFlip;
  ghClose?: GhReadyFlip;
  ghDelete?: GhReadyFlip;
};

type PublicationDeps = {
  runReadyGate: ReadyGate;
  ghReadyFlip: GhReadyFlip;
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

async function runReadyFlipOrFail(
  input: TerminalPublicationInput,
  prNumber: number,
  prUrl: string,
  deps: PublicationDeps,
): Promise<void> {
  try {
    await deps.ghReadyFlip(input.branch, input.worktreePath);
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

async function defaultGhPr(subcommand: "ready" | "merge", branch: string, worktreePath: string): Promise<void> {
  await realAsyncSubprocessRunner.runAsync("gh", ["pr", subcommand, branch], worktreePath);
}

async function defaultRunReadyGate(): Promise<void> {
  throw new Error("runReadyGate seam is required for ready and merge terminal actions");
}

const noopGh: GhReadyFlip = async () => {};

export function createExecuteTerminalPublication(seams?: TerminalPublicationSeams) {
  const deps: PublicationDeps = {
    runReadyGate: seams?.runReadyGate ?? defaultRunReadyGate,
    ghReadyFlip: seams?.ghReadyFlip ?? ((branch, worktreePath) => defaultGhPr("ready", branch, worktreePath)),
    ghMerge: seams?.ghMerge ?? ((branch, worktreePath) => defaultGhPr("merge", branch, worktreePath)),
    ghClose: seams?.ghClose ?? noopGh,
    ghDelete: seams?.ghDelete ?? noopGh,
  };

  return async (input: TerminalPublicationInput): Promise<TerminalPublicationResult> => {
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
