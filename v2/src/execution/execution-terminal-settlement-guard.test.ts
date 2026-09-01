import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type RunStatus, TERMINAL_RUN_STATUSES } from "../persistence/state-store.ts";

const EXECUTION_DIR = import.meta.dir;
const NONTERMINAL_RUN_STATUSES = new Set<RunStatus>(["in-progress", "paused", "queued", "budget-soft-stopped"]);
const SETTLEMENT_EVIDENCE = /terminalCause:|completionBoundarySettlementFields\(|completedPublicationBoundaryFields\(/;

export type TerminalSettlementViolation = {
  file: string;
  line: number;
  functionName: string;
  kind: "setPrEvidence" | "terminalSetRunStatus" | "unsettledTerminalBoundary";
  detail?: string;
};

export type PermittedTerminalWrite = {
  file: string;
  line: number;
  functionName: string;
  writer: "commitTerminalRunSettlement" | "commitCompletionBoundary";
};

export type PermittedNonterminalSetRunStatus = {
  file: string;
  line: number;
  functionName: string;
  status: RunStatus;
};

const PERMITTED_TERMINAL_WRITES: PermittedTerminalWrite[] = [
  {
    file: "successor-step-idle-watchdog.ts",
    line: 89,
    functionName: "settleSuccessorShellStall",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 204,
    functionName: "settleCompletedPublication",
    writer: "commitTerminalRunSettlement",
  },
  {
    file: "workflow-runner.ts",
    line: 251,
    functionName: "settleWorkflowPublicationFailure",
    writer: "commitTerminalRunSettlement",
  },
  { file: "workflow-runner.ts", line: 1029, functionName: "executeWorkflow", writer: "commitTerminalRunSettlement" },
  { file: "workflow-runner.ts", line: 1082, functionName: "executeWorkflow", writer: "commitTerminalRunSettlement" },
  {
    file: "workflow-runner.ts",
    line: 2518,
    functionName: "commitReviewDebateOutcome",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2527,
    functionName: "commitReviewDebateOutcome",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2570,
    functionName: "settleReviewedStagedMarkdownLintFailure",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2708,
    functionName: "repromptReviewedStagedMarkdownLintOrFail",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2747,
    functionName: "landReviewedOutputOrFail",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2788,
    functionName: "landReviewedOutputOrFail",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2851,
    functionName: "tryActuatorOnlyReviewDebateRetry",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 2933,
    functionName: "tryActuatorOnlyReviewDebateRetry",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 3005,
    functionName: "tryActuatorOnlyReviewDebateRetry",
    writer: "commitCompletionBoundary",
  },
  { file: "workflow-runner.ts", line: 3218, functionName: "finishReviewedLanding", writer: "commitCompletionBoundary" },
  {
    file: "workflow-runner.ts",
    line: 3970,
    functionName: "settleIntentResumeFailure",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4153,
    functionName: "runIntentResumeCommitAndPublish",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4190,
    functionName: "runIntentResumeCommitAndPublish",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4487,
    functionName: "settleReviewMutationResumeFailure",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4643,
    functionName: "settleMutationRepairExhausted",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4834,
    functionName: "runMutationRepairAttempt",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4898,
    functionName: "settleFailedReviewMutationPublication",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 4950,
    functionName: "settleSuccessfulReviewMutationPublication",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 5236,
    functionName: "commitIntentStageInvocationFailure",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    line: 5451,
    functionName: "finalizeStandardReviewStep",
    writer: "commitCompletionBoundary",
  },
  {
    file: "write-loop.ts",
    line: 190,
    functionName: "settleCompletedPublication",
    writer: "commitTerminalRunSettlement",
  },
  { file: "write-loop.ts", line: 1246, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1323, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1396, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1448, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1521, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1603, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1704, functionName: "executeWriteLoop", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 1784, functionName: "executeWriteLoop", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", line: 2130, functionName: "finishIterationTimeout", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 2250, functionName: "finishExecuteWriteThrow", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 2698, functionName: "runReadyRepairIteration", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 2756, functionName: "runMutationRepairIteration", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", line: 3581, functionName: "completionCommitFailed", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", line: 3684, functionName: "readyFailed", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", line: 3982, functionName: "iterationCommitFailed", writer: "commitTerminalRunSettlement" },
];

const PERMITTED_NONTERMINAL_SET_RUN_STATUS: PermittedNonterminalSetRunStatus[] = [
  { file: "workflow-runner.ts", line: 282, functionName: "settlePostCommitShrinkForResume", status: "paused" },
  { file: "workflow-runner.ts", line: 1259, functionName: "executeWorkflow", status: "in-progress" },
  { file: "workflow-runner.ts", line: 4132, functionName: "runIntentResumeCommitAndPublish", status: "in-progress" },
  { file: "workflow-runner.ts", line: 4756, functionName: "runMutationRepairAttempt", status: "in-progress" },
  { file: "workflow-runner.ts", line: 5018, functionName: "runReviewMutationCommitAndPublish", status: "in-progress" },
  { file: "workflow-runner.ts", line: 5056, functionName: "replayMutationFinalization", status: "in-progress" },
  { file: "write-loop.ts", line: 968, functionName: "executeWriteLoop", status: "in-progress" },
  { file: "write-loop.ts", line: 1084, functionName: "executeWriteLoop", status: "in-progress" },
  { file: "write-loop.ts", line: 1216, functionName: "executeWriteLoop", status: "paused" },
  { file: "write-loop.ts", line: 1299, functionName: "executeWriteLoop", status: "paused" },
  { file: "write-loop.ts", line: 1378, functionName: "executeWriteLoop", status: "paused" },
  { file: "write-loop.ts", line: 1503, functionName: "executeWriteLoop", status: "paused" },
  { file: "write-loop.ts", line: 1650, functionName: "executeWriteLoop", status: "paused" },
  { file: "write-loop.ts", line: 1843, functionName: "executeWriteLoop", status: "in-progress" },
  { file: "write-loop.ts", line: 1937, functionName: "executeWriteLoop", status: "budget-soft-stopped" },
  { file: "write-loop.ts", line: 3958, functionName: "_commitRepromptProgressBoundary", status: "paused" },
];

function isProductionExecutionSource(name: string): boolean {
  return name.endsWith(".ts") && !name.includes(".test.") && !name.endsWith(".test-support.ts");
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function enclosingFunctionName(source: string, index: number): string {
  const before = source.slice(0, index);
  const matches = [...before.matchAll(/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)];
  return matches.at(-1)?.[1] ?? "<module>";
}

function extractCall(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex, i + 1);
    }
  }
  return source.slice(openParenIndex);
}

