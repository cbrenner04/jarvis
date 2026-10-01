import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProcessTableRow = {
  pid: number;
  ppid: number;
  pgid: number;
};

/** Distinct process-group ids for `rootPid` and every descendant linked by `ppid`. */
export function collectSubtreeProcessGroupIds(rootPid: number, rows: readonly ProcessTableRow[]): ReadonlySet<number> {
  const childrenByParent = new Map<number, ProcessTableRow[]>();
  const byPid = new Map<number, ProcessTableRow>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const siblings = childrenByParent.get(row.ppid);
    if (siblings) {
      siblings.push(row);
    } else {
      childrenByParent.set(row.ppid, [row]);
    }
  }

  const pgids = new Set<number>();
  const queue: number[] = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid === undefined) break;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = byPid.get(pid);
    if (row !== undefined) {
      pgids.add(row.pgid);
    } else if (pid === rootPid) {
      pgids.add(rootPid);
    }
    for (const child of childrenByParent.get(pid) ?? []) {
      queue.push(child.pid);
    }
  }
  return pgids;
}

export function parseProcessTablePsOutput(stdout: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) continue;
    rows.push({
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      pgid: Number.parseInt(match[3], 10),
    });
  }
  return rows;
}

export async function probeAgentDescendantProcessGroups(rootPid: number): Promise<ReadonlySet<number>> {
  try {
    const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      // A wedged `ps` must not stall the abort kill; fall back to the agent's own group.
      timeout: 5000,
    });
    return collectSubtreeProcessGroupIds(rootPid, parseProcessTablePsOutput(stdout));
  } catch {
    return new Set([rootPid]);
  }
}
