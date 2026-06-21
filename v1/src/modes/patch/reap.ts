// Orphan process reaping: track an agent's descendant PIDs while its process
// tree is intact, then SIGKILL any survivors after the agent exits.
//
// Agent tools can place a descendant in a new session/process group (e.g. a
// `bun run test` -> `bun test` subtree that calls setsid()). When the watchdog
// kills `-pgid`, such a descendant escapes the group kill and, once its agent
// exits, re-parents to init (PPID=1) and keeps running. The process group is
// gone and the parent link is broken, so by iteration end there is no live
// handle back to the orphan.
//
// macOS does not expose process environments to an unprivileged `ps`, so an
// inherited env marker cannot be discovered after the fact. The PID/PPID/PGID
// columns are always visible, and a descendant's PPID still points at the agent
// subtree until the agent dies. So we poll the process table during the
// iteration, accumulate every descendant PID we see, and kill the survivors at
// iteration end and finalize. A per-PID start-time identity guards against
// killing an unrelated process that happens to reuse a recycled PID.

import { execSync } from "node:child_process";

/** How often to sample an agent's process subtree for descendant reaping. */
export const DESCENDANT_POLL_INTERVAL_MS = 500;

export type ProcInfo = {
  pid: number;
  ppid: number;
  pgid: number;
  /** Start-time token (`lstart`) used as a stable per-PID identity. */
  identity: string;
};

/**
 * List every process as pid/ppid/pgid plus a start-time identity token.
 * Uses only columns an unprivileged `ps` exposes on darwin (never environments).
 * Best-effort: returns an empty list on any failure.
 */
export function listProcesses(): ProcInfo[] {
  let out: string;
  try {
    out = execSync("ps -A -o pid=,ppid=,pgid=,lstart=", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const procs: ProcInfo[] = [];
  for (const line of out.split("\n")) {
    // "<pid> <ppid> <pgid> <lstart...>"; lstart contains spaces, so capture the rest.
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) continue;
    procs.push({
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      pgid: Number.parseInt(match[3], 10),
      identity: match[4],
    });
  }
  return procs;
}

/**
 * Collect every process descended from `rootPid` via transitive PPID links,
 * plus any process still sharing `rootPid`'s process group. Excludes `rootPid`.
 */
export function collectSubtree(rootPid: number, procs: ProcInfo[]): ProcInfo[] {
  const childrenByParent = new Map<number, ProcInfo[]>();
  for (const proc of procs) {
    const siblings = childrenByParent.get(proc.ppid);
    if (siblings) {
      siblings.push(proc);
    } else {
      childrenByParent.set(proc.ppid, [proc]);
    }
  }

  const collected = new Map<number, ProcInfo>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const parent = queue.pop();
    if (parent === undefined) break;
    for (const child of childrenByParent.get(parent) ?? []) {
      if (child.pid === rootPid || collected.has(child.pid)) continue;
      collected.set(child.pid, child);
      queue.push(child.pid);
    }
  }

  // Belt-and-suspenders: group members that share the root's pgid but whose
  // PPID link was not yet observed (e.g. very short-lived intermediaries).
  for (const proc of procs) {
    if (proc.pgid === rootPid && proc.pid !== rootPid && !collected.has(proc.pid)) {
      collected.set(proc.pid, proc);
    }
  }

  return [...collected.values()];
}

/**
 * Accumulates an agent's descendant PIDs (with a start-time identity) across
 * polls so that survivors can be SIGKILLed after they escape the process group
 * and re-parent to init, when no live lineage to them remains.
 */
export class DescendantTracker {
  /** pid -> start-time identity observed while the descendant was reachable. */
  private readonly seen = new Map<number, string>();

  /**
   * Process-table and kill providers. Default to the real OS calls; tests
   * inject a fixed table and a recording kill to exercise the reap logic
   * deterministically without spawning real processes (timing-flaky under load
   * and unavailable in restricted sandboxes).
   */
  private readonly listProcessesFn: () => ProcInfo[];
  private readonly killFn: (pid: number, signal: NodeJS.Signals) => void;

  constructor(deps?: {
    listProcesses?: () => ProcInfo[];
    kill?: (pid: number, signal: NodeJS.Signals) => void;
  }) {
    this.listProcessesFn = deps?.listProcesses ?? listProcesses;
    this.killFn = deps?.kill ?? ((pid, signal) => process.kill(pid, signal));
  }

  /** Snapshot the process table and record `rootPid`'s current descendants. */
  poll(rootPid: number): void {
    for (const proc of collectSubtree(rootPid, this.listProcessesFn())) {
      if (proc.pid === process.pid) continue;
      this.seen.set(proc.pid, proc.identity);
    }
  }

  /**
   * SIGKILL every tracked descendant that is still alive with an unchanged
   * start-time identity (so a recycled PID for an unrelated process is skipped).
   * Never targets the harness's own process. Prunes entries that are gone or
   * reused so the map stays bounded over a long run. Best-effort; never throws.
   * Returns the number of processes signalled.
   */
  reap(): number {
    let killed = 0;
    if (this.seen.size === 0) return killed;
    const current = new Map(this.listProcessesFn().map((proc) => [proc.pid, proc.identity] as const));
    for (const [pid, identity] of this.seen) {
      const currentIdentity = current.get(pid);
      // Gone already, or the PID was reused by a different process: drop it and
      // never target it.
      if (currentIdentity === undefined || currentIdentity !== identity) {
        this.seen.delete(pid);
        continue;
      }
      if (pid === process.pid) continue;
      try {
        this.killFn(pid, "SIGKILL");
        killed += 1;
      } catch {
        // Already exited between listing and kill; nothing to do.
      }
    }
    return killed;
  }

  /** Count of distinct descendant PIDs accumulated so far. */
  get trackedCount(): number {
    return this.seen.size;
  }
}
