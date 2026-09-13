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

test("parseWaitCompletion accepts a well-shaped envelope", () => {
  const payload = {
    runStatus: "killed",
    error: { reason: "resumable_kill", retryable: true, nextAction: "resume" },
  } as const;
  expect(parseWaitCompletion(payload)).toEqual(payload);
});
