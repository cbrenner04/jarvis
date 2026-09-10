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
import {
  type LinkedStageSettlementOptions,
  type LinkedStageSettlementStore,
  settleLinkedStagesFromEntryRunWith,
} from "../persistence/pipeline-stage-settlement.ts";
import type {
  Pipeline,
  PipelineStageRecord,
  Run,
  RunStatus,
  StateStore,
  WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { spinUntilMicrotask } from "../testing/bounded-microtask-spin.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { createMinimalDispatchWriteStep } from "../testing/workflow-step-fixtures.ts";
import { listProductionDaemonSources } from "./daemon-terminal-settlement-guard.ts";
import {
  adoptAndSettlePipelineStage,
  adoptPipelineStageUnderAdmission,
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
  shouldStopForInFlightStageRow,
} from "./pipeline-stage-dispatch.ts";
import { createChainedStageProjectMatch, type PipelineContext } from "./pipeline-stage-resolve.ts";
import { preparePipelineStageWorkflow } from "./pipeline-workflow-preparation.ts";
import type { TerminalLogRecord } from "./run-operator-error.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";

const TERMINAL_STAGE_RUN_STATUSES = new Set(["succeeded", "failed", "interrupted", "skipped"]);

// Pre-fix hand-maintained identity registry; red-gates when terminal writes carry endedAt but the map is stale.
const CLASSIFIED_STATUS_WRITES = new Map<string, "terminal" | "nonterminal">([
  ["pipeline-stage-dispatch.ts:settleUnexpectedThrow:failed#1", "terminal"],
  ["pipeline-stage-dispatch.ts:writeRunningStageLinkage:running#1", "nonterminal"],
  ["pipeline-stage-dispatch.ts:dispatchPipelineStage:failed#1", "terminal"],
  ["pipeline-stage-settlement.ts:settleLinkedStagesFromEntryRunWith:failed#1", "terminal"],
  ["pipeline-stage-settlement.ts:settleLinkedStagesFromEntryRunWith:failed#2", "terminal"],
  ["pipeline-stage-settlement.ts:settleLinkedStagesFromEntryRunWith:succeeded#1", "terminal"],
  ["pipeline-execution.ts:admitFanOutBranches:skipped#1", "terminal"],
  ["pipeline-execution.ts:settleApprovalBoundaryFailure:failed#1", "terminal"],
  ["pipeline-execution.ts:skipRemainingStages:skipped#1", "terminal"],
  ["pipeline-execution.ts:failWorkflowStageAt:failed#1", "terminal"],
  ["pipeline-execution.ts:advanceWorkflowStage:failed#1", "terminal"],
  ["pipeline-execution.ts:failStrandedPipelineStage:failed#1", "terminal"],
]);

const DISPATCH_OWNER_EXPORT = /export\s+(?:async\s+)?function\s+dispatchPipelineStage\b/;
const DISPATCH_CHAIN_BOUNDARY_SYMBOLS = [
  "dispatchPipelineStage",
  "adoptAndSettlePipelineStage",
  "adoptPipelineStageUnderAdmission",
  "shouldStopForInFlightStageRow",
  "settlementLinkedEntryRunId",
  "isLiveEntryRun",
] as const;

type StatusWrite = {
  endedAt: ts.Expression | undefined;
  /** True when `endedAt` is a literal, `Date.now()`, or a shorthand bound to `Date.now()` in-file. */
  endedAtIsTimestamp: boolean;
  identity: string;
  status: string;
};

/**
 * Names bound in this file by `const <name> = Date.now()`. A patch may pass `endedAt` in shorthand,
 * and the guard must resolve that to its binding rather than read the property as absent.
 */
function nowBoundNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isNowCall(node.initializer)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** The property's value expression, resolving `{ endedAt }` shorthand to its identifier. */
function patchPropertyValue(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const assignment = propertyAssignment(object, name);
  if (assignment !== undefined) return assignment.initializer;
  const shorthand = object.properties.find(
    (property): property is ts.ShorthandPropertyAssignment =>
      ts.isShorthandPropertyAssignment(property) && property.name.text === name,
  );
  return shorthand?.name;
}

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
  const nowBound = nowBoundNames(source);

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
            ts.isShorthandPropertyAssignment(property) ||
            (ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))),
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
        const endedAt = patchPropertyValue(patch, "endedAt");
        writes.push({
          identity: `${occurrenceKey}#${occurrence}`,
          status,
          endedAt,
          endedAtIsTimestamp: isNumericTimestamp(endedAt, nowBound),
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextScope));
  };

  visit(source);
  return writes;
}

