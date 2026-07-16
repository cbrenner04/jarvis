import { expect, test } from "bun:test";
import {
  formatPublicationFailure,
  isTransientPublicationFailure,
  normalizePublicationFailure,
  publicationFailureFor,
  runPublicationWithRetry,
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
  for (const message of ["unknown failure", "authentication failed", "permission denied", "not found", "invalid input", "rate limit 429"]) {
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
  expect(publicationFailureFor(original)).toMatchObject({ operation: "push", exitCode: 1, stderrTail: "socket closed" });
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
