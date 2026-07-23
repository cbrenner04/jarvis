import type { DaemonListRunRow } from "./daemon-wire.ts";

/** Merge run lists from multiple daemon results, preferring isLive rows, optionally tracking owners. */
export function mergeRunLists<T>(results: Array<[T, DaemonListRunRow[] | undefined]>): {
  runs: DaemonListRunRow[];
  owners: Map<string, T>;
} {
  const deduped = new Map<string, DaemonListRunRow>();
  const owners = new Map<string, T>();

  for (const [owner, rows] of results) {
    if (!rows) continue;
    for (const row of rows) {
      const existing = deduped.get(row.runId);
      if (!existing || (row.isLive && !existing.isLive)) {
        deduped.set(row.runId, row);
        owners.set(row.runId, owner);
      }
    }
  }

  const runs = Array.from(deduped.values()).sort((a, b) => a.runId.localeCompare(b.runId));
  return { runs, owners };
}
