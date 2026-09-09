import type { PipelineSnapshot } from "./pipeline-observation.ts";

function countEndedStages(snapshot: PipelineSnapshot): number {
  return snapshot.stages.filter((stage) => stage.endedAt !== null).length;
}

/** True when `candidate` outranks `current` for the same pipelineId: finished beats unfinished, then more ended stages, then earlier socket path. */
function pipelineSnapshotOutranks(
  candidate: PipelineSnapshot,
  candidateSocketPath: string,
  current: PipelineSnapshot,
  currentSocketPath: string,
): boolean {
  const candidateFinished = candidate.finishedAtMs !== null;
  const currentFinished = current.finishedAtMs !== null;
  if (candidateFinished !== currentFinished) return candidateFinished;
  const candidateEndedCount = countEndedStages(candidate);
  const currentEndedCount = countEndedStages(current);
  if (candidateEndedCount !== currentEndedCount) return candidateEndedCount > currentEndedCount;
  return candidateSocketPath < currentSocketPath;
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
      if (pipelineSnapshotOutranks(snapshot, socketPath, current.snapshot, current.socketPath)) {
        winnerByPipelineId.set(snapshot.pipelineId, { snapshot, socketPath });
      }
    }
  }
  return [...winnerByPipelineId.values()].map(({ snapshot }) => snapshot);
}
