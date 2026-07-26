import { describe, expect, test } from "bun:test";
import {
  type FileCostResult,
  parseInFileMs,
  type SpawnFileResult,
  summarizeFileResult,
  summarizeTotals,
} from "../scripts/measure-test-cost.ts";

function spawnResult(overrides: Partial<SpawnFileResult>): SpawnFileResult {
  return {
    file: "some.test.ts",
    wallClockMs: 100,
    output: "",
    timedOut: false,
    status: 0,
    ...overrides,
  };
}

describe("parseInFileMs", () => {
  test("parses a millisecond summary line", () => {
    expect(parseInFileMs("Ran 5 tests across 1 files. [35.00ms]")).toBe(35);
  });

  test("parses a second summary line", () => {
    expect(parseInFileMs("Ran 3 tests across 1 files. [1.20s]")).toBe(1200);
  });

  test("returns undefined when no summary line is present", () => {
    expect(parseInFileMs("some unrelated crash output")).toBeUndefined();
  });
});

describe("summarizeFileResult", () => {
  test("ok file: wall clock, in-file, and residual are reported", () => {
    const result = summarizeFileResult(
      spawnResult({ file: "ok.test.ts", wallClockMs: 150, output: "Ran 1 tests across 1 files. [50.00ms]" }),
    );

    expect(result).toEqual({
      file: "ok.test.ts",
      wallClockMs: 150,
      inFileMs: 50,
      residualMs: 100,
      status: "ok",
    });
  });

  test("ok file with a second-form summary line", () => {
    const result = summarizeFileResult(
      spawnResult({ file: "slow.test.ts", wallClockMs: 2000, output: "Ran 1 tests across 1 files. [1.50s]" }),
    );

    expect(result).toEqual({
      file: "slow.test.ts",
      wallClockMs: 2000,
      inFileMs: 1500,
      residualMs: 500,
      status: "ok",
    });
  });

  test("unparsed file: excluded from in-file/residual, wall clock still counts", () => {
    const result = summarizeFileResult(
      spawnResult({ file: "broken.test.ts", wallClockMs: 300, output: "segfault, no summary line" }),
    );

    expect(result).toEqual({
      file: "broken.test.ts",
      wallClockMs: 300,
      inFileMs: undefined,
      residualMs: undefined,
      status: "unparsed",
    });
  });

  test("timed-out file: excluded from in-file/residual, wall clock is the timeout bound", () => {
    const result = summarizeFileResult(
      spawnResult({
        file: "hung.test.ts",
        wallClockMs: 180_000,
        output: "",
        timedOut: true,
        status: null,
      }),
    );

    expect(result).toEqual({
      file: "hung.test.ts",
      wallClockMs: 180_000,
      inFileMs: undefined,
      residualMs: undefined,
      status: "timedOut",
    });
  });
});

describe("summarizeTotals", () => {
  const files: FileCostResult[] = [
    { file: "ok.test.ts", wallClockMs: 150, inFileMs: 50, residualMs: 100, status: "ok" },
    { file: "broken.test.ts", wallClockMs: 300, inFileMs: undefined, residualMs: undefined, status: "unparsed" },
    { file: "hung.test.ts", wallClockMs: 180_000, inFileMs: undefined, residualMs: undefined, status: "timedOut" },
  ];

  test("wall clock totals every file; in-file and residual only cover ok files", () => {
    const totals = summarizeTotals(files);

    expect(totals.totalWallClockMs).toBe(150 + 300 + 180_000);
    expect(totals.totalInFileMs).toBe(50);
    expect(totals.totalResidualMs).toBe(100);
  });

  test("an excluded file's wall clock does not inflate the residual total; it is reported separately", () => {
    const totals = summarizeTotals(files);

    expect(totals.totalResidualMs).not.toBe(totals.totalWallClockMs - totals.totalInFileMs);
    expect(totals.excludedWallClockMs).toBe(300 + 180_000);
  });
});
