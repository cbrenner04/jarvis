import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import ts from "typescript";
import { resolveWorkflowPresetName } from "../commands/workflow-start-preparation.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import { resolveReadyGateCommand } from "../execution/ready-finalize.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import type { PipelineStageRecord, Run, RunStatus, StateStore, WorkflowSnapshot } from "../persistence/state-store.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import {
  adoptAndSettlePipelineStage,
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
  redrivableDeferredSettlementEntryRunId,
  shouldStopForInFlightStageRow,
  unsettledTerminalStageEntryRunId,
} from "./pipeline-stage-dispatch.ts";
import { createChainedStageProjectMatch, type PipelineContext } from "./pipeline-stage-resolve.ts";
import { preparePipelineStageWorkflow } from "./pipeline-workflow-preparation.ts";
import type { TerminalLogRecord } from "./run-operator-error.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";

const okStep = { behavior: "write" } as unknown as AnyWorkflowStep;

const STAGE_WRITE_SOURCE_PATHS = [
  join(import.meta.dir, "pipeline-stage-dispatch.ts"),
  join(import.meta.dir, "pipeline-execution.ts"),
] as const;

const CLASSIFIED_STATUS_WRITES = new Map<string, "terminal" | "nonterminal">([
  ["pipeline-stage-dispatch.ts:settleUnexpectedThrow:failed#1", "terminal"],
  ["pipeline-stage-dispatch.ts:writeRunningStageLinkage:running#1", "nonterminal"],
  ["pipeline-stage-dispatch.ts:applyEntryRunSettlement:failed#1", "terminal"],
  ["pipeline-stage-dispatch.ts:applyEntryRunSettlement:succeeded#1", "terminal"],
  ["pipeline-stage-dispatch.ts:applyEntryRunSettlement:failed#2", "terminal"],
  ["pipeline-stage-dispatch.ts:dispatchPipelineStage:failed#1", "terminal"],
  ["pipeline-execution.ts:admitFanOutBranches:skipped#1", "terminal"],
  ["pipeline-execution.ts:settleApprovalBoundaryFailure:failed#1", "terminal"],
  ["pipeline-execution.ts:skipRemainingStages:skipped#1", "terminal"],
  ["pipeline-execution.ts:failWorkflowStageAt:failed#1", "terminal"],
  ["pipeline-execution.ts:advanceWorkflowStage:failed#1", "terminal"],
  ["pipeline-execution.ts:failStrandedPipelineStage:failed#1", "terminal"],
]);

const TERMINAL_STAGE_RUN_STATUSES = new Set(["succeeded", "failed", "interrupted", "skipped"]);

type StatusWrite = { endedAt: ts.Expression | undefined; identity: string; status: string };

function propertyAssignment(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteral(property.name) && property.name.text === name)),
  );
}

function isDirectUpdateStageCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "store" &&
    node.expression.name.text === "updateStage"
  );
}

function isDirectUpdateStageProperty(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) && node.name.text === "updateStage";
}

function isStoreAlias(node: ts.VariableDeclaration): boolean {
  return (
    node.initializer !== undefined &&
    ts.isIdentifier(node.initializer) &&
    node.initializer.text === "store" &&
    (!ts.isIdentifier(node.name) || node.name.text !== "store")
  );
}

function isUpdateStageBinding(node: ts.VariableDeclaration): boolean {
  if (!ts.isObjectBindingPattern(node.name)) return false;
  return node.name.elements.some(
    (element) =>
      (element.propertyName === undefined && ts.isIdentifier(element.name) && element.name.text === "updateStage") ||
      (element.propertyName !== undefined &&
        ((ts.isIdentifier(element.propertyName) && element.propertyName.text === "updateStage") ||
          (ts.isStringLiteral(element.propertyName) && element.propertyName.text === "updateStage"))),
  );
}

function functionName(node: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

function parseStatusWrites(path: string): StatusWrite[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const writes: StatusWrite[] = [];
  const occurrences = new Map<string, number>();

  const visit = (node: ts.Node, scope = "<top-level>"): void => {
    const nextScope = ts.isFunctionLike(node) ? (functionName(node) ?? scope) : scope;
    if (ts.isVariableDeclaration(node)) {
      expect(isStoreAlias(node)).toBe(false);
      expect(isUpdateStageBinding(node)).toBe(false);
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "store") {
      throw new Error("store element access can hide updateStage writes");
    }
    if (isDirectUpdateStageProperty(node)) {
      expect(isDirectUpdateStageCall(node.parent) && node.parent.expression === node).toBe(true);
    }
    if (isDirectUpdateStageCall(node)) {
      const argument = node.arguments[0];
      expect(argument !== undefined && ts.isObjectLiteralExpression(argument)).toBe(true);
      if (!argument || !ts.isObjectLiteralExpression(argument)) return;
      const patchProperty = propertyAssignment(argument, "patch");
      expect(patchProperty !== undefined && ts.isObjectLiteralExpression(patchProperty.initializer)).toBe(true);
      if (patchProperty === undefined || !ts.isObjectLiteralExpression(patchProperty.initializer)) return;
      const patch = patchProperty.initializer;
      expect(
        patch.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)),
        ),
      ).toBe(true);
      const statusProperty = propertyAssignment(patch, "status");
      if (statusProperty !== undefined) {
        expect(ts.isStringLiteral(statusProperty.initializer)).toBe(true);
        if (!ts.isStringLiteral(statusProperty.initializer)) return;
        const status = statusProperty.initializer.text;
        const occurrenceKey = `${basename(path)}:${nextScope}:${status}`;
        const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
        occurrences.set(occurrenceKey, occurrence);
        writes.push({
          identity: `${occurrenceKey}#${occurrence}`,
          status,
          endedAt: propertyAssignment(patch, "endedAt")?.initializer,
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextScope));
  };

  visit(source);
  return writes;
}

