import { expect, test } from "bun:test";
import { AsyncSubprocessError } from "../../../shared/subprocess.ts";
import { GitHubOperationError } from "./github-operations.ts";
import {
  completionCommitFailureResumable,
  formatPublicationFailure,
  isTransientPublicationFailure,
  normalizePublicationFailure,
  publicationFailureFor,
  runPublicationWithRetry,
  stampPublicationFailure,
} from "./publication-retry.ts";

test("normalizes bounded labelled command evidence", () => {
  const error = Object.assign(new Error("push failed"), {
    status: 12,
    stdout: "out",
    stderr: "err",
  });
  expect(normalizePublicationFailure("push", error)).toEqual({
    operation: "push",
    message: "push failed",
    exitCode: 12,
    stdoutTail: "out",
    stderrTail: "err",
  });
  expect(formatPublicationFailure(normalizePublicationFailure("push", error))).toContain("stdout: out");
  expect(formatPublicationFailure(normalizePublicationFailure("push", error))).toContain("stderr: err");
});

test("retries only positively identified transport failures and rethrows the original error", async () => {
  for (const message of ["network connection reset", "HTTP 503 service unavailable", "broken pipe"]) {
    expect(isTransientPublicationFailure(normalizePublicationFailure("push", new Error(message)))).toBe(true);
  }
  for (const message of [
    "unknown failure",
    "authentication failed",
    "permission denied",
    "not found",
    "invalid input",
    "rate limit 429",
  ]) {
    expect(isTransientPublicationFailure(normalizePublicationFailure("push", new Error(message)))).toBe(false);
  }

  const original = Object.assign(new Error("connection reset"), { status: 1, stderr: "socket closed" });
  const notices: string[] = [];
  let attempts = 0;
  await expect(
    runPublicationWithRetry(
      "push",
      async () => {
        attempts += 1;
        throw original;
      },
      { delay: async () => undefined, retryNotice: (notice) => notices.push(notice) },
    ),
  ).rejects.toBe(original);
  expect(attempts).toBe(3);
  expect(notices).toEqual([
    "push: connection reset; exit=1; stderr: socket closed; retrying (attempt 2/3)",
    "push: connection reset; exit=1; stderr: socket closed; retrying (attempt 3/3)",
  ]);
  expect(publicationFailureFor(original)).toMatchObject({
    operation: "push",
    exitCode: 1,
    stderrTail: "socket closed",
  });
});

test("a boundary-classified GitHubOperationError decides transience by its own retryable flag", async () => {
  const options = { delay: async () => undefined, retryNotice: () => undefined };
  const retryable = new GitHubOperationError("pr-view", "rate-limited", "some gh failure", "", "", 1);
  expect(isTransientPublicationFailure(normalizePublicationFailure("pr", retryable), retryable)).toBe(true);
  let attempts = 0;
  await expect(
    runPublicationWithRetry(
      "pr",
      async () => {
        attempts += 1;
        throw retryable;
      },
      options,
    ),
  ).rejects.toBe(retryable);
  expect(attempts).toBe(3);

  const permanent = new GitHubOperationError("pr-view", "auth", "connection reset", "", "", 1);
  expect(isTransientPublicationFailure(normalizePublicationFailure("pr", permanent), permanent)).toBe(false);
  attempts = 0;
  await expect(
    runPublicationWithRetry(
      "pr",
      async () => {
        attempts += 1;
        throw permanent;
      },
      options,
    ),
  ).rejects.toBe(permanent);
  expect(attempts).toBe(1);

  const unclassified = new GitHubOperationError("pr-view", "failed", "connection reset", "", "", 1);
  expect(isTransientPublicationFailure(normalizePublicationFailure("pr", unclassified), unclassified)).toBe(true);
  stampPublicationFailure(permanent, "pr", permanent);
  expect(completionCommitFailureResumable(permanent)).toBe(false);
});

test("permanent publication errors make one attempt", async () => {
  let attempts = 0;
  await expect(
    runPublicationWithRetry(
      "push",
      async () => {
        attempts += 1;
        throw new Error("non-fast-forward: failed to push some refs");
      },
      { delay: async () => undefined, retryNotice: () => undefined },
    ),
  ).rejects.toThrow("non-fast-forward");
  expect(attempts).toBe(1);
});

test("a subprocess timeout is a retryable publication failure, never a success", () => {
  const timeout = new AsyncSubprocessError(
    "Command timed out after 180000ms: gh pr view branch --json body",
    undefined,
    "",
    "",
    "ETIMEDOUT",
  );
  expect(isTransientPublicationFailure(normalizePublicationFailure("pr", timeout))).toBe(true);
});

test("completionCommitFailureResumable is false for permanent pr step failures", () => {
  const err = new Error("gh api unavailable");
  stampPublicationFailure(err, "pr", err);
  expect(completionCommitFailureResumable(err)).toBe(false);
});

test("completionCommitFailureResumable stays true without pr publication evidence", () => {
  expect(completionCommitFailureResumable(new Error("uncommitted changes"))).toBe(true);
});
