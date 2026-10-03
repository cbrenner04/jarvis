import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StructuralTestLocatorError } from "../../../shared/structural-test-locator.ts";
import {
  expectDaemonPermittedInventoryMatches,
  indexOfReconciliationAdmissionSlice,
  listProductionDaemonSources,
  locateReconciliationAdmissionSlice,
  regexPinnedDaemonSettlementGuard,
  scanDaemonTerminalSettlement,
} from "./daemon-terminal-settlement-guard.ts";

const PAUSED_PIN_SLICE = "async beginRunReconciliation\n  // no direct status SQL\n";

test("regexPinnedDaemonSettlementGuard passes when setRunStatus captures match the paused pin", () => {
  const matching = `
store.setRunStatus(prior.id, "paused");
store.setRunStatus(runId, "paused");
`;
  expect(regexPinnedDaemonSettlementGuard(matching, PAUSED_PIN_SLICE)).toBe(true);
});

test("regexPinnedDaemonSettlementGuard fails when setRunStatus captures include queue promotion", () => {
  const queuePromotionPin = `
store.setRunStatus(prior.id, "paused");
store.setRunStatus(run.id, "in-progress");
store.setRunStatus(runId, "paused");
`;
  expect(regexPinnedDaemonSettlementGuard(queuePromotionPin, PAUSED_PIN_SLICE)).toBe(false);
});

test("regexPinnedDaemonSettlementGuard fails when setRunStatus call formatting breaks the pin", () => {
  const matching = `
store.setRunStatus(prior.id, "paused");
store.setRunStatus(runId, "paused");
`;
  const reformattedPause = matching.replace(
    'store.setRunStatus(runId, "paused")',
    'store.setRunStatus(\n        runId,\n        "paused",\n      )',
  );
  expect(regexPinnedDaemonSettlementGuard(reformattedPause, PAUSED_PIN_SLICE)).toBe(false);
});

test("regexPinnedDaemonSettlementGuard rejects commitGuardedKill and reconciliation SQL pins", () => {
  const slice = "async beginRunReconciliation\n";
  const clean = 'store.setRunStatus(prior.id, "paused");\nstore.setRunStatus(runId, "paused");';
  expect(regexPinnedDaemonSettlementGuard(`${clean}\nstore.commitGuardedKill(runId);`, slice)).toBe(false);
  expect(regexPinnedDaemonSettlementGuard(clean, `${slice}UPDATE runs SET status`)).toBe(false);
});

test("daemon production terminal settlement inventory matches permitted writers", () => {
  const sources = listProductionDaemonSources();
  const result = scanDaemonTerminalSettlement(sources);
  expect(result.violations).toEqual([]);
  expectDaemonPermittedInventoryMatches(result);

  const stateStoreSource = readFileSync(join(import.meta.dir, "../persistence/state-store.ts"), "utf8");
  expect(locateReconciliationAdmissionSlice(stateStoreSource)).not.toContain("UPDATE runs SET status");

  const concatenated = Object.values(sources).join("\n");
  const regexPinnedSlice = indexOfReconciliationAdmissionSlice(stateStoreSource);
  expect(regexPinnedDaemonSettlementGuard(concatenated, regexPinnedSlice)).toBe(true);

  const noBeginSource = stateStoreSource.replace("async beginRunReconciliation", "async orphanRunReconciliation");
  expect(indexOfReconciliationAdmissionSlice(noBeginSource)).toBe("");
  expect(() => locateReconciliationAdmissionSlice(noBeginSource)).toThrow(StructuralTestLocatorError);
});