function isNumericTimestamp(expression: ts.Expression | undefined): boolean {
  return (
    expression !== undefined &&
    (ts.isNumericLiteral(expression) ||
      (ts.isCallExpression(expression) &&
        expression.arguments.length === 0 &&
        ts.isPropertyAccessExpression(expression.expression) &&
        ts.isIdentifier(expression.expression.expression) &&
        expression.expression.expression.text === "Date" &&
        expression.expression.name.text === "now"))
  );
}

test("every terminal pipeline stage-run write carries endedAt", () => {
  // @mutate v2/src/daemon/pipeline-execution.ts "store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: \"skipped\", endedAt: Date.now() } });" -> "store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: \"skipped\" } });"
  const writes = STAGE_WRITE_SOURCE_PATHS.flatMap(parseStatusWrites);
  expect(writes.map(({ identity }) => identity).sort()).toEqual([...CLASSIFIED_STATUS_WRITES.keys()].sort());
  expect(TERMINAL_STAGE_RUN_STATUSES.has("approved")).toBe(false);
  expect(TERMINAL_STAGE_RUN_STATUSES.has("rejected")).toBe(false);

  for (const write of writes) {
    const classification = CLASSIFIED_STATUS_WRITES.get(write.identity);
    expect(classification).toBe(TERMINAL_STAGE_RUN_STATUSES.has(write.status) ? "terminal" : "nonterminal");
    if (classification === "terminal") expect(isNumericTimestamp(write.endedAt)).toBe(true);
  }
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeStore(runsById: Record<string, Partial<Run>> = {}): {
  store: StateStore;
  patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }>;
} {
  const patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }> = [];
  const admissionRows = new Map<string, string>();
  const currentIdentity = "test-holder";
  const store = {
    updateStage: (args: { pipelineId: string; stageId: string; patch: Record<string, unknown> }) => {
      patches.push(args);
    },
    loadRun: (runId: string) => {
      const run = runsById[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
    findRunsByInvocationId: (invocationId: string) =>
      Object.entries(runsById)
        .filter(([, run]) => run.workflowSnapshot?.invocationId === invocationId)
        .map(([id, run]) => ({ id, attempts: [], ...run }) as unknown as Run),
    loadPipeline: () => null,
    claimPipelineStageAdmission: (args: { pipelineId: string; stageId: string; branchKey?: string }) => {
      const key = `${args.pipelineId}:${args.stageId}:${args.branchKey ?? "default"}`;
      if (admissionRows.has(key)) return { kind: "refused" as const, reason: "claim_lost" as const };
      admissionRows.set(key, currentIdentity);
      return { kind: "applied" as const };
    },
    releasePipelineStageAdmission: (args: { pipelineId: string; stageId: string; branchKey?: string }) => {
      const key = `${args.pipelineId}:${args.stageId}:${args.branchKey ?? "default"}`;
      if (!admissionRows.has(key)) return { kind: "applied" as const };
      admissionRows.delete(key);
      return { kind: "applied" as const };
    },
    loadPipelineStageAdmission: () => ({ kind: "absent" as const }),
  } as unknown as StateStore;
  return { store, patches };
}

function stageRecord(overrides: Partial<PipelineStageRecord> = {}): PipelineStageRecord {
  return {
    stageId: "s1",
    branchKey: "default",
    status: "pending",
    ...overrides,
  } as PipelineStageRecord;
}

function loopFinished(
  entryRunId: string,
  loopOutcomeKind: WriteLoopOutcomeKind,
  extra: Partial<Extract<TerminalLogRecord["event"], { kind: "loop_finished" }>> = {},
): PersistedRecord {
  return {
    runId: entryRunId,
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "loop_finished", loopOutcomeKind, iterationsConsumed: 1, resumable: false, ...extra },
  };
}

const RETARGET_REQUESTED_BASE = "plan/merged-first";
const RETARGET_RESOLVED_BASE = "main";

function expectStageNotTerminalized(patches: Array<{ patch: Record<string, unknown> }>): void {
  expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
  expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
  expect(patches.some((p) => p.patch.endedAt !== undefined)).toBe(false);
}

function runningStageStore(entryRunId: string, runState: Partial<Run>) {
  const { store, patches } = fakeStore({ [entryRunId]: runState });
  store.loadPipeline = () =>
    ({
      stages: [stageRecord({ status: "running", workflowInvocationId: entryRunId })],
    }) as ReturnType<StateStore["loadPipeline"]>;
  return { store, patches };
}

function mirrorWorkflowEntryRunWait(store: StateStore): PipelineWorkflowWait {
  return async (entryRunId) => {
    const run = store.loadRun(entryRunId);
    if (run === null) return "failed";
    return run.status;
  };
}

describe("shouldStopForInFlightStageRow", () => {
  test.each([
    ["pending", stageRecord({ status: "pending" }), true],
    ["running with live link", stageRecord({ status: "running", workflowInvocationId: "entry-live" }), true],
    ["running without link", stageRecord({ status: "running" }), false],
    ["running with dead link", stageRecord({ status: "running", workflowInvocationId: "entry-dead" }), true],
    ["failed", stageRecord({ status: "failed" }), false],
    ["succeeded", stageRecord({ status: "succeeded" }), false],
    ["undefined", undefined, false],
  ] as const)("%s", (_label, record, expected) => {
    const { store } = fakeStore({
      "entry-live": { status: "in-progress" },
      "entry-dead": { status: "completed" },
    });
    expect(shouldStopForInFlightStageRow(store, record)).toBe(expected);
  });
});

describe("redrivableDeferredSettlementEntryRunId", () => {
  const deferredDetail = (entryRunId: string) => ({
    code: "settlement_deferred",
    reason: "entry_run_still_live",
    entryRunId,
    rollupStatus: "failed",
  });

  test("not a running row", () => {
    const { store } = fakeStore();
    expect(redrivableDeferredSettlementEntryRunId(store, stageRecord({ status: "pending" }))).toBeUndefined();
  });

  test("running with no deferred marker", () => {
    const { store } = fakeStore({ "entry-x": { status: "completed" } });
    expect(
      redrivableDeferredSettlementEntryRunId(
        store,
        stageRecord({ status: "running", workflowInvocationId: "entry-x" }),
      ),
    ).toBeUndefined();
  });

  test("running with a differently-shaped failureDetail", () => {
    const { store } = fakeStore({ "entry-x": { status: "completed" } });
    expect(
      redrivableDeferredSettlementEntryRunId(
        store,
        stageRecord({
          status: "running",
          workflowInvocationId: "entry-x",
          failureDetail: { code: "harness_failure", reason: "entry_run_still_live" },
        }),
      ),
    ).toBeUndefined();
  });

  test("running with the deferred marker but a still-live entry run", () => {
    const { store } = fakeStore({ "entry-x": { status: "in-progress" } });
    expect(
      redrivableDeferredSettlementEntryRunId(
        store,
        stageRecord({ status: "running", workflowInvocationId: "entry-x", failureDetail: deferredDetail("entry-x") }),
      ),
    ).toBeUndefined();
  });

  test("running with the deferred marker and a durably terminal entry run redrives", () => {
    const { store } = fakeStore({ "entry-x": { status: "completed" } });
    expect(
      redrivableDeferredSettlementEntryRunId(
        store,
        stageRecord({ status: "running", workflowInvocationId: "entry-x", failureDetail: deferredDetail("entry-x") }),
      ),
    ).toBe("entry-x");
  });

  test("running with the deferred marker and an absent entry run row redrives", () => {
    const { store } = fakeStore();
    expect(
      redrivableDeferredSettlementEntryRunId(
        store,
        stageRecord({
          status: "running",
          workflowInvocationId: "entry-missing",
          failureDetail: deferredDetail("entry-missing"),
        }),
      ),
    ).toBe("entry-missing");
  });
});

function entryReviewSnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [
      { stepId: "s1-entry", role: "intent", durable: true },
      { stepId: "s1-review", role: "review", behavior: "review", durable: true },
    ],
  };
}