function isNowCall(expression: ts.Expression): boolean {
  return (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 0 &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Date" &&
    expression.expression.name.text === "now"
  );
}

function isNumericTimestamp(expression: ts.Expression | undefined, nowBound: ReadonlySet<string> = new Set()): boolean {
  if (expression === undefined) return false;
  if (ts.isNumericLiteral(expression) || isNowCall(expression)) return true;
  return ts.isIdentifier(expression) && nowBound.has(expression.text);
}

function resolveDaemonRelativeImport(specifier: string): string {
  const base = specifier.startsWith("./") ? specifier.slice(2) : specifier;
  return base.endsWith(".ts") ? base : `${base}.ts`;
}

function dispatchOwnerRelativePaths(sources: Readonly<Record<string, string>>): string[] {
  return Object.entries(sources)
    .filter(([, source]) => DISPATCH_OWNER_EXPORT.test(source))
    .map(([rel]) => rel)
    .sort();
}

function importsFromDispatchOwner(source: string, ownerPaths: ReadonlySet<string>): boolean {
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
    const names = match[1];
    const specifier = match[2];
    if (names === undefined || specifier === undefined) continue;
    if (!DISPATCH_CHAIN_BOUNDARY_SYMBOLS.some((symbol) => names.includes(symbol))) continue;
    if (ownerPaths.has(resolveDaemonRelativeImport(specifier))) return true;
  }
  return false;
}

export function dispatchChainRelativePaths(sources: Readonly<Record<string, string>>): string[] {
  const ownerPaths = new Set(dispatchOwnerRelativePaths(sources));
  return Object.keys(sources)
    .filter((rel) => ownerPaths.has(rel) || importsFromDispatchOwner(sources[rel] ?? "", ownerPaths))
    .sort();
}

/**
 * The dispatch chain's terminal stage writes live in two places: the daemon modules that dispatch and
 * recover stages, and the shared linked-stage settlement algorithm the store delegates to. Scanning
 * only the daemon directory would leave every settlement write unguarded.
 */
const SHARED_STAGE_SETTLEMENT_SOURCE = "../persistence/pipeline-stage-settlement.ts";

function listPipelineStageStatusWriteSourcePaths(): string[] {
  return [...dispatchChainRelativePaths(listProductionDaemonSources()), SHARED_STAGE_SETTLEMENT_SOURCE].map((rel) =>
    join(import.meta.dir, rel),
  );
}

/** Pre-fix map-equality oracle; red-gates when a new status write lands without updating the registry. */
export function classifiedStatusWritesMapEqualityGuard(writes: readonly StatusWrite[]): boolean {
  return (
    JSON.stringify(writes.map(({ identity }) => identity).sort()) ===
    JSON.stringify([...CLASSIFIED_STATUS_WRITES.keys()].sort())
  );
}