function literalRunStatus(call: string): RunStatus | undefined {
  const literal = call.match(/runStatus:\s*["']([^"']+)["']/);
  return literal?.[1] as RunStatus | undefined;
}

function literalSetRunStatus(call: string): RunStatus | undefined {
  const literal = call.match(/,\s*["']([^"']+)["']\s*\)/);
  return literal?.[1] as RunStatus | undefined;
}

function isTerminalBoundaryCall(call: string): boolean {
  const literal = literalRunStatus(call);
  if (literal !== undefined) return TERMINAL_RUN_STATUSES.has(literal);
  return /runStatus:\s*[A-Za-z0-9_$?.]+/.test(call);
}

function terminalWriteKey(site: PermittedTerminalWrite): string {
  return `${site.file}:${String(site.line)}:${site.writer}:${site.functionName}`;
}

function nonterminalSetRunStatusKey(site: PermittedNonterminalSetRunStatus): string {
  return `${site.file}:${String(site.line)}:setRunStatus:${site.status}:${site.functionName}`;
}

export function listProductionExecutionSources(
  overrides?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const sources: Record<string, string> = {};
  for (const name of readdirSync(EXECUTION_DIR).filter(isProductionExecutionSource).sort()) {
    sources[name] = overrides?.[name] ?? readFileSync(join(EXECUTION_DIR, name), "utf8");
  }
  return sources;
}

