import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { PipelineTerminalAction } from "./pipeline-definition.ts";
import {
  normalizePublicationFailure,
  type PublicationFailure,
} from "./publication-retry.ts";
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

const OUTPUT_TAIL_MAX_CHARS = 4096;

let invertLeaveDraftNoMutationGuardForTest = false;
let invertRedGateBeforeFlipGuardForTest = false;
let invertFailurePreservationGuardForTest = false;

export function setInvertLeaveDraftNoMutationGuardForTest(value: boolean): void {
  invertLeaveDraftNoMutationGuardForTest = value;
}

export function setInvertRedGateBeforeFlipGuardForTest(value: boolean): void {
  invertRedGateBeforeFlipGuardForTest = value;
}

export function setInvertFailurePreservationGuardForTest(value: boolean): void {
  invertFailurePreservationGuardForTest = value;
}

function wrapReadyGateFailure(error: ReadyGateError): PublicationFailure {
  const messageParts = [error.message, `gateFailureKind=${error.gateFailureKind}`];
  if (error.timedOut) messageParts.push("timedOut=true");
  if (error.outsidePaths !== undefined) {
    messageParts.push(`outsidePaths=${error.outsidePaths.join(",")}`);
  }
  const text = error.output.trim();
  const outputTail =
    text.length === 0
      ? undefined
      : text.length > OUTPUT_TAIL_MAX_CHARS
        ? text.slice(-OUTPUT_TAIL_MAX_CHARS)
        : text;
  return {
    operation: error.command,
    message: messageParts.join("; "),
    ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
    ...(outputTail !== undefined ? { stdoutTail: outputTail } : {}),
  };
}

async function maybeDestroyPrEvidence(
  input: TerminalPublicationInput,
  ghClose: GhReadyFlip,
  ghDelete: GhReadyFlip,
): Promise<void> {
  if (!invertFailurePreservationGuardForTest) return;
  await ghClose(input.branch, input.worktreePath);
  await ghDelete(input.branch, input.worktreePath);
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

async function defaultGhPr(subcommand: "ready" | "merge", branch: string, worktreePath: string): Promise<void> {
  await realAsyncSubprocessRunner.runAsync("gh", ["pr", subcommand, branch], worktreePath);
}

async function defaultRunReadyGate(): Promise<void> {
  throw new Error("runReadyGate seam is required for ready and merge terminal actions");
}

const noopGh: GhReadyFlip = async () => {};

export function createExecuteTerminalPublication(seams?: TerminalPublicationSeams) {
  const runReadyGate = seams?.runReadyGate ?? defaultRunReadyGate;
  const ghReadyFlip = seams?.ghReadyFlip ?? ((branch, worktreePath) => defaultGhPr("ready", branch, worktreePath));
  const ghMerge = seams?.ghMerge ?? ((branch, worktreePath) => defaultGhPr("merge", branch, worktreePath));
  const ghClose = seams?.ghClose ?? noopGh;
  const ghDelete = seams?.ghDelete ?? noopGh;

  return async (input: TerminalPublicationInput): Promise<TerminalPublicationResult> => {
    if (input.terminalAction === "leave-draft" && !invertLeaveDraftNoMutationGuardForTest) {
      return successEvidence(input);
    }

    if (input.terminalAction === "ready" || input.terminalAction === "merge" || invertLeaveDraftNoMutationGuardForTest) {
      if (input.prNumber === undefined || input.prUrl === undefined) {
        throw missingPrEvidenceFailure(input.terminalAction);
      }
      const { prNumber, prUrl } = input;

      try {
        await runReadyGate(input.worktreePath, input.baseRef);
      } catch (error) {
        if (error instanceof ReadyGateError && !invertRedGateBeforeFlipGuardForTest) {
          await failTerminalPublication(input, wrapReadyGateFailure(error), prNumber, prUrl, ghClose, ghDelete);
        }
        if (!(error instanceof ReadyGateError)) throw error;
      }

      try {
        await ghReadyFlip(input.branch, input.worktreePath);
      } catch (error) {
        await failTerminalPublication(
          input,
          normalizePublicationFailure("gh pr ready", error),
          prNumber,
          prUrl,
          ghClose,
          ghDelete,
        );
      }

      if (input.terminalAction === "merge") {
        try {
          await ghMerge(input.branch, input.worktreePath);
        } catch (error) {
          await failTerminalPublication(
            input,
            normalizePublicationFailure("gh pr merge", error),
            prNumber,
            prUrl,
            ghClose,
            ghDelete,
          );
        }
      }

      return { prNumber, prUrl };
    }

    return successEvidence(input);
  };
}

export const executeTerminalPublication = createExecuteTerminalPublication();
