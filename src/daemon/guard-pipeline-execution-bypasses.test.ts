import { expect, test } from "bun:test";
import { loadPipelineExecutionSource, scanPipelineExecutionBypasses } from "./guard-pipeline-execution-bypasses.ts";

test("pipeline-execution bypass tokens require @pinned-bypass in the same comment block", () => {
  const source = loadPipelineExecutionSource();
  expect(scanPipelineExecutionBypasses(source)).toEqual([]);
});

test("guard rejects unpinned bypass prose", () => {
  const unpinned = loadPipelineExecutionSource().replace(/\s*\* @pinned-bypass:[^\n]*/, "");
  const violations = scanPipelineExecutionBypasses(unpinned);
  expect(violations.length).toBeGreaterThan(0);
  expect(violations[0]?.line).toBeGreaterThan(0);
});

test("guard ignores bypass tokens outside comments", () => {
  const source = 'const message = "bypass aggregate derivePipelineState";';
  expect(scanPipelineExecutionBypasses(source)).toEqual([]);
});
