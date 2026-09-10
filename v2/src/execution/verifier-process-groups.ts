import type { StateStore } from "../persistence/state-store.ts";

/**
 * Durable binding for finalization verifier spawns: every detached `bun` tree the ready gate,
 * required-integration scope, diff-derived mutation verifier, runtime smoke probe, or base-ref
 * reproduction probe launches records its process group on the owning run row at spawn and
 * clears exactly that id when the spawn settles. Daemon-startup sweep and live kill signal the
 * recorded ids, so an unrecorded spawn is an orphan-in-waiting.
 */
export type VerifierProcessGroupRecorder = {
  record: (pgid: number) => void;
  clear: (pgid: number) => void;
};

export function storeVerifierProcessGroupRecorder(store: StateStore, runId: string): VerifierProcessGroupRecorder {
  return {
    record: (pgid) => store.recordVerifierProcessGroup(runId, pgid),
    clear: (pgid) => store.clearVerifierProcessGroup(runId, pgid),
  };
}

type TrackedProcessGroup = {
  /** Pass as the subprocess `processGroup` option: detaches the child and records its group id. */
  processGroup: { onGroupId: (pgid: number) => void };
  /** Call in the spawn's `finally`: clears the recorded id (idempotent, never throws). */
  settle: () => void;
};

/**
 * One spawn's binding to the run's recorder. Recorder failures (e.g. a closed store handle) are
 * swallowed so they can neither leave a just-spawned group unbound nor replace an in-flight
 * verifier failure with a misattributed one from inside a `finally`.
 */
export function trackProcessGroup(recorder: VerifierProcessGroupRecorder | undefined): TrackedProcessGroup {
  let recorded: number | undefined;
  return {
    processGroup: {
      onGroupId: (pgid) => {
        recorded = pgid;
        try {
          recorder?.record(pgid);
        } catch {
          // recorder failures must not unbind an already-spawned group
        }
      },
    },
    settle: () => {
      if (recorded === undefined) return;
      const pgid = recorded;
      recorded = undefined;
      try {
        recorder?.clear(pgid);
      } catch {
        // recorder failures must not override the verifier outcome
      }
    },
  };
}
