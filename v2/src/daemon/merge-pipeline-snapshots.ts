import type { PipelineSnapshot } from "./pipeline-observation.ts";

function countEndedStages(snapshot: PipelineSnapshot): number {
  return snapshot.stages.filter((stage) => stage.endedAt !== null).length;
}

/** True when `candidate` outranks `current` for the same pipelineId: finished beats unfinished, then more
 * ended stages. Earlier socket path wins ties structurally rather than by comparison: callers iterate socket
 * paths in sorted order, so `current` was always recorded from an earlier path and a tie must not displace it. */
function pipelineSnapshotOutranks(candidate: PipelineSnapshot, current: PipelineSnapshot): boolean {
  const candidateFinished = candidate.finishedAtMs !== null;
  const currentFinished = current.finishedAtMs !== null;
  if (candidateFinished !== currentFinished) return candidateFinished;
  const candidateEndedCount = countEndedStages(candidate);
  const currentEndedCount = countEndedStages(current);
  if (candidateEndedCount !== currentEndedCount) return candidateEndedCount > currentEndedCount;
  return false;
}

/** One snapshot per pipelineId, sorted-socket-path emission order, collision winner via `pipelineSnapshotOutranks`. */
export function mergePipelineSnapshots(
  pipelineSnapshotsBySocketPath: Readonly<Record<string, readonly PipelineSnapshot[]>> | undefined,
): PipelineSnapshot[] {
  if (pipelineSnapshotsBySocketPath === undefined) return [];
  const winnerByPipelineId = new Map<string, { snapshot: PipelineSnapshot; socketPath: string }>();
  for (const socketPath of Object.keys(pipelineSnapshotsBySocketPath).sort()) {
    for (const snapshot of pipelineSnapshotsBySocketPath[socketPath] ?? []) {
      const current = winnerByPipelineId.get(snapshot.pipelineId);
      if (current === undefined) {
        winnerByPipelineId.set(snapshot.pipelineId, { snapshot, socketPath });
        continue;
      }
      if (pipelineSnapshotOutranks(snapshot, current.snapshot)) {
        winnerByPipelineId.set(snapshot.pipelineId, { snapshot, socketPath });
      }
    }
  }
  return [...winnerByPipelineId.values()].map(({ snapshot }) => snapshot);
}