function unsettledRollupWedgeRuns(
  entryRunId: string,
  reviewRunId: string,
  invocationId: string,
  reviewStatus: RunStatus,
): Record<string, Partial<Run>> {
  const snapshot = entryReviewSnapshot(invocationId);
  return {
    [entryRunId]: { stepId: "s1-entry", status: "completed", workflowSnapshot: snapshot },
    [reviewRunId]: { stepId: "s1-review", status: reviewStatus, workflowSnapshot: snapshot },
  };
}

describe("unsettledTerminalStageEntryRunId", () => {
  test("not a running row", () => {
    const { store } = fakeStore();
    expect(unsettledTerminalStageEntryRunId(store, stageRecord({ status: "pending" }))).toBeUndefined();
  });

  test("running with deferred marker", () => {
    const entryRunId = "entry-deferred";
    const { store } = fakeStore({ [entryRunId]: { status: "failed" } });
    expect(
      unsettledTerminalStageEntryRunId(
        store,
        stageRecord({
          status: "running",
          workflowInvocationId: entryRunId,
          failureDetail: {
            code: "settlement_deferred",
            reason: "entry_run_still_live",
            entryRunId,
            rollupStatus: "failed",
          },
        }),
      ),
    ).toBeUndefined();
  });

  test("running with a still-live linked entry run", () => {
    const entryRunId = "entry-live";
    const { store } = fakeStore({ [entryRunId]: { status: "in-progress" } });
    expect(
      unsettledTerminalStageEntryRunId(store, stageRecord({ status: "running", workflowInvocationId: entryRunId })),
    ).toBeUndefined();
  });

  test("running with rollup-failed linked run without marker redrives", () => {
    const entryRunId = "entry-failed";
    const reviewRunId = "entry-failed-review";
    const { store } = fakeStore(unsettledRollupWedgeRuns(entryRunId, reviewRunId, "inv-failed", "failed"));
    expect(
      unsettledTerminalStageEntryRunId(store, stageRecord({ status: "running", workflowInvocationId: entryRunId })),
    ).toBe(entryRunId);
  });

  test("running with rollup-completed linked run without marker returns undefined", () => {
    const entryRunId = "entry-completed";
    const reviewRunId = "entry-completed-review";
    const { store } = fakeStore(unsettledRollupWedgeRuns(entryRunId, reviewRunId, "inv-completed", "completed"));
    expect(
      unsettledTerminalStageEntryRunId(store, stageRecord({ status: "running", workflowInvocationId: entryRunId })),
    ).toBeUndefined();
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (rollupStatus !== \"failed\") return undefined;" -> "if (false) return undefined;"
  });
});

describe("dispatchPipelineStage refused claim", () => {
  test("returns early without dispatch or release when the stage row is still pending", async () => {
    let dispatchCalled = false;
    let releaseCount = 0;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "entry-1" };
    };
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore();
    store.claimPipelineStageAdmission = () => ({ kind: "refused", reason: "claim_lost" });
    store.loadPipeline = () =>
      ({
        stages: [stageRecord({ status: "pending" })],
      }) as ReturnType<StateStore["loadPipeline"]>;
    store.releasePipelineStageAdmission = () => {
      releaseCount += 1;
      return { kind: "applied" };
    };

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(dispatchCalled).toBe(false);
    expect(releaseCount).toBe(0);
    expect(patches).toHaveLength(0);
  });

  test("adopts and settles when the stage row is running with a terminal linked entry run pending re-settlement", async () => {
    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "entry-adopt" };
    };
    const wait: PipelineWorkflowWait = async () => "failed";
    const entryRunId = "entry-adopt";
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/adopt.md", status: "failed" },
    });
    store.claimPipelineStageAdmission = () => ({ kind: "refused", reason: "claim_lost" });
    store.loadPipeline = () =>
      ({
        stages: [
          stageRecord({
            status: "running",
            workflowInvocationId: entryRunId,
            failureDetail: {
              code: "settlement_deferred",
              reason: "entry_run_still_live",
              entryRunId,
              rollupStatus: "failed",
            },
          }),
        ],
      }) as ReturnType<StateStore["loadPipeline"]>;

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(dispatchCalled).toBe(false);
    expect(patches.some((p) => p.patch.status === "failed")).toBe(true);
  });

  test("adopts and settles a deferred running stage into succeeded, clearing the deferred failureDetail", async () => {
    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "entry-clear" };
    };
    const wait: PipelineWorkflowWait = async () => "completed";
    const entryRunId = "entry-clear";
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/clear.md", status: "completed" },
    });
    store.claimPipelineStageAdmission = () => ({ kind: "refused", reason: "claim_lost" });
    store.loadPipeline = () =>
      ({
        stages: [
          stageRecord({
            status: "running",
            workflowInvocationId: entryRunId,
            failureDetail: {
              code: "settlement_deferred",
              reason: "entry_run_still_live",
              entryRunId,
              rollupStatus: "in-progress",
            },
          }),
        ],
      }) as ReturnType<StateStore["loadPipeline"]>;

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(dispatchCalled).toBe(false);
    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.failureDetail).toBeNull();
  });

  test("adopts and settles when the stage row is running with a live entry run", async () => {
    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "entry-adopt" };
    };
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-adopt": { specPath: "spec/adopt.md", status: "in-progress" },
    });
    store.claimPipelineStageAdmission = () => ({ kind: "refused", reason: "claim_lost" });
    store.loadPipeline = () =>
      ({
        stages: [stageRecord({ status: "running", workflowInvocationId: "entry-adopt" })],
      }) as ReturnType<StateStore["loadPipeline"]>;

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(dispatchCalled).toBe(false);
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(true);
  });

  test("releases admission after the winner partition completes", async () => {
    let releaseCount = 0;
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-winner",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store } = fakeStore({ "entry-winner": { specPath: "spec/winner.md" } });
    const originalRelease = store.releasePipelineStageAdmission.bind(store);
    store.releasePipelineStageAdmission = (args) => {
      releaseCount += 1;
      return originalRelease(args);
    };

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(releaseCount).toBe(1);
  });
});

