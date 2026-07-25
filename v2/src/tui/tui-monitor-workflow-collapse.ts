import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { rollupWorkflowRunStatus } from "../daemon/workflow-run-status-rollup.ts";
import { isTerminalRunStatus, type Run, type RunStatus, type WorkflowSnapshot } from "../persistence/state-store.ts";

let invertWorkflowCollapseForTest = false;

export function setInvertWorkflowCollapseForTest(value: boolean): void {
  invertWorkflowCollapseForTest = value;
}

export function isActiveRunStatus(status: RunStatus): boolean {
  switch (status) {
    case "in-progress":
    case "paused":
    case "budget-soft-stopped":
      return true;
    case "completed":
    case "failed":
    case "interrupted":
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

export function partitionRunsByWorkflowInvocation(runs: readonly DaemonListRunRow[]): {
  withoutInvocation: DaemonListRunRow[];
  byInvocation: Map<string, DaemonListRunRow[]>;
} {
  const withoutInvocation: DaemonListRunRow[] = [];
  const byInvocation = new Map<string, DaemonListRunRow[]>();
  for (const run of runs) {
    const invocationId = run.workflow?.invocationId;
    if (invocationId === undefined) {
      withoutInvocation.push(run);
      continue;
    }
    const group = byInvocation.get(invocationId) ?? [];
    group.push(run);
    byInvocation.set(invocationId, group);
  }
  return { withoutInvocation, byInvocation };
}

/** Entry or active constituent used as the collapsed row identity. */
export function workflowGroupRepresentative(members: readonly DaemonListRunRow[]): DaemonListRunRow {
  const active = members.find((run) => isActiveRunStatus(run.status));
  if (active !== undefined) return active;

  const entryStepId = members[0]?.workflow?.steps[0]?.stepId;
  if (entryStepId !== undefined) {
    const entry = members.find((run) => run.stepId === entryStepId);
    if (entry !== undefined) return entry;
  }

  const fallback = members.at(0) ?? members.at(-1);
  if (fallback === undefined) {
    throw new Error("workflowGroupRepresentative requires at least one member");
  }
  return fallback;
}

function listRowAsRollupRun(row: DaemonListRunRow): Run {
  return {
    id: row.runId,
    project: row.project,
    specRef: "",
    createdAt: 0,
    status: row.status,
    attemptCount: 0,
    worktreePath: "",
    branch: row.branch,
    specPath: "",
    ...(row.stepId !== undefined ? { stepId: row.stepId } : {}),
  };
}

function listWorkflowAsRollupSnapshot(workflow: NonNullable<DaemonListRunRow["workflow"]>): WorkflowSnapshot {
  return {
    invocationId: workflow.invocationId,
    steps: workflow.steps.map((step) => ({ stepId: step.stepId, role: step.role })),
  };
}

/** Workflow-level status for a collapsed terminal group (daemon entry rollup semantics). */
export function workflowGroupRollupRunStatus(members: readonly DaemonListRunRow[]): RunStatus {
  const representative = workflowGroupRepresentative(members);
  const workflow = representative.workflow;
  if (workflow === undefined) return representative.status;

  return rollupWorkflowRunStatus({
    entryRun: listRowAsRollupRun(representative),
    workflowSnapshot: listWorkflowAsRollupSnapshot(workflow),
    siblingRuns: members.map(listRowAsRollupRun),
    isLive: members.some((run) => run.isLive) || workflowGroupHasActiveMember(members),
  });
}

export function workflowRollupFinishedAtMs(members: readonly DaemonListRunRow[]): number | undefined {
  let latest: number | undefined;
  for (const run of members) {
    if (run.finishedAtMs === undefined) continue;
    if (latest === undefined || run.finishedAtMs > latest) latest = run.finishedAtMs;
  }
  return latest;
}

export function workflowGroupHasActiveMember(members: readonly DaemonListRunRow[]): boolean {
  return members.some((run) => !isTerminalRunStatus(run.status));
}

export function workflowRoleLabel(run: DaemonListRunRow): string {
  const stepId = run.stepId;
  if (stepId === undefined) return "role:unknown";
  const step = run.workflow?.steps.find((entry) => entry.stepId === stepId);
  if (step === undefined) return `role:${stepId}`;
  const role = step.role.trim();
  if (role.length > 0) return `role:${role}`;
  if (step.status === "in_progress") return `role:${stepId}:in_progress`;
  return `role:${stepId}`;
}

export function workflowCollapsedContextSuffix(members: readonly DaemonListRunRow[]): string {
  const representative = workflowGroupRepresentative(members);
  const workflow = representative.workflow;
  if (workflow === undefined) return "";

  if (workflowGroupHasActiveMember(members)) {
    const activeStep = workflow.steps.find((step) => step.status === "in_progress");
    if (activeStep !== undefined) {
      const role = activeStep.role.trim();
      const roleText = role.length > 0 ? role : activeStep.stepId;
      return ` workflow-step:${activeStep.stepId}/${roleText}`;
    }
    return " workflow-step:active";
  }

  return ` workflow-status:${workflowGroupRollupRunStatus(members)}`;
}

export type WorkflowTableRow =
  | { kind: "standalone"; run: DaemonListRunRow }
  | { kind: "workflow-collapsed"; representative: DaemonListRunRow; members: DaemonListRunRow[] }
  | { kind: "workflow-child"; run: DaemonListRunRow };

export function buildWorkflowTableRows(
  orderedSelectable: readonly DaemonListRunRow[],
  allRuns: readonly DaemonListRunRow[],
  expandedInvocationIds: ReadonlySet<string>,
): WorkflowTableRow[] {
  if (invertWorkflowCollapseForTest) {
    return orderedSelectable.map((run) => ({ kind: "standalone", run }));
  }

  const { byInvocation: membersByInvocation } = partitionRunsByWorkflowInvocation(allRuns);

  const seenInvocations = new Set<string>();
  const rows: WorkflowTableRow[] = [];

  for (const run of orderedSelectable) {
    const invocationId = run.workflow?.invocationId;
    if (invocationId === undefined) {
      rows.push({ kind: "standalone", run });
      continue;
    }
    if (seenInvocations.has(invocationId)) continue;
    seenInvocations.add(invocationId);

    const members = membersByInvocation.get(invocationId) ?? [run];
    const representative = workflowGroupRepresentative(members);
    rows.push({ kind: "workflow-collapsed", representative, members });
    if (expandedInvocationIds.has(invocationId)) {
      for (const member of members) {
        if (member.runId === representative.runId) continue;
        rows.push({ kind: "workflow-child", run: member });
      }
    }
  }

  return rows;
}
