import { execSync } from "node:child_process";
import type { Agent } from "../../agents/types.ts";
import type { SendLog } from "./run.ts";

export type ProcWithCmd = {
  pid: number;
  ppid: number;
  comm: string;
};

/**
 * List every process as pid/ppid/comm (command name).
 * Uses only columns an unprivileged `ps` exposes.
 * Best-effort: returns an empty list on any failure.
 */
export function listProcessesWithCmd(): ProcWithCmd[] {
  let out: string;
  try {
    out = execSync("ps -A -o pid=,ppid=,comm=", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const procs: ProcWithCmd[] = [];
  for (const line of out.split("\n")) {
    // "<pid> <ppid> <comm>"; comm may not contain spaces for most commands
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)\s*$/);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    procs.push({
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      comm: match[3].trim(),
    });
  }
  return procs;
}

function hasJarvisAncestor(pid: number, procs: ProcWithCmd[]): boolean {
  const procByPid = new Map(procs.map((p) => [p.pid, p]));
  let current = pid;
  const visited = new Set<number>();
  while (current !== 0 && current !== 1 && !visited.has(current)) {
    visited.add(current);
    const proc = procByPid.get(current);
    if (!proc) break;
    if (/^jarvis/i.test(proc.comm)) return true;
    current = proc.ppid;
  }
  return false;
}

/**
 * Detect if the selected patch primary agent is Claude and there are live
 * Jarvis-owned Claude operator/orchestration sessions.
 * Returns true if contention is detected, false otherwise.
 * Never throws; returns false on any probe error.
 * Accepts an optional listProcesses override for testing.
 */
export function detectClaudePoolContention(
  primaryAgent: Agent,
  opts?: { listProcessesFn?: () => ProcWithCmd[] },
): boolean {
  // Only check if the primary agent is Claude
  if (primaryAgent.name !== "claude") {
    return false;
  }

  let procs: ProcWithCmd[];
  try {
    procs = opts?.listProcessesFn ? opts.listProcessesFn() : listProcessesWithCmd();
  } catch {
    return false;
  }

  for (const proc of procs) {
    if (proc.comm === "claude" && hasJarvisAncestor(proc.pid, procs)) {
      return true;
    }
  }

  return false;
}

/**
 * Emit a single non-blocking warning if Claude pool contention is detected.
 * Safe to call multiple times; only warnings are emitted when contention is detected.
 */
export function warnAboutPoolContentionIfDetected(primaryAgent: Agent, sendLog: SendLog): void {
  if (!detectClaudePoolContention(primaryAgent)) {
    return;
  }

  const warning =
    "warning: selected patch primary shares Claude pool with a live Jarvis operator/orchestration session. " +
    "Pause the competing session to avoid contention.";
  sendLog("harness", warning);
}