describe("dispatchPipelineStage", () => {
  test("records workflowInvocationId before the wait primitive resolves", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-1",
      invocationId: "inv-1",
    });
    const waitDeferred = deferred<RunStatus>();
    let waitCalled = false;
    const wait: PipelineWorkflowWait = async () => {
      waitCalled = true;
      return waitDeferred.promise;
    };
    const { store, patches } = fakeStore({ "entry-1": { specPath: "spec/foo.md" } });

    const donePromise = dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
    });

    while (!waitCalled) {
      await Promise.resolve();
    }

    const linkagePatch = patches.find((p) => p.patch.workflowInvocationId !== undefined);
    expect(linkagePatch?.patch.workflowInvocationId).toBe("entry-1");
    expect(linkagePatch?.patch.status).toBe("running");
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.some((p) => p.patch.endedAt !== undefined)).toBe(false);
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "const rollupStatus = await wait(dispatched.entryRunId);" -> "store.updateStage({ ...stageTarget, patch: { status: \"failed\", endedAt: Date.now() } }); const rollupStatus = await wait(dispatched.entryRunId);"
    waitDeferred.resolve("completed");
    await donePromise;
  });

  test("a completed rollup records succeeded, endedAt, and an artifact reference", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-2",
      invocationId: "inv-2",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-2": { specPath: "spec/bar.md", prNumber: 42, prUrl: "https://example.com/pr/42" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.endedAt).toBeDefined();
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-2",
      invocationId: "inv-2",
      specPath: "spec/bar.md",
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    });
  });

  test.each([
    "failed",
    "blocked",
    "killed",
    "interrupted",
  ] as const)("a %s rollup records failed, endedAt, and a failure detail with no artifact", async (rollupStatus) => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-3",
      invocationId: "inv-3",
    });
    const wait: PipelineWorkflowWait = async () => rollupStatus;
    const { store, patches } = fakeStore({ "entry-3": { specPath: "spec/baz.md", status: rollupStatus } });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const terminalPatch = patches.find((p) => p.patch.status !== undefined && p.patch.status !== "running");
    expect(terminalPatch?.patch.status).toBe("failed");
    expect(terminalPatch?.patch.endedAt).toBeDefined();
    expect(terminalPatch?.patch.failureDetail).toBeDefined();
    expect(terminalPatch?.patch.artifact).toBeUndefined();
  });

  test("pre-run dispatch refusal leaves the stage failed and unlinked", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: false,
      code: "worktree_claimed",
      message: "already claimed",
    });
    let waitCalled = false;
    const wait: PipelineWorkflowWait = async () => {
      waitCalled = true;
      return "completed";
    };
    const { store, patches } = fakeStore();

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(waitCalled).toBe(false);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.status).toBe("failed");
    expect(patches[0]?.patch.failureDetail).toEqual({ code: "worktree_claimed", message: "already claimed" });
    expect(patches[0]?.patch.startedAt).toBeUndefined();
    expect(patches[0]?.patch.workflowInvocationId).toBeUndefined();
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (!dispatched.ok) {" -> "if (false) {"
  });

  test("post-admission linkage-write failure preserves the live entry run and settles after recovery", async () => {
    let linkageWrites = 0;
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-link-fail": { specPath: "spec/recover.md", status: "in-progress" },
    });
    const originalUpdateStage = store.updateStage.bind(store);
    store.updateStage = (args) => {
      if (args.patch.workflowInvocationId !== undefined) {
        linkageWrites += 1;
        if (linkageWrites === 1) throw new Error("forced linkage write failure");
      }
      originalUpdateStage(args);
    };

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);

    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
      wait,
    });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
      specPath: "spec/recover.md",
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {" -> "if (false) {"
  });

  test("post-admission wait rejection preserves the live entry run and settles after recovery", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-wait-fail",
      invocationId: "inv-wait-fail",
    });
    let waitAttempts = 0;
    const wait: PipelineWorkflowWait = async () => {
      waitAttempts += 1;
      if (waitAttempts === 1) throw new Error("forced wait rejection");
      return "completed";
    };
    const { store, patches } = fakeStore({
      "entry-wait-fail": { specPath: "spec/wait-recover.md", status: "in-progress" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.find((p) => p.patch.workflowInvocationId === "entry-wait-fail")).toBeDefined();

    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId: "entry-wait-fail",
      invocationId: "inv-wait-fail",
      wait,
    });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-wait-fail",
      invocationId: "inv-wait-fail",
      specPath: "spec/wait-recover.md",
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {" -> "if (false) {"
  });

  test("dispatch catch over a live admitted entry run records settlement_deferred", async () => {
    const entryRunId = "entry-catch-defer";
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId,
      invocationId: "inv-catch-defer",
    });
    const wait: PipelineWorkflowWait = async () => {
      throw new Error("forced wait rejection");
    };
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/catch-defer.md", status: "in-progress" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
    const deferredPatch = patches.find((p) => p.patch.failureDetail !== undefined);
    expect(deferredPatch?.patch.failureDetail).toEqual({
      code: "settlement_deferred",
      reason: "entry_run_still_live",
      entryRunId,
      rollupStatus: "in-progress",
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {" -> "if (false) {"
  });

  test("non-success settlement declines to terminalize a still-live entry run", async () => {
    const entryRunId = "entry-live-defer";
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId,
      invocationId: "inv-live-defer",
    });
    const wait: PipelineWorkflowWait = async () => "failed";
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/live-defer.md", status: "in-progress" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expectStageNotTerminalized(patches);
    const deferredPatch = patches.find((p) => p.patch.failureDetail !== undefined);
    expect(deferredPatch?.patch.failureDetail).toEqual({
      code: "settlement_deferred",
      reason: "entry_run_still_live",
      entryRunId,
      rollupStatus: "failed",
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (isLiveEntryRun(store, entryRunId)) {" -> "if (false) {"
  });

  test("adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run", async () => {
    const entryRunId = "entry-adopt-live";
    const { store, patches } = runningStageStore(entryRunId, { specPath: "spec/adopt-live.md", status: "in-progress" });
    const wait = mirrorWorkflowEntryRunWait(store);
    let waitCalls = 0;
    const countingWait: PipelineWorkflowWait = async (id) => {
      waitCalls += 1;
      return wait(id);
    };

    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId,
      wait: countingWait,
    });

    expect(waitCalls).toBe(1);
    expectStageNotTerminalized(patches);
  });

  test("deferred settlement re-settles with operator error when entry run later terminals", async () => {
    const entryRunId = "entry-re-settle";
    const terminalRecord = loopFinished(entryRunId, "completion_commit_failed", { resumable: true });
    const runState: Partial<Run> = { specPath: "spec/re-settle.md", status: "in-progress" };
    let waitCalls = 0;
    const wait: PipelineWorkflowWait = async () => {
      waitCalls += 1;
      return "failed";
    };
    const { store, patches } = runningStageStore(entryRunId, runState);
    const loadLogRecords = () => (runState.status === "failed" ? [terminalRecord] : []);

    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId,
      wait,
      loadLogRecords,
    });

    expect(waitCalls).toBe(1);
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    const deferredPatch = patches.find((p) => p.patch.failureDetail !== undefined);
    expect(deferredPatch?.patch.failureDetail).toEqual({
      code: "settlement_deferred",
      reason: "entry_run_still_live",
      entryRunId,
      rollupStatus: "failed",
    });

    runState.status = "failed";
    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId,
      wait,
      loadLogRecords,
    });

    const terminalPatch = patches.find((p) => p.patch.status === "failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(terminalPatch?.patch.failureDetail).toEqual(
      composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord),
    );
    expect(terminalPatch?.patch.failureDetail).not.toEqual({
      reason: "harness_failure",
      retryable: false,
      nextAction: "stop",
    });
  });

  test("non-success settlement mirrors composeRunOperatorError from terminal log context", async () => {
    const entryRunId = "entry-landing-fail";
    const message = "intent: splitter wrote outside .jarvis-intent-stage/: rogue.txt";
    const terminalRecord = loopFinished(entryRunId, "landing_failed", { resumable: true, message });
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId,
      invocationId: "inv-landing-fail",
    });
    const wait: PipelineWorkflowWait = async () => "failed";
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/landing-fail.md", status: "failed" },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
      loadLogRecords: () => [terminalRecord],
    });

    const terminalPatch = patches.find((p) => p.patch.status === "failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(terminalPatch?.patch.failureDetail).toEqual(
      composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord),
    );
    expect(terminalPatch?.patch.failureDetail).toEqual({
      reason: "landing_failed",
      retryable: true,
      nextAction: "resume",
      message,
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "composeRunOperatorError(entryRun, terminalRecord, logRecords)" -> "composeRunOperatorError(entryRun)"
  });

  test("a completed rollup without a recorded spec path records failed, not succeeded with an empty artifact", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-missing-spec",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({ "entry-missing-spec": {} });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const terminalPatch = patches.find((p) => p.patch.status === "failed");
    expect(terminalPatch?.patch.failureDetail).toMatchObject({
      message: expect.stringContaining("without a recorded spec path"),
    });
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
  });

  test("a completed rollup records downstreamInputs from the entry run on the stage artifact", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-multi",
      invocationId: "inv-multi",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-multi": {
        specPath: "ready-intents",
        downstreamInputs: ["ready-intents/one.md", "ready-intents/two.md"],
      },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    // Mutation checkpoint: pipeline-stage-dispatch.test.ts multi-file downstreamInputs artifact
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-multi",
      invocationId: "inv-multi",
      specPath: "ready-intents",
      downstreamInputs: ["ready-intents/one.md", "ready-intents/two.md"],
    });
  });

  test("a completed rollup omits downstreamInputs when the entry run has a file specPath only", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-single-file",
      invocationId: "inv-single-file",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-single-file": { specPath: "ready-intents/single.md" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    // Mutation checkpoint: pipeline-stage-dispatch.test.ts single-file no downstreamInputs artifact
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-single-file",
      invocationId: "inv-single-file",
      specPath: "ready-intents/single.md",
    });
  });

  test("success settlement artifact records publication base retarget from log evidence", async () => {
    const entryRunId = "entry-retarget-success";
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId,
      invocationId: "inv-retarget-success",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const loadLogRecords = () => [
      loopFinished(entryRunId, "complete", {
        resumable: false,
        requestedBase: RETARGET_REQUESTED_BASE,
        resolvedBase: RETARGET_RESOLVED_BASE,
      }),
    ];
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/implement.md", prNumber: 42, prUrl: "https://example.com/pr/42" },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
      loadLogRecords,
    });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId,
      invocationId: "inv-retarget-success",
      specPath: "spec/implement.md",
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
      requestedBase: RETARGET_REQUESTED_BASE,
      resolvedBase: RETARGET_RESOLVED_BASE,
    });
  });

  test("failed settlement failureDetail records publication base retarget from terminal log context", async () => {
    const entryRunId = "entry-retarget-fail";
    const terminalRecord = loopFinished(entryRunId, "completion_commit_failed", {
      resumable: true,
      requestedBase: RETARGET_REQUESTED_BASE,
      resolvedBase: RETARGET_RESOLVED_BASE,
    });
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId,
      invocationId: "inv-retarget-fail",
    });
    const wait: PipelineWorkflowWait = async () => "failed";
    const loadLogRecords = () => [terminalRecord];
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/implement.md", status: "failed" },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
      loadLogRecords,
    });

    const failedPatch = patches.find((p) => p.patch.status === "failed");
    expect(failedPatch?.patch.failureDetail).toEqual({
      reason: "completion_commit_failed",
      nextAction: "resume",
      retryable: true,
      requestedBase: RETARGET_REQUESTED_BASE,
      resolvedBase: RETARGET_RESOLVED_BASE,
    });
  });
});

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