test("every terminal pipeline stage-run write carries endedAt", () => {
  const writes = listPipelineStageStatusWriteSourcePaths().flatMap(parseStatusWrites);
  expect(writes.length).toBeGreaterThan(0);
  expect(TERMINAL_STAGE_RUN_STATUSES.has("approved")).toBe(false);
  expect(TERMINAL_STAGE_RUN_STATUSES.has("rejected")).toBe(false);

  const withUnregisteredTerminalWrite = [
    ...writes,
    {
      identity: "pipeline-stage-dispatch-settlement.ts:settleSibling:failed#1",
      status: "failed",
      endedAt: undefined,
      endedAtIsTimestamp: false,
    },
  ];
  expect(classifiedStatusWritesMapEqualityGuard(withUnregisteredTerminalWrite)).toBe(false);

  const vacuousMapMatchMissingEndedAt = writes.map((write) =>
    TERMINAL_STAGE_RUN_STATUSES.has(write.status) ? { ...write, endedAt: undefined, endedAtIsTimestamp: false } : write,
  );
  expect(classifiedStatusWritesMapEqualityGuard(vacuousMapMatchMissingEndedAt)).toBe(true);

  for (const write of writes) {
    const terminal = write.endedAt !== undefined;
    if (TERMINAL_STAGE_RUN_STATUSES.has(write.status)) {
      expect(terminal).toBe(true);
      expect(write.endedAtIsTimestamp).toBe(true);
    } else {
      expect(terminal).toBe(false);
    }
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
  registerStageRow: (record: PipelineStageRecord & { pipelineId: string }) => void;
} {
  const patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }> = [];
  const admissionRows = new Map<string, string>();
  const currentIdentity = "test-holder";
  // Stage rows the fake keeps in sync with applied patches, so linked-stage settlement can find them
  // the way the SQLite store does.
  const stageRows = new Map<string, PipelineStageRecord & { pipelineId: string }>();
  const stageKey = (pipelineId: string, stageId: string, branchKey?: string) =>
    `${pipelineId}:${stageId}:${branchKey ?? "default"}`;
  const store = {
    updateStage: (args: {
      pipelineId: string;
      stageId: string;
      branchKey?: string;
      patch: Record<string, unknown>;
      requiredStatus?: string;
    }) => {
      const key = stageKey(args.pipelineId, args.stageId, args.branchKey);
      // Mirror the store's compare-and-set: a settlement racing another writer must no-op.
      if (args.requiredStatus !== undefined && stageRows.get(key)?.status !== args.requiredStatus) return false;
      patches.push(args);
      const existing =
        stageRows.get(key) ??
        ({
          ...stageRecord({ stageId: args.stageId, branchKey: args.branchKey ?? "default" }),
          pipelineId: args.pipelineId,
        } as PipelineStageRecord & { pipelineId: string });
      stageRows.set(key, { ...existing, ...(args.patch as Partial<PipelineStageRecord>) });
    },
    loadRun: (runId: string) => {
      const run = runsById[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
    findRunsByInvocationId: (invocationId: string) =>
      Object.entries(runsById)
        .filter(([, run]) => run.workflowSnapshot?.invocationId === invocationId)
        .map(([id, run]) => ({ id, attempts: [], ...run }) as unknown as Run),
    loadPipeline: (pipelineId: string) => {
      const stages = [...stageRows.values()].filter((stage) => stage.pipelineId === pipelineId);
      if (stages.length === 0) return null;
      return { id: pipelineId, definition: { name: "fake", stages: [] }, stages } as unknown as Pipeline & {
        stages: PipelineStageRecord[];
      };
    },
    listPipelines: () => {
      const byPipeline = new Map<string, PipelineStageRecord[]>();
      for (const stage of stageRows.values()) {
        byPipeline.set(stage.pipelineId, [...(byPipeline.get(stage.pipelineId) ?? []), stage]);
      }
      return [...byPipeline].map(
        ([id, stages]) => ({ id, definition: { name: "fake", stages: [] }, stages }) as unknown as Pipeline,
      );
    },
    settleLinkedStagesFromEntryRun: (entryRunId: string, options?: LinkedStageSettlementOptions) =>
      settleLinkedStagesFromEntryRunWith(store as unknown as LinkedStageSettlementStore, entryRunId, options),
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
  /** Seed the row a dispatched/adopted stage would already have, so settlement can resolve it. */
  const registerStageRow = (record: PipelineStageRecord & { pipelineId: string }) => {
    stageRows.set(stageKey(record.pipelineId, record.stageId, record.branchKey), record);
  };
  return { store, patches, registerStageRow };
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
  const { store, patches, registerStageRow } = fakeStore({ [entryRunId]: runState });
  registerStageRow({
    ...stageRecord({ status: "running", workflowInvocationId: entryRunId }),
    pipelineId: "p1",
  });
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

function entryReviewSnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [
      { stepId: "s1-entry", role: "intent", durable: true },
      { stepId: "s1-review", role: "review", behavior: "review", durable: true },
    ],
  };
}

/** Minimal single-durable-step snapshot: the entry row alone decides the rollup. */
function entryOnlySnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [{ stepId: "s1-entry", role: "write", behavior: "write", durable: true }],
  } as unknown as WorkflowSnapshot;
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

type RefusedRunningClaimOutcome = {
  dispatchCalled: boolean;
  waitCalled: boolean;
  reloadedEntryRunIds: string[];
  patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }>;
};

async function runRefusedClaimOnRunningRow(args: {
  entryRunId: string;
  run: Partial<Run>;
  stage: Partial<PipelineStageRecord>;
}): Promise<RefusedRunningClaimOutcome> {
  let dispatchCalled = false;
  const dispatch: PipelineWorkflowDispatch = async () => {
    dispatchCalled = true;
    return { ok: true, entryRunId: args.entryRunId };
  };
  let waitCalled = false;
  const wait: PipelineWorkflowWait = async () => {
    waitCalled = true;
    return "failed";
  };
  const { store, patches } = fakeStore({ [args.entryRunId]: args.run });
  const loadRun = store.loadRun.bind(store);
  const reloadedEntryRunIds: string[] = [];
  store.claimPipelineStageAdmission = () => ({ kind: "refused", reason: "claim_lost" });
  store.loadPipeline = () =>
    ({
      stages: [stageRecord({ status: "running", workflowInvocationId: args.entryRunId, ...args.stage })],
    }) as ReturnType<StateStore["loadPipeline"]>;
  store.loadRun = (runId) => {
    reloadedEntryRunIds.push(runId);
    return loadRun(runId);
  };

  await dispatchPipelineStage({
    pipelineId: "p1",
    stageId: "s1",
    steps: [createMinimalDispatchWriteStep()],
    dispatch,
    wait,
    store,
  });

  return { dispatchCalled, waitCalled, reloadedEntryRunIds, patches };
}

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

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

    expect(dispatchCalled).toBe(false);
    expect(releaseCount).toBe(0);
    expect(patches).toHaveLength(0);
  });

  test("adopts and settles when the stage row is running with a terminal linked entry run pending re-settlement", async () => {
    const entryRunId = "entry-adopt";
    const outcome = await runRefusedClaimOnRunningRow({
      entryRunId,
      run: { specPath: "spec/adopt.md", status: "failed" },
      stage: {
        failureDetail: {
          code: "settlement_deferred",
          reason: "entry_run_still_live",
          entryRunId,
          rollupStatus: "failed",
        },
      },
    });

    expect(outcome.dispatchCalled).toBe(false);
    expect(outcome.waitCalled).toBe(false);
    expect(outcome.reloadedEntryRunIds).toEqual([entryRunId]);
    expect(outcome.patches).toHaveLength(0);
  });

  test("adopts and settles a deferred running stage into succeeded, clearing the deferred failureDetail", async () => {
    const entryRunId = "entry-clear";
    const outcome = await runRefusedClaimOnRunningRow({
      entryRunId,
      run: { specPath: "spec/clear.md", status: "completed" },
      stage: {
        failureDetail: {
          code: "settlement_deferred",
          reason: "entry_run_still_live",
          entryRunId,
          rollupStatus: "in-progress",
        },
      },
    });

    expect(outcome.dispatchCalled).toBe(false);
    expect(outcome.waitCalled).toBe(false);
    expect(outcome.patches).toHaveLength(0);
  });

  test("adopts and settles when the stage row is running with a live entry run", async () => {
    const outcome = await runRefusedClaimOnRunningRow({
      entryRunId: "entry-adopt",
      run: { specPath: "spec/adopt.md", status: "in-progress" },
      stage: {},
    });

    expect(outcome.dispatchCalled).toBe(false);
    expect(outcome.waitCalled).toBe(false);
    expect(outcome.patches).toHaveLength(0);
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

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

    expect(releaseCount).toBe(1);
  });
});

