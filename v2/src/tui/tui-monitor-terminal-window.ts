import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { isTerminalRunStatus } from "../persistence/state-store.ts";
import {
  partitionRunsByWorkflowInvocation,
  workflowGroupHasActiveMember,
  workflowRollupFinishedAtMs,
} from "./tui-monitor-workflow-collapse.ts";

export const TUI_TERMINAL_WINDOW_MS = 3_600_000;
export const TUI_TERMINAL_ROW_CAP = 20;

export function terminalRunInLiveWindow(finishedAtMs: number | undefined, nowMs: number, windowMs: number): boolean {
  if (finishedAtMs === undefined) return false;
  const inWindow = finishedAtMs >= nowMs - windowMs;
  // Mutation checkpoint: negating `inWindow` must turn the in-window terminal-row test RED.
  return inWindow;
}

type TerminalRetentionUnit = {
  finishedAtMs: number | undefined;
  runs: DaemonListRunRow[];
};

/** Apply the TUI live terminal window after daemon list merge. */
export function filterMonitorRunsForLiveWindow(
  runs: readonly DaemonListRunRow[],
  options: {
    nowMs: number;
    windowMs?: number;
    terminalCap?: number;
  },
): DaemonListRunRow[] {
  const windowMs = options.windowMs ?? TUI_TERMINAL_WINDOW_MS;
  const terminalCap = options.terminalCap ?? TUI_TERMINAL_ROW_CAP;

  const { byInvocation: membersByInvocation } = partitionRunsByWorkflowInvocation(runs);

  const keptNonTerminal: DaemonListRunRow[] = [];
  const terminalUnits: TerminalRetentionUnit[] = [];
  const seenInvocation = new Set<string>();

  for (const run of runs) {
    const invocationId = run.workflow?.invocationId;
    if (invocationId === undefined) {
      if (!isTerminalRunStatus(run.status)) {
        keptNonTerminal.push(run);
      } else {
        terminalUnits.push({ finishedAtMs: run.finishedAtMs, runs: [run] });
      }
      continue;
    }
    if (seenInvocation.has(invocationId)) continue;
    seenInvocation.add(invocationId);

    const members = membersByInvocation.get(invocationId) ?? [run];
    if (workflowGroupHasActiveMember(members)) {
      keptNonTerminal.push(...members);
    } else {
      terminalUnits.push({ finishedAtMs: workflowRollupFinishedAtMs(members), runs: [...members] });
    }
  }

  const inWindow = terminalUnits.filter((unit) => terminalRunInLiveWindow(unit.finishedAtMs, options.nowMs, windowMs));
  inWindow.sort((left, right) => (right.finishedAtMs ?? 0) - (left.finishedAtMs ?? 0));
  // Mutation checkpoint: dropping `.slice(0, terminalCap)` must turn the row-cap test RED.
  const keptTerminal = inWindow.slice(0, terminalCap);

  const kept: DaemonListRunRow[] = [...keptNonTerminal];
  for (const unit of keptTerminal) {
    kept.push(...unit.runs);
  }

  return kept;
}
