import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { buildAttentionRows } from "./tui-attention-rows.ts";
import type { PipelineListResult } from "./tui-daemon-client.ts";
import { monitorPipelineStageNodeId } from "./tui-monitor-pipeline-tree.ts";

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
    const projection = buildAttentionRows({ socket: socketSnapshots([pipeGates, pipePublished]) }, [
      attributedFailedRun,
      adHocFailedRun,
    ]);

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

    // Legacy blocked run with no durable finish timestamp: sinceMs stays null, not admission/display time.
    const legacyBlockedRun = listRun({ runId: "run-legacy-blocked", status: "blocked" });
    const legacyBlockedProjection = buildAttentionRows(undefined, [legacyBlockedRun]);
    expect(legacyBlockedProjection.rows).toMatchObject([
      { kind: "blocked-run", targetId: "run-legacy-blocked", sinceMs: null },
    ]);

    // Publication failure with no settled stage: no durable terminal finish, so sinceMs stays null.
    const legacyPublicationProjection = buildAttentionRows({ socket: socketSnapshots([pipePublishedLegacy]) }, []);
    expect(legacyPublicationProjection.rows).toMatchObject([{ kind: "publication-failure", sinceMs: null }]);
  });

  test("sorts undated rows after dated attention", () => {
    const runs: DaemonListRunRow[] = [
      listRun({ runId: "run-b", status: "failed", finishedAtMs: 1_000 }),
      listRun({ runId: "run-a", status: "blocked" }),
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

    const projection = buildAttentionRows(undefined, runs);

    expect(projection.rows.map((row) => row.id)).toEqual([
      "attention:failed-run:run-b",
      "attention:failed-run:run-aaa",
      "attention:failed-run:run-zzz",
      "attention:failed-run:run-m1",
      "attention:failed-run:run-m2",
      "attention:blocked-run:run-a",
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

  test("filters and caps attention sources", () => {
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

    const blockedRun = listRun({ runId: "run-adhoc-blocked", status: "blocked" });

    // Non-actionable statuses: filtered out entirely, never counted toward total.
    const completedRun = listRun({ runId: "run-completed", status: "completed", finishedAtMs: 10 });
    const inProgressRun = listRun({ runId: "run-in-progress", status: "in-progress" });

    const projection = buildAttentionRows(
      {
        a: socketSnapshots([pipe1, pipe2, pipe3Published]),
        b: socketSnapshots([pipe1Stale]),
      },
      [failedRun, blockedRun, completedRun, inProgressRun],
    );

    expect(projection.total).toBe(7);
    expect(projection.rows.length).toBe(6);
    expect(projection.overflow).toBe(1);
    // The undated blocked-run incident sorts last and is the one dropped by the cap.
    expect(projection.rows.map((row) => row.id)).not.toContain("attention:blocked-run:run-adhoc-blocked");

    const pipe1Gate = projection.rows.find((row) => row.id === "attention:gate:pipe-1:approve-plan:default");
    expect(pipe1Gate?.sinceMs).toBe(500);
    const pipe2Gate = projection.rows.find((row) => row.id === "attention:gate:pipe-2:approve-plan:default");
    expect(pipe2Gate?.sinceMs).toBe(2_000);

    // Mutation checkpoint: in-body mutation directives invert every added source, canonical-source
    // suppression, predecessor-kind timestamp, terminal-publication durability, filtering, and the cap
    // guard; each turns this test red.
    // @mutate v2/src/tui/tui-attention-rows.ts "if (stage.status === \"awaiting\") {" -> "if (false) {"
    // @mutate v2/src/tui/tui-attention-rows.ts "} else if (stage.status === \"rejected\") {" -> "} else if (false) {"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (stage.status === \"failed\") {" -> "if (false) {"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (status === \"failed\") return \"failed-run\";" -> "if (false) return \"failed-run\";"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (status === \"blocked\") return \"blocked-run\";" -> "if (false) return \"blocked-run\";"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (!hasPipelineTerminalPublicationFailure(snapshot)) return [];" -> "return [];"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (seen.has(snapshot.pipelineId)) continue;" -> "if (false) continue;"
    // @mutate v2/src/tui/tui-attention-rows.ts "if (kinds.get(predecessor.stageId) === \"approval\") return predecessor.decidedAt;" -> "return predecessor.endedAt;"
    // @mutate v2/src/tui/tui-attention-rows.ts "return finishAts.length > 0 ? Math.max(...finishAts) : null;" -> "return finishAts.length > 0 ? Math.max(...finishAts) : snapshot.createdAt;"
    // @mutate v2/src/tui/tui-attention-rows.ts "const rows = incidents.slice(0, ATTENTION_ROW_CAP);" -> "const rows = incidents;"
  });
});
