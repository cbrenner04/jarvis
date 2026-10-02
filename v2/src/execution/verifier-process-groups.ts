import { isForeignProcessGroup, ownProcessGroupIds } from "../../../shared/process-group-predicate.ts";
import type { StateStore } from "../persistence/state-store.ts";

export { isForeignProcessGroup, ownProcessGroupIds };

/**
 * Durable run-row binding for verifier spawns and bounded implement agent invocations. Agents also
 * record foreign descendant groups captured on kill paths. Invocation settlement clears each id;
 * daemon startup sweep and live run kill signal the same recorded ids.
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
        if (!isForeignProcessGroup(pgid)) return; // child shares our group: never record it
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
