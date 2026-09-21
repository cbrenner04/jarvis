import { expect, test } from "bun:test";
import { type DaemonListRunRow, parseChangeoverResult, parseListRuns, parseWaitCompletion } from "./daemon-wire.ts";

test("parseChangeoverResult rejects a missing envelope", () => {
  expect(parseChangeoverResult(undefined)).toBeUndefined();
  expect(parseChangeoverResult(null)).toBeUndefined();
});

test("parseChangeoverResult rejects a malformed envelope", () => {
  expect(parseChangeoverResult({ ok: true, privateSocketPath: 1, handoffId: "handoff-1" })).toBeUndefined();
  expect(parseChangeoverResult({ ok: true, privateSocketPath: "/tmp/daemon-abc.sock" })).toBeUndefined();
  expect(parseChangeoverResult({ ok: true, privateSocketPath: "/tmp/daemon-abc.sock", handoffId: "" })).toBeUndefined();
  expect(parseChangeoverResult({ privateSocketPath: "/tmp/daemon-abc.sock", handoffId: "handoff-1" })).toBeUndefined();
});

test("parseChangeoverResult accepts a well-shaped envelope", () => {
  expect(
    parseChangeoverResult({ ok: true, privateSocketPath: "/tmp/daemon-abc.sock", handoffId: "handoff-1" }),
  ).toEqual({
    ok: true,
    privateSocketPath: "/tmp/daemon-abc.sock",
    handoffId: "handoff-1",
  });
});

test("parseListRuns rejects a missing envelope", () => {
  expect(parseListRuns(undefined)).toBeUndefined();
  expect(parseListRuns(null)).toBeUndefined();
});

test("parseListRuns rejects a malformed envelope (runs not an array)", () => {
  expect(parseListRuns({ runs: "not-an-array" })).toBeUndefined();
  expect(parseListRuns({})).toBeUndefined();
});

test("parseListRuns accepts a well-shaped envelope", () => {
  const runs: DaemonListRunRow[] = [
    { runId: "run-1", project: "p", branch: "b", createdAt: 0, status: "in-progress", isLive: true },
  ];
  expect(parseListRuns({ runs })).toEqual({ runs });
});

test("parseWaitCompletion rejects a missing envelope", () => {
  expect(parseWaitCompletion(undefined)).toBeUndefined();
  expect(parseWaitCompletion(null)).toBeUndefined();
});

test("parseWaitCompletion rejects a malformed envelope (runStatus absent)", () => {
  expect(parseWaitCompletion({})).toBeUndefined();
});

const VALID_FAILURE = {
  expectation: "gate passes",
  observation: "gate failed",
  retryable: true,
  referencedPaths: [{ path: "a.ts", origin: "operator-repository" }],
};

test("parseListRuns drops a malformed failure record and keeps the rest of the row", () => {
  const row = { runId: "run-1", project: "p", branch: "b", createdAt: 0, status: "failed", isLive: false };
  const parsed = parseListRuns({
    runs: [
      { ...row, failure: { expectation: "x", observation: 1, retryable: true, referencedPaths: [] } },
      { ...row, runId: "run-2", failure: VALID_FAILURE },
    ],
  });
  expect(parsed?.runs[0] as unknown).toEqual(row);
  expect(parsed?.runs[0] && "failure" in parsed.runs[0]).toBeFalse();
  expect(parsed?.runs[1] as unknown).toEqual({ ...row, runId: "run-2", failure: VALID_FAILURE });
});

test("parseWaitCompletion preserves a valid failure record and drops a malformed one", () => {
  const payload = { runStatus: "failed", failure: VALID_FAILURE };
  expect(parseWaitCompletion(payload) as unknown).toEqual(payload);
  const dropped = parseWaitCompletion({ runStatus: "failed", failure: "boom" });
  expect(dropped as unknown).toEqual({ runStatus: "failed" });
  expect(dropped && "failure" in dropped).toBeFalse();
});

test("parseWaitCompletion accepts a well-shaped envelope", () => {
  const payload = {
    runStatus: "killed",
    error: { reason: "resumable_kill", retryable: true, nextAction: "resume" },
  } as const;
  expect(parseWaitCompletion(payload) as unknown).toEqual(payload);
});
