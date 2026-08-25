import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { ATTENTION_TERMINAL_RECENCY_MS, buildAttentionRows } from "./tui-attention-rows.ts";
import type { PipelineListResult } from "./tui-daemon-client.ts";
import { monitorPipelineStageNodeId, pipelineRowLabel } from "./tui-monitor-pipeline-tree.ts";

// Fixture sinceMs values in this file are small offsets, not real epoch ms; this clock keeps them
// all within the recency window without asserting anything about wall-clock time.
const NOW_MS = 10_000;

function pipelineSnapshot(
  overrides: Partial<PipelineSnapshot> & Pick<PipelineSnapshot, "pipelineId">,
): PipelineSnapshot {
  return {
    name: "full-review",
    state: "running",
    createdAt: 1_700_000_000_000,
    finishedAtMs: null,
    stages: [],
    ...overrides,
    terminalPublicationSucceededAt: overrides.terminalPublicationSucceededAt ?? null,
    terminalPublicationFailure: overrides.terminalPublicationFailure ?? null,
    dismissedAt: overrides.dismissedAt ?? null,
  };
}

function snapshotStage(
  overrides: Partial<PipelineSnapshot["stages"][number]> & Pick<PipelineSnapshot["stages"][number], "stageId">,
): PipelineSnapshot["stages"][number] {
  return {
    branchKey: "default",
    status: "running",
    workflowInvocationId: null,
    startedAt: null,
    endedAt: null,
    decidedAt: null,
    position: 0,
    artifact: null,
    failureDetail: null,
    ...overrides,
    id: overrides.id ?? overrides.stageId,
  };
}

function listRun(overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId">): DaemonListRunRow {
  return {
    project: "demo",
    branch: "main",
    createdAt: 0,
    status: "in-progress",
    isLive: true,
    ...overrides,
  };
}

function socketSnapshots(pipelines: readonly PipelineSnapshot[]): PipelineListResult {
  return { pipelines };
}

