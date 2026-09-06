import { expect, test } from "bun:test";
import { locateDiscoveredFile } from "../../../shared/structural-test-locator.ts";
import {
  listProductionExecutionSources,
  scanExecutionTerminalSettlement,
  terminalSettlementInventoryMismatches,
} from "./execution-terminal-settlement-guard.ts";

function expectPermittedInventoryMatches(result: ReturnType<typeof scanExecutionTerminalSettlement>): void {
  const mismatches = terminalSettlementInventoryMismatches(result);
  expect(mismatches).not.toHaveProperty("terminal");
  expect(mismatches).not.toHaveProperty("nonterminal");
}

test("execution production terminal writers are restricted to atomic settlement", () => {
  const sources = listProductionExecutionSources();
  const result = scanExecutionTerminalSettlement(sources);

  expect(result.violations).toEqual([]);
  expectPermittedInventoryMatches(result);

  const preMigrationWriteLoop = locateDiscoveredFile(sources, "write-loop.ts").replace(
    "store.commitTerminalRunSettlement({",
    'store.setRunStatus(runId, "completed"); store.commitTerminalRunSettlement({',
  );
  const preMigrationWorkflowRunner = locateDiscoveredFile(sources, "workflow-runner.ts").replace(
    "store.commitTerminalRunSettlement({",
    'store.setRunStatus(lastResult.runId, "failed"); store.commitTerminalRunSettlement({',
  );
  expect(
    scanExecutionTerminalSettlement({
      ...sources,
      "write-loop.ts": preMigrationWriteLoop,
      "workflow-runner.ts": preMigrationWorkflowRunner,
    }).violations.some((violation) => violation.kind === "terminalSetRunStatus"),
  ).toBe(true);
});

test("guard rejects reintroduced terminal setRunStatus", () => {
  // @mutate v2/src/execution/write-loop.ts "function landingFailedTerminalFailureDetail" -> "function __guardScratch(store: StateStore, runId: string) { store.setRunStatus(runId, \"completed\"); }\nfunction landingFailedTerminalFailureDetail"
  const source = locateDiscoveredFile(listProductionExecutionSources(), "write-loop.ts");
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

test("inventory ignores line drift above tracked call sites", () => {
  const driftNeedle = "  args.store.commitCompletionBoundary({";
  const sources = listProductionExecutionSources();
  const baselineSource = locateDiscoveredFile(sources, "successor-step-idle-watchdog.ts");
  expect(baselineSource).toContain(driftNeedle);

  const baseline = scanExecutionTerminalSettlement(sources);
  expect(baseline.violations).toEqual([]);

  const driftedSource = baselineSource.replace(driftNeedle, `\n\n${driftNeedle}`);
  expect(driftedSource).not.toBe(baselineSource);

  const drifted = scanExecutionTerminalSettlement({
    ...sources,
    "successor-step-idle-watchdog.ts": driftedSource,
  });

  const trackedSite = (result: ReturnType<typeof scanExecutionTerminalSettlement>) =>
    result.terminalWrites.find(
      (site) =>
        site.file === "successor-step-idle-watchdog.ts" &&
        site.functionName === "settleSuccessorShellStall" &&
        site.writer === "commitCompletionBoundary",
    );
  const baselineLine = trackedSite(baseline)?.line;
  const driftedLine = trackedSite(drifted)?.line;
  expect(baselineLine).toBeDefined();
  expect(driftedLine).toBe(baselineLine! + 2);

  expect(drifted.violations).toEqual([]);
  expectPermittedInventoryMatches(drifted);
});

test("terminalSettlementInventoryMismatches includes terminal only when terminal inventory mismatches", () => {
  const matched = terminalSettlementInventoryMismatches(
    scanExecutionTerminalSettlement(listProductionExecutionSources()),
  );
  expect(matched).not.toHaveProperty("terminal");

  const mismatched = terminalSettlementInventoryMismatches({
    violations: [],
    terminalWrites: [{ file: "rogue.ts", functionName: "rogueWriter", writer: "commitCompletionBoundary", line: 1 }],
    nonterminalSetRunStatus: [],
  });
  expect(mismatched).toHaveProperty("terminal");
  expect(mismatched.terminal).toContain("terminal writes mismatch");
});
