import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { RunStatus } from "../persistence/state-store.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";

function isActiveRunStatus(status: RunStatus): boolean {
  switch (status) {
    case "in-progress":
    case "paused":
    case "budget-soft-stopped":
      return true;
    case "completed":
    case "failed":
    case "killed":
    case "blocked":
    case "queued":
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Non-queued runs in display order: active group then terminal group, daemon order within each. */
export function orderSelectableRuns(runs: readonly DaemonListRunRow[]): DaemonListRunRow[] {
  const active: DaemonListRunRow[] = [];
  const terminal: DaemonListRunRow[] = [];
  for (const run of runs) {
    if (run.status === "queued") continue;
    if (isActiveRunStatus(run.status)) {
      active.push(run);
    } else {
      terminal.push(run);
    }
  }
  return [...active, ...terminal];
}

/** Initial monitor selection: topmost active run, or first terminal when all are terminal. */
export function firstSelectableRunId(runs: readonly DaemonListRunRow[]): string | null {
  return orderSelectableRuns(runs)[0]?.runId ?? null;
}

export type MonitorSegmentTone = "active" | "success" | "failure";

export type MonitorSegment = {
  text: string;
  tone?: MonitorSegmentTone;
};

export type MonitorLineRow = {
  segments: readonly MonitorSegment[];
};

export const RUN_STATUS_TONES: Record<RunStatus, MonitorSegmentTone> = {
  "in-progress": "active",
  completed: "success",
  blocked: "failure",
  "budget-soft-stopped": "failure",
  paused: "active",
  failed: "failure",
  killed: "failure",
  queued: "active",
};

export function livenessTone(isLive: boolean): MonitorSegmentTone | undefined {
  return isLive ? "active" : undefined;
}

const QUEUE_ADMISSION_DESCRIPTOR = "waiting: memory headroom";

function untoned(text: string): MonitorSegment {
  return { text };
}

function separator(): MonitorSegment {
  return untoned(" ");
}

function row(...segments: MonitorSegment[]): MonitorLineRow {
  return { segments };
}

export function joinMonitorRow(line: MonitorLineRow): string {
  return line.segments.map((segment) => segment.text).join("");
}

function runTableRow(run: DaemonListRunRow, selectedRunId: string | null): MonitorLineRow {
  const marker = run.runId === selectedRunId ? ">" : " ";
  const livenessText = run.isLive ? "live" : "not-live";
  const liveTone = livenessTone(run.isLive);
  return row(
    untoned(marker),
    separator(),
    untoned(run.runId),
    separator(),
    untoned(run.project),
    separator(),
    untoned(run.branch),
    separator(),
    { text: run.status, tone: RUN_STATUS_TONES[run.status] },
    separator(),
    liveTone === undefined ? untoned(livenessText) : { text: livenessText, tone: liveTone },
  );
}

function queueRow(run: DaemonListRunRow): MonitorLineRow {
  return row(
    untoned("  "),
    untoned(run.runId),
    separator(),
    untoned(run.project),
    separator(),
    untoned(run.branch),
    separator(),
    { text: run.status, tone: RUN_STATUS_TONES[run.status] },
    separator(),
    untoned(QUEUE_ADMISSION_DESCRIPTOR),
  );
}

function outcomeLines(state: TuiMonitorState): MonitorLineRow[] {
  const selected = state.selectedRunId;
  const waitState = state.waitState;
  if (selected === null) return [row(untoned("No run selected."))];
  if (waitState.kind === "pending") return [row(untoned(`Waiting for ${waitState.runId}...`))];
  if (waitState.kind === "ready") {
    return [
      row(untoned(`runStatus: ${waitState.result.runStatus}`)),
      ...(waitState.result.loopOutcomeKind !== undefined
        ? [row(untoned(`loopOutcomeKind: ${waitState.result.loopOutcomeKind}`))]
        : []),
      ...(waitState.result.iterationsConsumed !== undefined
        ? [row(untoned(`iterationsConsumed: ${waitState.result.iterationsConsumed}`))]
        : []),
      ...(waitState.result.resumable !== undefined ? [row(untoned(`resumable: ${waitState.result.resumable}`))] : []),
    ];
  }
  if (waitState.kind === "error") return [row(untoned(`Wait failed for ${waitState.runId}.`))];
  return [row(untoned("No outcome yet."))];
}

/** Segment rows for the ink run monitor from one snapshot. */
export function monitorSegmentRows(state: TuiMonitorState): MonitorLineRow[] {
  const selected = state.selectedRunId;
  const lines: MonitorLineRow[] = [row(untoned("jarvis tui"))];
  const selectableRuns = orderSelectableRuns(state.runs);
  const queuedRuns = state.runs.filter((run) => run.status === "queued").toReversed();
  if (selectableRuns.length === 0) {
    lines.push(row(untoned("No runs.")));
  } else {
    lines.push(row(untoned("runId project branch status liveness")));
    for (const run of selectableRuns) {
      lines.push(runTableRow(run, selected));
    }
  }
  if (queuedRuns.length > 0) {
    lines.push(row(untoned("Queue")));
    for (const run of queuedRuns) {
      lines.push(queueRow(run));
    }
  }
  const selectedRun = selected !== null ? state.runs.find((run) => run.runId === selected) : undefined;
  if (selectedRun?.workflow !== undefined) {
    lines.push(row(untoned("Workflow")));
    for (const step of selectedRun.workflow.steps) {
      const marker = step.status === "in_progress" ? ">" : " ";
      const outcomeSuffix = step.terminalOutcome !== undefined ? ` ${step.terminalOutcome}` : "";
      lines.push(
        row(
          untoned(`${marker} ${step.stepId} ${step.role} ${step.status}${outcomeSuffix} attempts=${step.attemptCount}`),
        ),
      );
    }
  }
  lines.push(row(untoned("Outcome")), ...outcomeLines(state));
  if (state.steeringFeedback !== null) {
    lines.push(row(untoned(state.steeringFeedback)));
  }
  lines.push(row(untoned("Press up/down or j to select; q or Ctrl-C to quit.")));
  return lines;
}

/** Flat text lines for the ink run monitor from one snapshot. */
export function monitorTextLines(state: TuiMonitorState): string[] {
  return monitorSegmentRows(state).map(joinMonitorRow);
}
