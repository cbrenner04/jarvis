// Settlement inventory keys: terminal writes file:writer:functionName; nonterminal setRunStatus file:setRunStatus:status:functionName.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { locateSymbolSlice } from "../../../shared/structural-test-locator.ts";
import { type RunStatus, TERMINAL_RUN_STATUSES } from "../persistence/state-store.ts";

const DAEMON_DIR = import.meta.dir;
const NONTERMINAL_RUN_STATUSES = new Set<RunStatus>(["in-progress", "paused", "queued", "budget-soft-stopped"]);
const SETTLEMENT_EVIDENCE = /terminalCause:|completionBoundarySettlementFields\(|completedPublicationBoundaryFields\(/;

export type DaemonTerminalSettlementViolation = {
  file: string;
  line: number;
  functionName: string;
  kind: "commitGuardedKill" | "setPrEvidence" | "terminalSetRunStatus" | "unsettledTerminalBoundary";
  detail?: string;
};

export type PermittedDaemonTerminalWrite = {
  file: string;
  functionName: string;
  writer: "commitTerminalRunSettlement" | "commitCompletionBoundary";
  count?: number;
};

export type PermittedDaemonNonterminalSetRunStatus = {
  file: string;
  functionName: string;
  status: RunStatus;
  count?: number;
};

export const PERMITTED_DAEMON_TERMINAL_WRITES: PermittedDaemonTerminalWrite[] = [
  { file: "daemon.ts", functionName: "settleGuardedKill", writer: "commitTerminalRunSettlement" },
  { file: "daemon.ts", functionName: "reconcileOrphanedRuns", writer: "commitTerminalRunSettlement" },
  { file: "daemon.ts", functionName: "promoteQueuedRunImpl", writer: "commitTerminalRunSettlement" },
  { file: "daemon.ts", functionName: "recoverReconciledRuns", writer: "commitTerminalRunSettlement" },
  {
    file: "daemon-workflow-admission-handlers.ts",
    functionName: "createWorkflowStartAdmission",
    writer: "commitTerminalRunSettlement",
  },
  {
    file: "daemon-run-lifecycle-handlers.ts",
    functionName: "createRunLifecycleHandlers",
    writer: "commitTerminalRunSettlement",
  },
  {
    file: "daemon-run-lifecycle-handlers.ts",
    functionName: "createRunLifecycleHandlers",
    writer: "commitCompletionBoundary",
  },
];

export const PERMITTED_DAEMON_NONTERMINAL_SET_RUN_STATUS: PermittedDaemonNonterminalSetRunStatus[] = [
  { file: "daemon.ts", functionName: "promoteQueuedRunImpl", status: "in-progress" },
];

function isProductionDaemonSource(name: string): boolean {
  return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "daemon-terminal-settlement-guard.ts";
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
  const matches = [...call.matchAll(/["']([^"']+)["']/g)];
  return matches.at(-1)?.[1] as RunStatus | undefined;
}

function isTerminalBoundaryCall(call: string): boolean {
  const literal = literalRunStatus(call);
  if (literal !== undefined) return TERMINAL_RUN_STATUSES.has(literal);
  return /runStatus:\s*[A-Za-z0-9_$?.]+/.test(call);
}

function terminalWriteKey(site: PermittedDaemonTerminalWrite): string {
  return `${site.file}:${site.writer}:${site.functionName}`;
}

function nonterminalSetRunStatusKey(site: PermittedDaemonNonterminalSetRunStatus): string {
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

export function listProductionDaemonSources(
  overrides?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const sources: Record<string, string> = {};
  const walk = (absDir: string, relPrefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (isProductionDaemonSource(entry.name)) {
        sources[rel] = overrides?.[rel] ?? readFileSync(abs, "utf8");
      }
    }
  };
  walk(DAEMON_DIR, "");
  return sources;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear pass over the daemon source corpus classifies each line into terminal writes, permitted nonterminal setRunStatus calls, and violations; the branches share running per-file parse state, so splitting them would duplicate the scan or thread that state through helpers for no readability gain.
export function scanDaemonTerminalSettlement(sources: Readonly<Record<string, string>>): {
  violations: DaemonTerminalSettlementViolation[];
  terminalWrites: Array<PermittedDaemonTerminalWrite & { line: number }>;
  nonterminalSetRunStatus: Array<PermittedDaemonNonterminalSetRunStatus & { line: number }>;
} {
  const violations: DaemonTerminalSettlementViolation[] = [];
  const terminalWrites: Array<PermittedDaemonTerminalWrite & { line: number }> = [];
  const nonterminalSetRunStatus: Array<PermittedDaemonNonterminalSetRunStatus & { line: number }> = [];

  for (const [file, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    for (const match of source.matchAll(
      /\.(commitGuardedKill|setPrEvidence|setRunStatus|commitTerminalRunSettlement|commitCompletionBoundary)\s*\(/g,
    )) {
      const kind = match[1];
      const index = match.index ?? 0;
      const line = lineNumber(source, index);
      const functionName = enclosingFunctionName(source, index);
      const openParenIndex = index + match[0].length - 1;
      const call = extractCall(source, openParenIndex);

      if (kind === "commitGuardedKill") {
        violations.push({ file, line, functionName, kind: "commitGuardedKill" });
        continue;
      }

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
      const boundaryStatus = literalRunStatus(call);
      if (boundaryStatus !== undefined && TERMINAL_RUN_STATUSES.has(boundaryStatus)) {
        terminalWrites.push({ file, line, functionName, writer: "commitCompletionBoundary" });
        continue;
      }
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

export function inventoryMismatchMessage(
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

export function expectDaemonPermittedInventoryMatches(result: ReturnType<typeof scanDaemonTerminalSettlement>): void {
  const terminalMismatch = inventoryMismatchMessage(
    "terminal writes",
    permittedInventoryKeys(PERMITTED_DAEMON_TERMINAL_WRITES, terminalWriteKey),
    result.terminalWrites.map(terminalWriteKey),
  );
  if (terminalMismatch !== undefined) throw new Error(terminalMismatch);

  const nonterminalMismatch = inventoryMismatchMessage(
    "nonterminal setRunStatus",
    permittedInventoryKeys(PERMITTED_DAEMON_NONTERMINAL_SET_RUN_STATUS, nonterminalSetRunStatusKey),
    result.nonterminalSetRunStatus.map(nonterminalSetRunStatusKey),
  );
  if (nonterminalMismatch !== undefined) throw new Error(nonterminalMismatch);
}

export function locateReconciliationAdmissionSlice(stateStoreSource: string): string {
  return locateSymbolSlice({
    candidates: [stateStoreSource],
    start: "async beginRunReconciliation",
    end: "finishRunReconciliation",
    searchKey: "beginRunReconciliation",
  });
}

/** Pre-fix regex/setRunStatus-argument equality pin; vacuous when reconciliation end anchor is absent. */
export function regexPinnedDaemonSettlementGuard(
  concatenatedProductionSources: string,
  reconciliationAdmissionSlice: string,
): boolean {
  if (concatenatedProductionSources.match(/\.commitGuardedKill\s*\(/)) return false;
  const setRunStatusCaptures = [...concatenatedProductionSources.matchAll(/\.setRunStatus\s*\(([^)]*)\)/g)].map(
    (match) => match[1]?.trim(),
  );
  if (setRunStatusCaptures.length !== 1 || setRunStatusCaptures[0] !== 'run.id, "in-progress"') {
    return false;
  }
  if (reconciliationAdmissionSlice.includes("UPDATE runs SET status")) return false;
  return true;
}

/** Pre-fix indexOf reconciliation slice; returns empty when begin anchor is absent. */
export function indexOfReconciliationAdmissionSlice(stateStoreSource: string): string {
  const begin = stateStoreSource.indexOf("async beginRunReconciliation");
  if (begin === -1) return "";
  const end = stateStoreSource.indexOf("finishRunReconciliation", begin);
  return stateStoreSource.slice(begin, end === -1 ? undefined : end);
}
