import type { DaemonListRunRow } from "./daemon-wire.ts";

/**
 * Merge runs from multiple daemons into a deduplicated list.
 * When the same run ID appears across daemons, prefers the daemon that reports it `isLive`.
 */
export function mergeRunLists(rows: Array<readonly DaemonListRunRow[]>): DaemonListRunRow[] {
  const deduped = new Map<string, DaemonListRunRow>();

  for (const list of rows) {
    for (const row of list) {
      const existing = deduped.get(row.runId);
      if (!existing || (row.isLive && !existing.isLive)) {
        deduped.set(row.runId, row);
      }
    }
  }

  return Array.from(deduped.values());
}