export function scanExecutionTerminalSettlement(sources: Readonly<Record<string, string>>): {
  violations: TerminalSettlementViolation[];
  terminalWrites: PermittedTerminalWrite[];
  nonterminalSetRunStatus: PermittedNonterminalSetRunStatus[];
} {
  const violations: TerminalSettlementViolation[] = [];
  const terminalWrites: PermittedTerminalWrite[] = [];
  const nonterminalSetRunStatus: PermittedNonterminalSetRunStatus[] = [];

  for (const [file, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    for (const match of source.matchAll(
      /\.(setPrEvidence|setRunStatus|commitTerminalRunSettlement|commitCompletionBoundary)\s*\(/g,
    )) {
      const kind = match[1];
      const index = match.index ?? 0;
      const line = lineNumber(source, index);
      const functionName = enclosingFunctionName(source, index);
      const openParenIndex = index + match[0].length - 1;
      const call = extractCall(source, openParenIndex);

      if (kind === "setPrEvidence") {
        violations.push({ file, line, functionName, kind: "setPrEvidence" });
        continue;
      }

      if (kind === "setRunStatus") {
        const status = literalSetRunStatus(call);
        if (status === undefined) {
          violations.push({
            file,
            line,
            functionName,
            kind: "terminalSetRunStatus",
            detail: "non-literal status",
          });
          continue;
        }
        if (TERMINAL_RUN_STATUSES.has(status)) {
          violations.push({ file, line, functionName, kind: "terminalSetRunStatus", detail: status });
          continue;
        }
        if (!NONTERMINAL_RUN_STATUSES.has(status)) {
          violations.push({
            file,
            line,
            functionName,
            kind: "terminalSetRunStatus",
            detail: `unexpected status ${status}`,
          });
          continue;
        }
        nonterminalSetRunStatus.push({ file, line, functionName, status });
        continue;
      }

      if (kind === "commitTerminalRunSettlement") {
        terminalWrites.push({ file, line, functionName, writer: "commitTerminalRunSettlement" });
        continue;
      }

      if (!isTerminalBoundaryCall(call)) continue;
      if (!SETTLEMENT_EVIDENCE.test(call)) {
        violations.push({
          file,
          line,
          functionName,
          kind: "unsettledTerminalBoundary",
          detail: literalRunStatus(call) ?? "dynamic runStatus",
        });
        continue;
      }
      terminalWrites.push({ file, line, functionName, writer: "commitCompletionBoundary" });
    }
  }

  return { violations, terminalWrites, nonterminalSetRunStatus };
}

function inventoryMismatchMessage(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): string | undefined {
  const missing = expected.filter((entry) => !actual.includes(entry));
  const extra = actual.filter((entry) => !expected.includes(entry));
  if (missing.length === 0 && extra.length === 0) return undefined;
  return `${label} mismatch\nmissing: ${missing.join(", ") || "(none)"}\nextra: ${extra.join(", ") || "(none)"}`;
}

test("execution production terminal writers are restricted to atomic settlement", () => {
  const sources = listProductionExecutionSources();
  const { violations, terminalWrites, nonterminalSetRunStatus } = scanExecutionTerminalSettlement(sources);

  expect(violations).toEqual([]);

  const terminalMismatch = inventoryMismatchMessage(
    "terminal writes",
    PERMITTED_TERMINAL_WRITES.map(terminalWriteKey).sort(),
    terminalWrites.map(terminalWriteKey).sort(),
  );
  expect(terminalMismatch).toBeUndefined();

  const nonterminalMismatch = inventoryMismatchMessage(
    "nonterminal setRunStatus",
    PERMITTED_NONTERMINAL_SET_RUN_STATUS.map(nonterminalSetRunStatusKey).sort(),
    nonterminalSetRunStatus.map(nonterminalSetRunStatusKey).sort(),
  );
  expect(nonterminalMismatch).toBeUndefined();

  const preMigrationWriteLoop = sources["write-loop.ts"]?.replace(
    "store.commitTerminalRunSettlement({",
    'store.setRunStatus(runId, "completed"); store.commitTerminalRunSettlement({',
  );
  const preMigrationWorkflowRunner = sources["workflow-runner.ts"]?.replace(
    "store.commitTerminalRunSettlement({",
    'store.setRunStatus(lastResult.runId, "failed"); store.commitTerminalRunSettlement({',
  );
  expect(
    scanExecutionTerminalSettlement({
      ...sources,
      "write-loop.ts": preMigrationWriteLoop ?? "",
      "workflow-runner.ts": preMigrationWorkflowRunner ?? "",
    }).violations.some((violation) => violation.kind === "terminalSetRunStatus"),
  ).toBe(true);
});

test("guard rejects reintroduced terminal setRunStatus", () => {
  // @mutate v2/src/execution/write-loop.ts "function landingFailedTerminalFailureDetail" -> "function __guardScratch(store: StateStore, runId: string) { store.setRunStatus(runId, \"completed\"); }\nfunction landingFailedTerminalFailureDetail"
  const source = readFileSync(join(EXECUTION_DIR, "write-loop.ts"), "utf8");
  const mutated = source.replace(
    "function landingFailedTerminalFailureDetail",
    'function __guardScratch(store: StateStore, runId: string) { store.setRunStatus(runId, "completed"); }\nfunction landingFailedTerminalFailureDetail',
  );
  const { violations } = scanExecutionTerminalSettlement({ "write-loop.ts": mutated });
  expect(violations).toEqual([
    {
      file: "write-loop.ts",
      line: expect.any(Number),
      functionName: "__guardScratch",
      kind: "terminalSetRunStatus",
      detail: "completed",
    },
  ]);
});
