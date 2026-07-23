import type { DaemonListResult, DaemonListRunRow } from "./daemon-wire.ts";

export function mergeRunLists<Owner>(listResults: Array<[Owner, DaemonListResult | undefined]>): {
  rows: DaemonListRunRow[];
  owners: Map<string, Owner>;
} {
  const deduped = new Map<string, DaemonListRunRow>();
  const owners = new Map<string, Owner>();

  for (const [owner, result] of listResults) {
    if (!result) continue;

    for (const row of result.runs) {
      const existing = deduped.get(row.runId);
      if (!existing || (row.isLive && !existing.isLive)) {
        deduped.set(row.runId, row);
        owners.set(row.runId, owner);
      }
    }
  }

  return { rows: Array.from(deduped.values()), owners };
}
