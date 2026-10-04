import { expect, test } from "bun:test";
import { collectSubtreeProcessGroupIds, parseProcessTablePsOutput } from "./agent-descendant-process-groups.ts";

test("collectSubtreeProcessGroupIds gathers distinct pgids for root and descendants", () => {
  const rows = parseProcessTablePsOutput("  100   1  100\n  200 100  200\n  201 200  300\n  202 200  300\n");
  expect([...collectSubtreeProcessGroupIds(100, rows)].sort((a, b) => a - b)).toEqual([100, 200, 300]);
});

test("collectSubtreeProcessGroupIds returns root pgid when the root row is missing", () => {
  expect([...collectSubtreeProcessGroupIds(42, [])]).toEqual([42]);
});
