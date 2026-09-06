// Settlement inventory keys: terminal writes file:writer:functionName; nonterminal setRunStatus file:setRunStatus:status:functionName. Line numbers intentionally omitted.
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
  functionName: string;
  writer: "commitTerminalRunSettlement" | "commitCompletionBoundary";
  count?: number;
};

export type PermittedNonterminalSetRunStatus = {
  file: string;
  functionName: string;
  status: RunStatus;
  count?: number;
};

export const PERMITTED_TERMINAL_WRITES: PermittedTerminalWrite[] = [
  {
    file: "successor-step-idle-watchdog.ts",
    functionName: "settleSuccessorShellStall",
    writer: "commitCompletionBoundary",
  },
  { file: "workflow-runner.ts", functionName: "settleCompletedPublication", writer: "commitTerminalRunSettlement" },
  {
    file: "workflow-runner.ts",
    functionName: "settleWorkflowPublicationFailure",
    writer: "commitTerminalRunSettlement",
  },
  { file: "workflow-runner.ts", functionName: "executeWorkflow", writer: "commitTerminalRunSettlement", count: 2 },
  {
    file: "workflow-runner-debate-landing.ts",
    functionName: "commitReviewDebateOutcome",
    writer: "commitCompletionBoundary",
    count: 2,
  },
  {
    file: "workflow-runner-debate-landing.ts",
    functionName: "settleReviewedStagedMarkdownLintFailure",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner-debate-landing.ts",
    functionName: "repromptReviewedStagedMarkdownLintOrFail",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner-debate-landing.ts",
    functionName: "landReviewedOutputOrFail",
    writer: "commitCompletionBoundary",
    count: 2,
  },
  {
    file: "workflow-runner-debate-landing.ts",
    functionName: "tryActuatorOnlyReviewDebateRetry",
    writer: "commitCompletionBoundary",
    count: 3,
  },
  {
    file: "workflow-runner-debate-landing.ts",
    functionName: "finishReviewedLanding",
    writer: "commitCompletionBoundary",
  },
  { file: "workflow-runner-resume.ts", functionName: "settleIntentResumeFailure", writer: "commitCompletionBoundary" },
  {
    file: "workflow-runner-resume.ts",
    functionName: "runIntentResumeCommitAndPublish",
    writer: "commitCompletionBoundary",
    count: 2,
  },
  {
    file: "workflow-runner-resume.ts",
    functionName: "settleReviewMutationResumeFailure",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner-resume.ts",
    functionName: "settleMutationRepairExhausted",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner-resume.ts",
    functionName: "settleAutoDerivedMutationRepairNoBinding",
    writer: "commitCompletionBoundary",
  },
  { file: "workflow-runner-resume.ts", functionName: "runMutationRepairAttempt", writer: "commitCompletionBoundary" },
  {
    file: "workflow-runner-resume.ts",
    functionName: "settleFailedReviewMutationPublication",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner-resume.ts",
    functionName: "settleSuccessfulReviewMutationPublication",
    writer: "commitCompletionBoundary",
  },
  {
    file: "workflow-runner.ts",
    functionName: "commitIntentStageInvocationFailure",
    writer: "commitCompletionBoundary",
  },
  { file: "workflow-runner.ts", functionName: "finalizeStandardReviewStep", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", functionName: "settleCompletedPublication", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", functionName: "executeWriteLoop", writer: "commitCompletionBoundary", count: 7 },
  { file: "write-loop.ts", functionName: "executeWriteLoop", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", functionName: "finishIterationTimeout", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", functionName: "finishExecuteWriteThrow", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", functionName: "runReadyRepairIteration", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", functionName: "runMutationRepairIteration", writer: "commitCompletionBoundary" },
  { file: "write-loop.ts", functionName: "completionCommitFailed", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", functionName: "readyFailed", writer: "commitTerminalRunSettlement" },
  { file: "write-loop.ts", functionName: "iterationCommitFailed", writer: "commitTerminalRunSettlement" },
];

export const PERMITTED_NONTERMINAL_SET_RUN_STATUS: PermittedNonterminalSetRunStatus[] = [
  { file: "workflow-runner.ts", functionName: "settlePostCommitShrinkForResume", status: "paused" },
  { file: "workflow-runner.ts", functionName: "executeWorkflow", status: "in-progress" },
  { file: "workflow-runner-resume.ts", functionName: "runIntentResumeCommitAndPublish", status: "in-progress" },
  { file: "workflow-runner-resume.ts", functionName: "runMutationRepairAttempt", status: "in-progress" },
  { file: "workflow-runner-resume.ts", functionName: "runReviewMutationCommitAndPublish", status: "in-progress" },
  { file: "workflow-runner-resume.ts", functionName: "replayMutationFinalization", status: "in-progress" },
  { file: "write-loop.ts", functionName: "executeWriteLoop", status: "in-progress", count: 3 },
  { file: "write-loop.ts", functionName: "executeWriteLoop", status: "paused", count: 5 },
  { file: "write-loop.ts", functionName: "executeWriteLoop", status: "budget-soft-stopped" },
  { file: "write-loop.ts", functionName: "_commitRepromptProgressBoundary", status: "paused" },
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
  return `${site.file}:${site.writer}:${site.functionName}`;
}

function nonterminalSetRunStatusKey(site: PermittedNonterminalSetRunStatus): string {
  return `${site.file}:setRunStatus:${site.status}:${site.functionName}`;
}

function permittedInventoryKeys<T extends { count?: number }>(
  entries: readonly T[],
  keyFn: (entry: T) => string,
): string[] {
  const keys: string[] = [];
  for (const entry of entries) {
    const key = keyFn(entry);
    for (let i = 0; i < (entry.count ?? 1); i += 1) keys.push(key);
  }
  return keys;
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
  terminalWrites: Array<PermittedTerminalWrite & { line: number }>;
  nonterminalSetRunStatus: Array<PermittedNonterminalSetRunStatus & { line: number }>;
} {
  const violations: TerminalSettlementViolation[] = [];
  const terminalWrites: Array<PermittedTerminalWrite & { line: number }> = [];
  const nonterminalSetRunStatus: Array<PermittedNonterminalSetRunStatus & { line: number }> = [];

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

function keyOccurrenceCounts(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function inventoryMismatchMessage(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): string | undefined {
  const expectedCounts = keyOccurrenceCounts(expected);
  const actualCounts = keyOccurrenceCounts(actual);
  const missing: string[] = [];
  const extra: string[] = [];
  const countDeltas: string[] = [];

  for (const key of [...new Set([...expectedCounts.keys(), ...actualCounts.keys()])].sort()) {
    const expectedCount = expectedCounts.get(key) ?? 0;
    const actualCount = actualCounts.get(key) ?? 0;
    if (expectedCount > 0 && actualCount === 0) {
      missing.push(key);
    } else if (expectedCount === 0 && actualCount > 0) {
      extra.push(key);
    } else if (expectedCount !== actualCount) {
      countDeltas.push(`${key}: expected ${expectedCount}, got ${actualCount}`);
    }
  }

  if (missing.length === 0 && extra.length === 0 && countDeltas.length === 0) return undefined;
  return `${label} mismatch\nmissing: ${missing.join(", ") || "(none)"}\nextra: ${extra.join(", ") || "(none)"}\ncount deltas: ${countDeltas.join(", ") || "(none)"}`;
}

export function terminalSettlementInventoryMismatches(result: ReturnType<typeof scanExecutionTerminalSettlement>): {
  terminal?: string;
  nonterminal?: string;
} {
  const terminal = inventoryMismatchMessage(
    "terminal writes",
    permittedInventoryKeys(PERMITTED_TERMINAL_WRITES, terminalWriteKey),
    result.terminalWrites.map(terminalWriteKey),
  );
  const nonterminal = inventoryMismatchMessage(
    "nonterminal setRunStatus",
    permittedInventoryKeys(PERMITTED_NONTERMINAL_SET_RUN_STATUS, nonterminalSetRunStatusKey),
    result.nonterminalSetRunStatus.map(nonterminalSetRunStatusKey),
  );
  return {
    ...(terminal === undefined ? {} : { terminal }),
    ...(nonterminal === undefined ? {} : { nonterminal }),
  };
}