describe("adoptPipelineStageUnderAdmission", () => {
  test("a refused durable claim re-reads without adoption, settlement, or release", async () => {
    const entryRunId = "entry-adopt";
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/adopt.md", status: "in-progress" },
    });
    let adoptCount = 0;
    let releaseCount = 0;
    const loadRun = store.loadRun.bind(store);
    const reloadedEntryRunIds: string[] = [];
    store.claimPipelineStageAdmission = () => ({ kind: "refused", reason: "claim_lost" });
    store.releasePipelineStageAdmission = () => {
      releaseCount += 1;
      return { kind: "applied" };
    };
    store.loadPipeline = () =>
      ({
        stages: [stageRecord({ status: "running", workflowInvocationId: entryRunId })],
      }) as ReturnType<StateStore["loadPipeline"]>;
    store.loadRun = (runId) => {
      reloadedEntryRunIds.push(runId);
      return loadRun(runId);
    };

    await adoptPipelineStageUnderAdmission({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      adopt: async () => {
        adoptCount += 1;
      },
    });

    expect(adoptCount).toBe(0);
    expect(releaseCount).toBe(0);
    expect(reloadedEntryRunIds).toEqual([entryRunId]);
    expect(patches).toHaveLength(0);
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
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

    await spinUntilMicrotask(() => waitCalled, "waitCalled");

    const linkagePatch = patches.find((p) => p.patch.workflowInvocationId !== undefined);
    expect(linkagePatch?.patch.workflowInvocationId).toBe("entry-1");
    expect(linkagePatch?.patch.status).toBe("running");
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.some((p) => p.patch.endedAt !== undefined)).toBe(false);
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
      "entry-2": {
        stepId: "s1-entry",
        specPath: "spec/bar.md",
        status: "completed",
        workflowSnapshot: entryOnlySnapshot("inv-2"),
        prNumber: 42,
        prUrl: "https://example.com/pr/42",
      },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

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

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

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

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

    expect(waitCalled).toBe(false);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.status).toBe("failed");
    expect(patches[0]?.patch.failureDetail).toEqual({ code: "worktree_claimed", message: "already claimed" });
    expect(patches[0]?.patch.startedAt).toBeUndefined();
    expect(patches[0]?.patch.workflowInvocationId).toBeUndefined();
  });

  test("post-admission linkage-write failure preserves the live entry run and settles after recovery", async () => {
    let linkageWrites = 0;
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
    });
    // Live while dispatch runs; the wait primitive resolves only once the row is durably terminal,
    // so settlement is driven by the durable row rather than by the failed dispatch path.
    const wait: PipelineWorkflowWait = async () => {
      runState.status = "completed";
      return "completed";
    };
    const runState: Partial<Run> = {
      stepId: "s1-entry",
      specPath: "spec/recover.md",
      status: "in-progress",
      workflowSnapshot: entryOnlySnapshot("inv-link-fail"),
    };
    const { store, patches } = fakeStore({ "entry-link-fail": runState });
    const originalUpdateStage = store.updateStage.bind(store);
    store.updateStage = (args) => {
      if (args.patch.workflowInvocationId !== undefined) {
        linkageWrites += 1;
        if (linkageWrites === 1) throw new Error("forced linkage write failure");
      }
      return originalUpdateStage(args);
    };

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });
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
      runState.status = "completed";
      return "completed";
    };
    // Live while dispatch runs; flipped terminal before adopting, so settlement is driven by the
    // durable row rather than by the failed dispatch path.
    const runState: Partial<Run> = {
      stepId: "s1-entry",
      specPath: "spec/wait-recover.md",
      status: "in-progress",
      workflowSnapshot: entryOnlySnapshot("inv-wait-fail"),
    };
    const { store, patches } = fakeStore({ "entry-wait-fail": runState });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });
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
  });

  test("dispatch catch over a live admitted entry run leaves the stage running with no marker", async () => {
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

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
    // No deferred marker is written: the row stays linked and `running`, and the settlement owner
    // settles it from the entry run's durable rows on its terminal event or at daemon start.
    expect(patches.some((p) => p.patch.failureDetail !== undefined)).toBe(false);
    expect(patches.at(-1)?.patch.status).toBe("running");
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

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

    expectStageNotTerminalized(patches);
    // A `wait` result never terminalizes a stage on its own — only the entry run's durable rows do.
    expect(patches.some((p) => p.patch.failureDetail !== undefined)).toBe(false);
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

  test("an unsettled stage settles with operator error once its entry run is durably terminal", async () => {
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
    expect(patches.some((p) => p.patch.failureDetail !== undefined)).toBe(false);

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
      steps: [createMinimalDispatchWriteStep()],
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
  });

  test("a completed rollup without a recorded spec path records failed, not succeeded with an empty artifact", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-missing-spec",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-missing-spec": { stepId: "s1-entry", status: "completed", specPath: "" },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

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
        stepId: "s1-entry",
        specPath: "ready-intents",
        status: "completed",
        workflowSnapshot: entryOnlySnapshot("inv-multi"),
        downstreamInputs: ["ready-intents/one.md", "ready-intents/two.md"],
      },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

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
      "entry-single-file": {
        stepId: "s1-entry",
        specPath: "ready-intents/single.md",
        status: "completed",
        workflowSnapshot: entryOnlySnapshot("inv-single-file"),
      },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
      dispatch,
      wait,
      store,
    });

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
      [entryRunId]: {
        stepId: "s1-entry",
        specPath: "spec/implement.md",
        status: "completed",
        workflowSnapshot: entryOnlySnapshot("inv-retarget-success"),
        prNumber: 42,
        prUrl: "https://example.com/pr/42",
      },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [createMinimalDispatchWriteStep()],
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
      steps: [createMinimalDispatchWriteStep()],
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
