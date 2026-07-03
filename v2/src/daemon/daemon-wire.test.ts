import { expect, test } from "bun:test";
import { parseListRuns, parseWaitCompletion } from "./daemon-wire.ts";

test("parseListRuns rejects rows with invalid error.reason", () => {
  expect(
    parseListRuns({
      runs: [
        {
          runId: "run-1",
          project: "p",
          branch: "b",
          status: "failed",
          isLive: false,
          error: { reason: "not-a-reason", retryable: false, nextAction: "stop" },
        },
      ],
    }),
  ).toBeUndefined();
});

test("parseListRuns rejects rows with invalid error.nextAction", () => {
  expect(
    parseListRuns({
      runs: [
        {
          runId: "run-1",
          project: "p",
          branch: "b",
          status: "failed",
          isLive: false,
          error: { reason: "harness_failure", retryable: false, nextAction: "none" },
        },
      ],
    }),
  ).toBeUndefined();
});

test("parseListRuns rejects rows with invalid error.retryable", () => {
  expect(
    parseListRuns({
      runs: [
        {
          runId: "run-1",
          project: "p",
          branch: "b",
          status: "failed",
          isLive: false,
          error: { reason: "harness_failure", retryable: "false", nextAction: "stop" },
        },
      ],
    }),
  ).toBeUndefined();
});

test("parseListRuns accepts valid error on list rows", () => {
  expect(
    parseListRuns({
      runs: [
        {
          runId: "run-1",
          project: "p",
          branch: "b",
          status: "paused",
          isLive: false,
          error: { reason: "resumable_pause", retryable: true, nextAction: "resume" },
        },
      ],
    }),
  ).toEqual({
    runs: [
      {
        runId: "run-1",
        project: "p",
        branch: "b",
        status: "paused",
        isLive: false,
        error: { reason: "resumable_pause", retryable: true, nextAction: "resume" },
      },
    ],
  });
});

test("parseWaitCompletion rejects invalid error fields", () => {
  expect(
    parseWaitCompletion({
      runStatus: "failed",
      error: { reason: "bad", retryable: false, nextAction: "stop" },
    }),
  ).toBeUndefined();
  expect(
    parseWaitCompletion({
      runStatus: "failed",
      error: { reason: "harness_failure", retryable: false, nextAction: "retry" },
    }),
  ).toBeUndefined();
  expect(
    parseWaitCompletion({
      runStatus: "failed",
      error: { reason: "harness_failure", retryable: 0, nextAction: "stop" },
    }),
  ).toBeUndefined();
});

test("parseWaitCompletion accepts valid error on wait payloads", () => {
  expect(
    parseWaitCompletion({
      runStatus: "killed",
      error: { reason: "resumable_kill", retryable: true, nextAction: "resume" },
    }),
  ).toEqual({
    runStatus: "killed",
    error: { reason: "resumable_kill", retryable: true, nextAction: "resume" },
  });
});
