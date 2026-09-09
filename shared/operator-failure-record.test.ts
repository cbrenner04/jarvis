import { describe, expect, test } from "bun:test";
import { type OperatorFailureRecord, parseOperatorFailureRecord } from "./operator-failure-record.ts";

const REPRESENTATIVE: OperatorFailureRecord = {
  expectation: "ready gate exits 0",
  observation: "bun run test:v2 exited 1 on daemon.test.ts",
  nearMiss: "159 of 160 files passed",
  retryable: true,
  referencedPaths: [
    { path: "/Users/op/.jarvis/sessions/run-1.log", origin: "harness-internal" },
    { path: "v2/src/daemon/daemon.test.ts", origin: "operator-repository" },
  ],
};

describe("parseOperatorFailureRecord", () => {
  test("parseOperatorFailureRecord accepts a record with expectation, observation, near miss, retryability, and both path origins", () => {
    expect(parseOperatorFailureRecord(JSON.stringify(REPRESENTATIVE))).toEqual({
      kind: "valid",
      record: REPRESENTATIVE,
    });
  });

  test("parseOperatorFailureRecord accepts omitted nearMiss and an empty referencedPaths list", () => {
    const minimal: OperatorFailureRecord = {
      expectation: "PR opens",
      observation: "gh pr create refused",
      retryable: false,
      referencedPaths: [],
    };
    const parsed = parseOperatorFailureRecord(JSON.stringify(minimal));
    expect(parsed).toEqual({ kind: "valid", record: minimal });
    if (parsed.kind === "valid") {
      expect("nearMiss" in parsed.record).toBe(false);
      expect(parsed.record.referencedPaths).toHaveLength(0);
    }
    expect(parseOperatorFailureRecord(null)).toEqual({ kind: "absent" });
  });

  test("parseOperatorFailureRecord rejects malformed JSON and invalid record shapes without throwing", () => {
    const { nearMiss: _nearMiss, ...base } = REPRESENTATIVE;
    const invalid: unknown[] = [
      "not-json",
      "{not-json",
      "null",
      "[]",
      '"string"',
      JSON.stringify({ ...base, expectation: undefined }),
      JSON.stringify({ ...base, observation: 7 }),
      JSON.stringify({ ...base, retryable: "yes" }),
      JSON.stringify({ ...base, nearMiss: null }),
      JSON.stringify({ ...base, referencedPaths: "v2/src" }),
      JSON.stringify({ ...base, referencedPaths: [{ path: 7, origin: "harness-internal" }] }),
      JSON.stringify({ ...base, referencedPaths: [{ path: "x", origin: "elsewhere" }] }),
      JSON.stringify({ ...base, referencedPaths: [{ path: "x" }] }),
      JSON.stringify({ ...base, referencedPaths: ["x"] }),
    ];
    for (const json of invalid) {
      expect(parseOperatorFailureRecord(json as string)).toEqual({ kind: "invalid" });
    }
    // @mutate shared/operator-failure-record.ts "!PATH_ORIGINS.has(value.origin)" -> "false"
    expect(parseOperatorFailureRecord(JSON.stringify(base))).toEqual({ kind: "valid", record: base });
  });
});