describe("buildAttentionRows", () => {
  test("builds every attention incident with durable targets and timestamps", () => {
    const pipeGates = pipelineSnapshot({
      pipelineId: "pipe-gates",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 100 }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "rejected", decidedAt: 1_500 }),
        snapshotStage({ stageId: "plan", position: 2, status: "succeeded", endedAt: 2_000 }),
        // Awaiting gate whose nearest predecessor is a workflow stage: sinceMs comes from its endedAt.
        snapshotStage({ stageId: "approve-plan", position: 3, status: "awaiting" }),
        snapshotStage({ stageId: "implement", position: 4, status: "failed", endedAt: 2_500 }),
      ],
    });

    const pipePublished = pipelineSnapshot({
      pipelineId: "pipe-published",
      terminalAction: "merge",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 3_000 }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "approved", decidedAt: 3_100 }),
        snapshotStage({ stageId: "plan", position: 2, status: "succeeded", endedAt: 3_200 }),
        snapshotStage({ stageId: "approve-plan", position: 3, status: "approved", decidedAt: 3_300 }),
        snapshotStage({ stageId: "implement", position: 4, status: "succeeded", endedAt: 3_400 }),
      ],
      terminalPublicationFailure: {
        terminalAction: "merge",
        failure: { operation: "merge", message: "conflict" },
      },
    });

    // No stage has settled: a durable terminal finish cannot be derived, so sinceMs stays null.
    const pipePublishedLegacy = pipelineSnapshot({
      pipelineId: "pipe-published-legacy",
      createdAt: 9_999,
      stages: [snapshotStage({ stageId: "intent", position: 0, status: "pending" })],
      terminalPublicationFailure: {
        terminalAction: "merge",
        failure: { operation: "merge", message: "conflict" },
      },
    });

    const attributedFailedRun = listRun({
      runId: "run-attributed-fail",
      status: "failed",
      finishedAtMs: 2_600,
      workflow: {
        invocationId: "inv-implement",
        steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
      },
      stepId: "implement",
    });
    // Attribute the run to pipeGates' failed implement stage so the stage and its run both project.
    pipeGates.stages[4] = { ...pipeGates.stages[4]!, workflowInvocationId: "inv-implement" };

    const adHocFailedRun = listRun({ runId: "run-adhoc-fail", status: "failed", finishedAtMs: 2_700 });

    // This scenario holds exactly six dated incidents (below the cap), so every incident below is a row.
    const projection = buildAttentionRows(
      { socket: socketSnapshots([pipeGates, pipePublished]) },
      [attributedFailedRun, adHocFailedRun],
      {},
      NOW_MS,
    );

    expect(projection.total).toBe(6);
    // Keystone checkpoint: an in-body mutation directive disables the complete attention projection.
    // @mutate v2/src/tui/tui-attention-rows.ts "return { rows, total: incidents.length, overflow: incidents.length - rows.length };" -> "return { rows: [], total: 0, overflow: 0 };"
    expect(projection.rows.length).toBe(6);
    expect(projection.overflow).toBe(0);

    const byId = new Map(projection.rows.map((row) => [row.id, row]));

    const awaitingGate = byId.get("attention:gate:pipe-gates:approve-plan:default");
    expect(awaitingGate).toMatchObject({
      kind: "awaiting-gate",
      targetId: monitorPipelineStageNodeId("pipe-gates", "approve-plan", "default"),
      sinceMs: 2_000,
      glyph: "✋",
      what: "approve-plan",
      where: "full-review pipe-gat",
    });

    const rejectedGate = byId.get("attention:gate:pipe-gates:approve-intent:default");
    expect(rejectedGate).toMatchObject({ kind: "rejected-gate", sinceMs: 1_500, glyph: "✋" });

    const failedStage = byId.get("attention:stage:pipe-gates:implement:default");
    expect(failedStage).toMatchObject({
      kind: "failed-stage",
      targetId: monitorPipelineStageNodeId("pipe-gates", "implement", "default"),
      sinceMs: 2_500,
      glyph: "✗",
    });

    const failedRun = byId.get("attention:failed-run:run-attributed-fail");
    expect(failedRun).toMatchObject({
      kind: "failed-run",
      targetId: "run-attributed-fail",
      sinceMs: 2_600,
      glyph: "✗",
      what: "role:implement",
    });
    // A failed stage and its failed constituent run are distinct rows with distinct ids.
    expect(failedRun?.targetId).not.toBe(failedStage?.targetId);

    const adHocRow = byId.get("attention:failed-run:run-adhoc-fail");
    expect(adHocRow).toMatchObject({ targetId: "run-adhoc-fail", sinceMs: 2_700, where: "main" });

    const publicationFailure = byId.get("attention:publication:pipe-published");
    expect(publicationFailure).toMatchObject({
      kind: "publication-failure",
      targetId: "pipe-published",
      sinceMs: 3_400,
      glyph: "✗",
      what: "merge",
    });

    // Legacy blocked run with no durable finish timestamp: sinceMs stays null, so the undated terminal
    // incident is suppressed rather than surfaced.
    const legacyBlockedRun = listRun({ runId: "run-legacy-blocked", status: "blocked" });
    const legacyBlockedProjection = buildAttentionRows(undefined, [legacyBlockedRun], {}, NOW_MS);
    expect(legacyBlockedProjection.rows).toEqual([]);
    expect(legacyBlockedProjection.total).toBe(0);

    // Publication failure with no settled stage: no durable terminal finish, so sinceMs stays null and
    // the undated incident is suppressed.
    const legacyPublicationProjection = buildAttentionRows(
      { socket: socketSnapshots([pipePublishedLegacy]) },
      [],
      {},
      NOW_MS,
    );
    expect(legacyPublicationProjection.rows).toEqual([]);
    expect(legacyPublicationProjection.total).toBe(0);
  });

  test("sorts undated rows after dated attention", () => {
    // A terminal incident with sinceMs null is suppressed (see the recency-window tests below), so the
    // undated case here uses an undated gate — the only kind that still projects without a timestamp.
    const pipeGateDated = pipelineSnapshot({
      pipelineId: "pipe-gate-dated",
      stages: [snapshotStage({ stageId: "approve-intent", position: 0, status: "rejected", decidedAt: 1_500 })],
    });
    const pipeGateUndated = pipelineSnapshot({
      pipelineId: "pipe-gate-undated",
      stages: [snapshotStage({ stageId: "approve-plan", position: 0, status: "awaiting" })],
    });

    const runs: DaemonListRunRow[] = [
      listRun({ runId: "run-zzz", status: "failed", finishedAtMs: 2_000 }),
      listRun({ runId: "run-aaa", status: "failed", finishedAtMs: 2_000 }),
      listRun({
        runId: "run-m1",
        status: "failed",
        finishedAtMs: 3_000,
        stepId: "implement",
        workflow: {
          invocationId: "inv-shared",
          steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
        },
      }),
      listRun({
        runId: "run-m2",
        status: "failed",
        finishedAtMs: 3_000,
        stepId: "review",
        workflow: {
          invocationId: "inv-shared",
          steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
        },
      }),
    ];

    const projection = buildAttentionRows(
      { socket: socketSnapshots([pipeGateDated, pipeGateUndated]) },
      runs,
      {},
      NOW_MS,
    );

    expect(projection.rows.map((row) => row.id)).toEqual([
      "attention:gate:pipe-gate-dated:approve-intent:default",
      "attention:gate:pipe-gate-undated:approve-plan:default",
      "attention:failed-run:run-aaa",
      "attention:failed-run:run-zzz",
      "attention:failed-run:run-m1",
      "attention:failed-run:run-m2",
    ]);
    expect(projection.total).toBe(6);
    expect(projection.overflow).toBe(0);

    // run-m1 and run-m2 share one ad-hoc group target (run-m1 is the workflow-collapsed representative)
    // but keep distinct row ids — the tie then resolves by attention id.
    const m1 = projection.rows.find((row) => row.id === "attention:failed-run:run-m1");
    const m2 = projection.rows.find((row) => row.id === "attention:failed-run:run-m2");
    expect(m1?.targetId).toBe("run-m1");
    expect(m2?.targetId).toBe("run-m1");

    // Mutation checkpoint: in-body mutation directives invert the dated-before-undated guard,
    // target-id tie-break, and row-id tie-break; each turns this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "return aDated ? -1 : 1;" -> "return aDated ? 1 : -1;"
    // @mutate v2/src/tui/tui-attention-rows.ts "return a.targetId < b.targetId ? -1 : 1;" -> "return a.targetId < b.targetId ? 1 : -1;"
    // @mutate v2/src/tui/tui-attention-rows.ts "return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;" -> "return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;"
  });

  test("filters attention sources", () => {
    // pipe-1: an awaiting gate whose nearest predecessor is itself a decided approval gate.
    const pipe1 = pipelineSnapshot({
      pipelineId: "pipe-1",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 100 }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "approved", decidedAt: 500 }),
        snapshotStage({ stageId: "approve-plan", position: 2, status: "awaiting" }),
      ],
    });

    // pipe-2: a rejected gate, an awaiting gate preceded by a workflow stage, and a failed stage.
    // No terminal-publication failure — proves the durability guard filters non-failing pipelines.
    const pipe2 = pipelineSnapshot({
      pipelineId: "pipe-2",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 1_000 }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "rejected", decidedAt: 1_500 }),
        snapshotStage({ stageId: "plan", position: 2, status: "succeeded", endedAt: 2_000 }),
        snapshotStage({ stageId: "approve-plan", position: 3, status: "awaiting" }),
        snapshotStage({ stageId: "implement", position: 4, status: "failed", endedAt: 2_500 }),
      ],
    });

    const pipe3Published = pipelineSnapshot({
      pipelineId: "pipe-3",
      stages: [snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 3_400 })],
      terminalPublicationFailure: { terminalAction: "ready", failure: { operation: "ready", message: "boom" } },
    });

    // Stale duplicate for pipe-1 on a lexically later socket: discarded by canonical-source suppression,
    // even though (if kept) it would contribute its own awaiting-gate incident.
    const pipe1Stale = pipelineSnapshot({
      pipelineId: "pipe-1",
      stages: [snapshotStage({ stageId: "approve-intent", position: 0, status: "awaiting" })],
    });

    const failedRun = listRun({
      runId: "run-impl-fail",
      status: "failed",
      finishedAtMs: 2_600,
      stepId: "implement",
      workflow: {
        invocationId: "inv-2-implement",
        steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
      },
    });
    pipe2.stages[4] = { ...pipe2.stages[4]!, workflowInvocationId: "inv-2-implement" };

    const blockedRun = listRun({ runId: "run-adhoc-blocked", status: "blocked", finishedAtMs: 3_500 });

    // Non-actionable statuses: filtered out entirely, never counted toward total.
    const completedRun = listRun({ runId: "run-completed", status: "completed", finishedAtMs: 10 });
    const inProgressRun = listRun({ runId: "run-in-progress", status: "in-progress" });

    const projection = buildAttentionRows(
      {
        a: socketSnapshots([pipe1, pipe2, pipe3Published]),
        b: socketSnapshots([pipe1Stale]),
      },
      [failedRun, blockedRun, completedRun, inProgressRun],
      {},
      NOW_MS,
    );

    expect(projection.total).toBe(7);
    expect(projection.rows.length).toBe(7);
    expect(projection.overflow).toBe(0);
    // Below the failure cap, so nothing is dropped; the dedicated cap test covers overflow.
    expect(projection.rows.map((row) => row.id)).toContain("attention:blocked-run:run-adhoc-blocked");

    const pipe1Gate = projection.rows.find((row) => row.id === "attention:gate:pipe-1:approve-plan:default");
    expect(pipe1Gate?.sinceMs).toBe(500);
    const pipe2Gate = projection.rows.find((row) => row.id === "attention:gate:pipe-2:approve-plan:default");
    expect(pipe2Gate?.sinceMs).toBe(2_000);

    // Mutation checkpoint: in-body mutation directives invert every added source, canonical-source
    // suppression, predecessor-kind timestamp, terminal-publication durability, and filtering; each
    // turns this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "if (stage.status === \"awaiting\") {" -> "if (false) {"
    // @mutate v2/src/tui/tui-attention-rows.ts "} else if (stage.status === \"rejected\") {" -> "} else if (false) {"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (stage.status === \"failed\") {" -> "if (false) {"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (status === \"failed\") return \"failed-run\";" -> "if (false) return \"failed-run\";"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (status === \"blocked\") return \"blocked-run\";" -> "if (false) return \"blocked-run\";"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (!hasPipelineTerminalPublicationFailure(snapshot)) return [];" -> "return [];"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (seen.has(snapshot.pipelineId)) continue;" -> "if (false) continue;"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (kinds.get(predecessor.stageId) === \"approval\") return predecessor.decidedAt;" -> "return predecessor.endedAt;"
    // @mutate v2/src/tui/tui-attention-rows.ts "return finishAts.length > 0 ? Math.max(...finishAts) : null;" -> "return finishAts.length > 0 ? Math.max(...finishAts) : snapshot.createdAt;"
  });

  test("every awaiting gate stays selectable when gates exceed the failure cap", () => {
    const gatePipelines = Array.from({ length: 7 }, (_, i) =>
      pipelineSnapshot({
        pipelineId: `pipe-gate-${i}`,
        stages: [snapshotStage({ stageId: "approve-intent", position: 0, status: "awaiting" })],
      }),
    );

    const projection = buildAttentionRows({ socket: socketSnapshots(gatePipelines) }, [], {}, NOW_MS);

    expect(projection.total).toBe(7);
    expect(projection.rows.length).toBe(7);
    expect(projection.overflow).toBe(0);
    for (const pipeline of gatePipelines) {
      expect(projection.rows.map((row) => row.id)).toContain(
        `attention:gate:${pipeline.pipelineId}:approve-intent:default`,
      );
    }
    // Keystone checkpoint: an in-body mutation directive restores the pre-fix shared six-row cap.
    // @mutate v2/src/tui/tui-attention-rows.ts "const rows = [...gates, ...failures.slice(0, ATTENTION_ROW_CAP)];" -> "const rows = incidents.slice(0, ATTENTION_ROW_CAP);"
  });

  test("the newest awaiting gate sorts ahead of a stale gate backlog", () => {
    const gatePipelines = Array.from({ length: 7 }, (_, i) =>
      pipelineSnapshot({
        pipelineId: `pipe-gate-${i}`,
        stages: [
          snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: (i + 1) * 1_000 }),
          snapshotStage({ stageId: "approve-intent", position: 1, status: "awaiting" }),
        ],
      }),
    );
    const newest = gatePipelines[6]!;

    const projection = buildAttentionRows({ socket: socketSnapshots(gatePipelines) }, [], {}, NOW_MS);

    expect(projection.rows[0]?.id).toBe(`attention:gate:${newest.pipelineId}:approve-intent:default`);
    // Mutation checkpoint: an in-body mutation directive reverting gate orientation turns this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "const oriented = GATE_KINDS.has(a.kind) ? -sinceDelta : sinceDelta;" -> "const oriented = sinceDelta;"
  });

  test("failures still sort oldest-idle-first behind every gate", () => {
    const gatePipeline = pipelineSnapshot({
      pipelineId: "pipe-gate-behind",
      stages: [snapshotStage({ stageId: "approve-intent", position: 0, status: "awaiting" })],
    });
    const olderFailure = listRun({ runId: "run-older-fail", status: "failed", finishedAtMs: 1_000 });
    const newerFailure = listRun({ runId: "run-newer-fail", status: "failed", finishedAtMs: 2_000 });

    const projection = buildAttentionRows(
      { socket: socketSnapshots([gatePipeline]) },
      [olderFailure, newerFailure],
      {},
      NOW_MS,
    );

    expect(projection.rows.map((row) => row.id)).toEqual([
      "attention:gate:pipe-gate-behind:approve-intent:default",
      "attention:failed-run:run-older-fail",
      "attention:failed-run:run-newer-fail",
    ]);
    // Mutation checkpoint: an in-body mutation directive reorienting failures to newest-first turns
    // this negative case red.
    // @mutate v2/src/tui/tui-attention-rows.ts "const oriented = GATE_KINDS.has(a.kind) ? -sinceDelta : sinceDelta;" -> "const oriented = -sinceDelta;"
  });

  test("failures beyond the cap stay in display-only overflow", () => {
    const failures = Array.from({ length: 7 }, (_, i) =>
      listRun({ runId: `run-fail-${i}`, status: "failed", finishedAtMs: (i + 1) * 1_000 }),
    );

    const projection = buildAttentionRows(undefined, failures, {}, NOW_MS);

    expect(projection.total).toBe(7);
    expect(projection.rows.length).toBe(6);
    expect(projection.overflow).toBe(1);
    // Oldest-idle-first keeps run-fail-0..5; the newest-sorted failure is dropped by the cap.
    expect(projection.rows.map((row) => row.id)).not.toContain("attention:failed-run:run-fail-6");
    // Mutation checkpoint: an in-body mutation directive dropping the failure cap turns this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "const rows = [...gates, ...failures.slice(0, ATTENTION_ROW_CAP)];" -> "const rows = [...gates, ...failures];"
  });

  test("a dismissed pipeline's gate, failed-stage, and publication-failure incidents leave the attention segment", () => {
    const dismissed = pipelineSnapshot({
      pipelineId: "pipe-dismissed",
      dismissedAt: 1_700_000_500_000,
      terminalAction: "merge",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 100 }),
        snapshotStage({ stageId: "approve-plan", position: 1, status: "awaiting" }),
        snapshotStage({ stageId: "implement", position: 2, status: "failed", endedAt: 500 }),
      ],
      terminalPublicationFailure: {
        terminalAction: "merge",
        failure: { operation: "merge", message: "conflict" },
      },
    });

    const live = pipelineSnapshot({
      pipelineId: "pipe-live",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 100 }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "rejected", decidedAt: 200 }),
      ],
    });

    const projection = buildAttentionRows({ socket: socketSnapshots([dismissed, live]) }, [], {}, NOW_MS);

    expect(projection.rows.some((row) => row.id.startsWith("attention:gate:pipe-dismissed"))).toBe(false);
    expect(projection.rows.some((row) => row.id.startsWith("attention:stage:pipe-dismissed"))).toBe(false);
    expect(projection.rows.some((row) => row.id === "attention:publication:pipe-dismissed")).toBe(false);
    expect(projection.total).toBe(1);
    expect(projection.overflow).toBe(0);
    expect(projection.rows).toMatchObject([{ id: "attention:gate:pipe-live:approve-intent:default" }]);
  });

  test("a failed run attributed to a dismissed pipeline contributes no attention row", () => {
    // Negative case: proves the suppressed run row is absent, not merely re-targeted.
    // @mutate v2/src/tui/tui-attention-rows.ts "return invocationId !== undefined && hiddenInvocationIds.has(invocationId);" -> "return false;"
    const dismissed = pipelineSnapshot({
      pipelineId: "pipe-dismissed",
      dismissedAt: 1_700_000_500_000,
      stages: [
        snapshotStage({
          stageId: "implement",
          position: 0,
          status: "failed",
          endedAt: 500,
          workflowInvocationId: "inv-dismissed-implement",
        }),
      ],
    });
    const failedRun = listRun({
      runId: "run-dismissed-fail",
      status: "failed",
      finishedAtMs: 600,
      stepId: "implement",
      workflow: {
        invocationId: "inv-dismissed-implement",
        steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
      },
    });

    const projection = buildAttentionRows({ socket: socketSnapshots([dismissed]) }, [failedRun], {}, NOW_MS);

    expect(projection.rows.some((row) => row.targetId === "run-dismissed-fail")).toBe(false);
    expect(projection.rows.map((row) => row.id)).not.toContain("attention:failed-run:run-dismissed-fail");
    expect(projection.total).toBe(0);
  });

  test("a run branch-attributed to a pipeline stage projects an attention row targeting the pipeline, not its own branch", () => {
    const branch = "plan/attention-branch";
    const snapshot = pipelineSnapshot({
      pipelineId: "pipe-branch-attr",
      stages: [
        snapshotStage({ stageId: "implement", position: 0, status: "running", workflowInvocationId: "inv-stage" }),
      ],
    });
    const stageRun = listRun({
      runId: "run-stage-own",
      status: "in-progress",
      branch,
      workflow: {
        invocationId: "inv-stage",
        steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
      stepId: "implement",
    });
    const leakedFailedRun = listRun({
      runId: "run-leaked-fail",
      status: "failed",
      branch,
      finishedAtMs: 5_000,
      workflow: {
        invocationId: "inv-leak",
        steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
      },
      stepId: "implement",
    });

    const projection = buildAttentionRows(
      { socket: socketSnapshots([snapshot]) },
      [stageRun, leakedFailedRun],
      {},
      NOW_MS,
    );
    const row = projection.rows.find((candidate) => candidate.id === "attention:failed-run:run-leaked-fail");

    expect(row).toBeDefined();
    expect(row?.where).toBe(pipelineRowLabel(snapshot));
    expect(row?.where).not.toBe(branch);
  });

  test("a dismissed run's own attention row is suppressed", () => {
    // Mutation checkpoint: dropping the hidden-run guard restores baseline semantics (a dismissed run's
    // incident row survives with an unresolvable target) and turns this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "if (isHiddenDismissedRun(run, options.showDismissed === true)) continue;" -> "if (false) continue;"
    const dismissedFailedRun = listRun({
      runId: "run-dismissed-own-attention",
      status: "failed",
      finishedAtMs: 900,
      dismissedAt: 1_700_000_800_000,
    });

    const defaultProjection = buildAttentionRows(undefined, [dismissedFailedRun], {}, NOW_MS);
    expect(defaultProjection.rows.some((row) => row.targetId === "run-dismissed-own-attention")).toBe(false);
    expect(defaultProjection.total).toBe(0);

    const shownProjection = buildAttentionRows(undefined, [dismissedFailedRun], { showDismissed: true }, NOW_MS);
    expect(shownProjection.rows).toMatchObject([{ targetId: "run-dismissed-own-attention" }]);
  });

  test("a terminal failure older than the recency window is not surfaced", () => {
    const nowMs = 100_000_000;
    const staleFailedRun = listRun({
      runId: "run-stale-fail",
      status: "failed",
      finishedAtMs: nowMs - ATTENTION_TERMINAL_RECENCY_MS - 1,
    });

    const projection = buildAttentionRows(undefined, [staleFailedRun], {}, nowMs);

    expect(projection.rows.some((row) => row.targetId === "run-stale-fail")).toBe(false);
    expect(projection.total).toBe(0);
    // Keystone checkpoint: an in-body mutation directive restores baseline always-surface semantics.
    // @mutate v2/src/tui/tui-attention-rows.ts "if (GATE_KINDS.has(row.kind)) return true;" -> "return true;"
  });

  test("a terminal failure inside the recency window is still surfaced", () => {
    const nowMs = 100_000_000;
    const freshFailedRun = listRun({
      runId: "run-fresh-fail",
      status: "failed",
      finishedAtMs: nowMs - ATTENTION_TERMINAL_RECENCY_MS + 1,
    });

    const projection = buildAttentionRows(undefined, [freshFailedRun], {}, nowMs);

    expect(projection.rows.map((row) => row.targetId)).toContain("run-fresh-fail");
    expect(projection.total).toBe(1);
    // Mutation checkpoint: an in-body mutation directive replaces the window comparison with an
    // always-stale return, turning this positive case red.
    // @mutate v2/src/tui/tui-attention-rows.ts "return nowMs - row.sinceMs <= ATTENTION_TERMINAL_RECENCY_MS;" -> "return false;"
  });

  test("an awaiting or rejected gate is surfaced regardless of age", () => {
    const nowMs = 2_000_000_000; // ~weeks past the gates' decision/predecessor timestamps below.
    const ancientGates = pipelineSnapshot({
      pipelineId: "pipe-ancient-gate",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded", endedAt: 0 }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "rejected", decidedAt: 0 }),
        snapshotStage({ stageId: "approve-plan", position: 2, status: "awaiting" }),
      ],
    });

    const projection = buildAttentionRows({ socket: socketSnapshots([ancientGates]) }, [], {}, nowMs);

    expect(projection.rows.map((row) => row.kind).sort()).toEqual(["awaiting-gate", "rejected-gate"]);
    expect(projection.total).toBe(2);
    // Mutation checkpoint: an in-body mutation directive inverts the gate bypass, turning this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "if (GATE_KINDS.has(row.kind)) return true;" -> "if (GATE_KINDS.has(row.kind)) return false;"
  });

  test("a terminal incident with no durable timestamp is not surfaced", () => {
    const nowMs = 100_000_000;
    const undatedStagePipeline = pipelineSnapshot({
      pipelineId: "pipe-undated-stage",
      stages: [snapshotStage({ stageId: "implement", position: 0, status: "failed" })],
    });
    const undatedFailedRun = listRun({ runId: "run-undated-fail", status: "failed" });

    const projection = buildAttentionRows(
      { socket: socketSnapshots([undatedStagePipeline]) },
      [undatedFailedRun],
      {},
      nowMs,
    );

    expect(projection.rows).toEqual([]);
    expect(projection.total).toBe(0);
    // Mutation checkpoint: an in-body mutation directive inverts the undated guard, turning this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "if (row.sinceMs === null) return false;" -> "if (row.sinceMs === null) return true;"
  });

  test("recency is evaluated against the caller's clock, not wall-clock time", () => {
    const nowMs = 1_000; // years behind real wall-clock time
    const freshFailedRun = listRun({ runId: "run-clock-fresh", status: "failed", finishedAtMs: 500 });

    const projection = buildAttentionRows(undefined, [freshFailedRun], {}, nowMs);

    expect(projection.rows.map((row) => row.targetId)).toContain("run-clock-fresh");
    expect(projection.total).toBe(1);
    // Mutation checkpoint: an in-body mutation directive swaps the threaded clock for wall time,
    // turning this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "isSurfacedIncident(row, nowMs)" -> "isSurfacedIncident(row, Date.now())"
  });
});
