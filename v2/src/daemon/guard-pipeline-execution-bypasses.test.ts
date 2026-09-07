import { expect, test } from "bun:test";
import { loadPipelineExecutionSource, scanPipelineExecutionBypasses } from "./guard-pipeline-execution-bypasses.ts";

test("pipeline-execution bypass tokens require @pinned-bypass in the same comment block", () => {
  const source = loadPipelineExecutionSource();
  expect(scanPipelineExecutionBypasses(source)).toEqual([]);
});

test("guard rejects unpinned bypass prose", () => {
  const source = loadPipelineExecutionSource();
  const unpinned = source.replace(/\s*\* @pinned-bypass:[^\n]*/, "");
  expect(scanPipelineExecutionBypasses(unpinned).length).toBeGreaterThan(0);
  expect(scanPipelineExecutionBypasses(unpinned)[0]?.line).toBeGreaterThan(0);
});

test("guard ignores bypass tokens outside comments", () => {
  const source = 'const message = "bypass aggregate derivePipelineState";';
  expect(scanPipelineExecutionBypasses(source)).toEqual([]);
});