function splitMachineConfigOverrides(machineConfigOverrides: Record<string, unknown>): {
  topLevelOverrides: Record<string, unknown>;
  demoOverrides: Record<string, unknown>;
} {
  const { projects: projectOverrides, ...topLevelOverrides } = machineConfigOverrides;
  const demoOverrides =
    projectOverrides !== null &&
    projectOverrides !== undefined &&
    typeof projectOverrides === "object" &&
    "demo" in projectOverrides &&
    projectOverrides.demo !== undefined &&
    typeof projectOverrides.demo === "object"
      ? (projectOverrides.demo as Record<string, unknown>)
      : {};
  return { topLevelOverrides, demoOverrides };
}

function createChainedHandoffRepo(machineConfigOverrides: Record<string, unknown> = {}): {
  repoRoot: string;
  configPath: string;
  planBranch: string;
  planWorktree: string;
  planSpecRel: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), "pipeline-dispatch-stamp-repo-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

  const planBranch = "plan/feature";
  const planSpecRel = "spec/feature/index.md";
  const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
  mkdirSync(planWorktree, { recursive: true });
  execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
  mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
  writeFileSync(join(planWorktree, planSpecRel), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
  writeFileSync(
    join(planWorktree, "spec/feature/00-work.md"),
    "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
    "utf8",
  );
  execFileSync("git", ["add", "-A"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

  const { topLevelOverrides, demoOverrides } = splitMachineConfigOverrides(machineConfigOverrides);
  const configPath = writeHomeMachineConfig({
    ...topLevelOverrides,
    projects: { demo: { root: repoRoot, ...demoOverrides } },
  });
  return { repoRoot, configPath, planBranch, planWorktree, planSpecRel };
}

async function prepareImplementStageSteps(
  handoff: ReturnType<typeof createChainedHandoffRepo>,
  reviewPosture: "light" | "debate",
  uuid: string,
): Promise<AnyWorkflowStep[]> {
  const context: PipelineContext = { cwd: handoff.repoRoot, configPath: handoff.configPath, seed: "unused" };
  const presetName = resolveWorkflowPresetName("implement", reviewPosture);
  if (presetName === undefined) throw new Error("expected implement preset");
  const projectMatch = createChainedStageProjectMatch(context)(handoff.planWorktree);
  if (projectMatch === undefined) throw new Error("expected project match");
  const builderInput: BuildImplementWorkflowStepsInput = {
    cwd: handoff.planWorktree,
    baseRef: "main",
    preflightBaseRef: handoff.planBranch,
    specPath: handoff.planSpecRel,
    configPath: handoff.configPath,
    projectRegistry: { demo: { root: handoff.repoRoot } },
    projectRoot: projectMatch.root,
    projectName: projectMatch.key,
    preflightGitRoot: handoff.planWorktree,
  };
  const result = await withFixedUuid(uuid, () =>
    preparePipelineStageWorkflow("implement", presetName, builderInput, context, WORKFLOW_PRESET_BUILDERS),
  );
  if (!result.ok) throw new Error(result.error);
  return result.steps;
}

// Exercises stamping on the production preparation path (preparePipelineStageWorkflow → prepareWorkflowStart).
async function runImplementStageDispatch(
  configOverrides: Record<string, unknown>,
  reviewPosture: "light" | "debate",
  uuid: string,
): Promise<AnyWorkflowStep[]> {
  const handoff = createChainedHandoffRepo(configOverrides);
  return prepareImplementStageSteps(handoff, reviewPosture, uuid);
}

describe("pipeline stage dispatch step-config stamping", () => {
  test("dispatches implement write steps with configured fix and ready commands", async () => {
    // @mutate v2/src/commands/workflow-step-config-stamp.ts "...(fixCommand !== undefined ? { fixCommand } : {})," -> "...(false ? { fixCommand } : {}),"
    const dispatched = await runImplementStageDispatch(
      { projects: { demo: { fixCommand: "npm run fix-custom", readyCommand: "npm run verify-custom" } } },
      "light",
      "00000000-0000-4000-8000-000000000201",
    );
    const stampedWrite = dispatched.find(
      (step): step is WriteWorkflowStep => step.behavior === "write" && step.role === "implement",
    );
    expect(stampedWrite).toMatchObject({
      fixCommand: "npm run fix-custom",
      readyCommand: "npm run verify-custom",
    });
  });

  test("dispatches implement write steps with configured write-path iteration bounds", async () => {
    const dispatched = await runImplementStageDispatch(
      {
        iterationTimeoutMs: 120_000,
        iterationCeilingMs: 240_000,
        idleOutputTimeoutMs: 45_000,
      },
      "light",
      "00000000-0000-4000-8000-000000000202",
    );
    const stampedWrite = dispatched.find(
      (step): step is WriteWorkflowStep => step.behavior === "write" && step.role === "implement",
    );
    expect(stampedWrite).toMatchObject({
      iterationTimeoutMs: 120_000,
      iterationCeilingMs: 240_000,
      idleOutputMs: 45_000,
    });
  });

  test("dispatches review steps with configured role and idle-output timeouts", async () => {
    const timeoutOverrides = {
      reviewRoleTimeoutMs: 900_000,
      idleOutputTimeoutMs: 123_456,
    };
    const lightSteps = await runImplementStageDispatch(
      { ...timeoutOverrides, projects: { demo: { implement: { reviewBehavior: "light", reviewPasses: 1 } } } },
      "light",
      "00000000-0000-4000-8000-000000000203",
    );
    const debateSteps = await runImplementStageDispatch(
      { ...timeoutOverrides, projects: { demo: { implement: { reviewBehavior: "debate", reviewPasses: 1 } } } },
      "debate",
      "00000000-0000-4000-8000-000000000204",
    );
    const review = lightSteps.find((step) => step.behavior === "review");
    const reviewDebate = debateSteps.find((step) => step.behavior === "review-debate");
    expect(review).toMatchObject({ behavior: "review", roleTimeoutMs: 900_000, idleOutputMs: 123_456 });
    expect(reviewDebate).toMatchObject({
      behavior: "review-debate",
      roleTimeoutMs: 900_000,
      idleOutputMs: 123_456,
    });
  });

  test("dispatches implement write steps with documented defaults when project commands are unset", async () => {
    const dispatched = await runImplementStageDispatch(
      { projects: { demo: {} } },
      "light",
      "00000000-0000-4000-8000-000000000205",
    );
    const stampedWrite = dispatched.find(
      (step): step is WriteWorkflowStep => step.behavior === "write" && step.role === "implement",
    );
    if (!stampedWrite) throw new Error("expected write step");
    expect(stampedWrite).not.toHaveProperty("fixCommand");
    expect(stampedWrite).not.toHaveProperty("readyCommand");
    expect(stampedWrite).toMatchObject({
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
      idleOutputMs: 90_000,
    });
    expect(resolveReadyGateCommand(stampedWrite.readyCommand).display).toBe("bun run ready");
    expect(stampedWrite.fixCommand ?? "bun run fix").toBe("bun run fix");
  });
});
