/** Outcome of one daemon `status` RPC read, tracked across ticks for revision-follow stability. */
export type DaemonRevisionReadOutcome = { kind: "success"; loadedRevision: string | undefined } | { kind: "failure" };

/** Revision-follow re-exec decision; `reexec: true` carries the stable daemon revision to record as the re-exec marker. */
type TuiRevisionFollowDecision = { reexec: false } | { reexec: true; daemonRevision: string };

/**
 * The daemon revision observed identically on two consecutive successful, non-`unknown` status
 * reads; `undefined` when not yet stable (no prior read, a failed read on either side, or a
 * differing/`unknown`/absent revision).
 */
function stableDaemonRevision(
  previousRead: DaemonRevisionReadOutcome | undefined,
  currentRead: DaemonRevisionReadOutcome,
): string | undefined {
  // Mutation checkpoint: loosening any of these three guards must turn "no-prior-read/failed-read never stabilizes" RED.
  if (previousRead === undefined || previousRead.kind !== "success" || currentRead.kind !== "success") {
    return undefined;
  }
  const revision = currentRead.loadedRevision;
  // Mutation checkpoint: dropping either disjunct must turn "unknown/absent daemon revision never stabilizes" RED.
  if (revision === undefined || revision === "unknown") return undefined;
  // Mutation checkpoint: negating this equality must turn "differing consecutive reads never stabilize" RED.
  if (previousRead.loadedRevision !== revision) return undefined;
  return revision;
}

/**
 * Decides whether the TUI monitor should re-exec onto current code, per `v2/docs/tui.md` §
 * Stable connection and reconnection.
 *
 * @param monitorRevision This process's own loaded revision (`"unknown"` when unresolved).
 * @param previousRead The prior status read outcome; `undefined` at connect, before any prior read.
 * @param currentRead This tick's status read outcome.
 * @param dockInputEmpty Whether the command-editor dock buffer is empty.
 * @param dispatchPending Whether a command dispatch (approve/reject/resume/steering/admission) is in flight.
 * @param reexecedForRevision The daemon revision this process already re-exec'd for, if any.
 */
export function decideTuiRevisionReexec(
  monitorRevision: string,
  previousRead: DaemonRevisionReadOutcome | undefined,
  currentRead: DaemonRevisionReadOutcome,
  dockInputEmpty: boolean,
  dispatchPending: boolean,
  reexecedForRevision: string | undefined,
): TuiRevisionFollowDecision {
  const daemonRevision = stableDaemonRevision(previousRead, currentRead);
  if (daemonRevision === undefined) return { reexec: false };
  // Mutation checkpoint: dropping either disjunct must turn "unknown monitor revision" / "matching revisions" RED.
  if (monitorRevision === "unknown" || monitorRevision === daemonRevision) return { reexec: false };
  // Mutation checkpoint: dropping either disjunct must turn "non-empty dock input" / "pending dispatch" defer RED.
  if (!dockInputEmpty || dispatchPending) return { reexec: false };
  // Mutation checkpoint: negating this equality must turn the once-per-revision guard RED.
  if (reexecedForRevision === daemonRevision) return { reexec: false };
  return { reexec: true, daemonRevision };
}
