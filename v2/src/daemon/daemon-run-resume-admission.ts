import {
  INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED,
  resolveCompletionCommitFailedResumeContext,
  resolveExhaustedRedResumeContext,
  resolveIntentFinalizationResumeContext,
  resolveReviewMutationResumeContext,
  resolveWriteNonTerminatingResumeContext,
  resolveWriteOutOfScopeResumeContext,
} from "../execution/workflow-runner-resume.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import type { Attempt, Run, StateStore } from "../persistence/state-store.ts";
import type { ResolvedWriteLoopInput } from "./daemon.ts";
import { composeRunOperatorError, type TerminalLogRecord } from "./run-operator-error.ts";

export type RunResumeAdmission =
  | { admitted: true }
  | { admitted: false; refusal: "terminal" | "unsupported"; message?: string };

type RunResumeAdmissionDeps = {
  store: StateStore;
  reconstructWriteResume: (run: Run, logRecords?: readonly PersistedRecord[]) => ResolvedWriteLoopInput;
};

function isIntentFinalizationResumable(run: Run & { attempts?: Attempt[] }, store: StateStore): boolean {
  return resolveIntentFinalizationResumeContext({ ...run, attempts: run.attempts ?? [] }, store).ok;
}

function isReviewMutationResumable(
  run: Run & { attempts?: Attempt[] },
  store: StateStore,
  terminalRecord: TerminalLogRecord | undefined,
): boolean {
  return resolveReviewMutationResumeContext({ ...run, attempts: run.attempts ?? [] }, store, terminalRecord).ok;
}

function isFinalizationTailResumable(
  run: Run & { attempts?: Attempt[] },
  store: StateStore,
  terminalRecord: TerminalLogRecord | undefined,
): boolean {
  const runWithAttempts = { ...run, attempts: run.attempts ?? [] };
  return (
    isReviewMutationResumable(run, store, terminalRecord) ||
    resolveExhaustedRedResumeContext(runWithAttempts, store, terminalRecord).ok ||
    resolveWriteOutOfScopeResumeContext(runWithAttempts, store, terminalRecord).ok ||
    resolveWriteNonTerminatingResumeContext(runWithAttempts, store, terminalRecord).ok ||
    resolveCompletionCommitFailedResumeContext(runWithAttempts, store, terminalRecord).ok
  );
}

/** Same admission answer as `run resume`, `list` resumable, and `wait` resumable. */
export function resolveRunResumeAdmission(
  run: Run & { attempts?: Attempt[] },
  terminalRecord: TerminalLogRecord | undefined,
  logRecords: readonly PersistedRecord[] | undefined,
  deps: RunResumeAdmissionDeps,
): RunResumeAdmission {
  const intentFinalization = resolveIntentFinalizationResumeContext(
    { ...run, attempts: run.attempts ?? [] },
    deps.store,
  );
  if (intentFinalization.ok) {
    return { admitted: true };
  }
  if (intentFinalization.message === INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED) {
    return { admitted: false, refusal: "unsupported", message: intentFinalization.message };
  }
  if (isFinalizationTailResumable(run, deps.store, terminalRecord)) {
    return { admitted: true };
  }

  const operatorError = composeRunOperatorError(
    { ...run, attempts: run.attempts ?? [] },
    terminalRecord,
    logRecords === undefined ? undefined : [...logRecords],
  );
  if (operatorError?.nextAction !== "resume") {
    return { admitted: false, refusal: "terminal" };
  }

  const reconstructed = deps.reconstructWriteResume(run, logRecords);
  if (!reconstructed.ok) {
    return { admitted: false, refusal: "unsupported", message: reconstructed.message };
  }
  return { admitted: true };
}

export { isFinalizationTailResumable, isIntentFinalizationResumable };
