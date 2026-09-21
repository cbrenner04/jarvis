import { describe, expect, test } from "bun:test";
import { captureIo, makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { waitForRunCompletion } from "./run-completion.ts";

const WAIT_REQUEST_ID = "00000000-0000-4000-8000-000000000010";

const failureRecord = {
  expectation: "plan artifact",
  observation: "line one\nline two",
  retryable: false,
  referencedPaths: [{ path: "v2/spec/x.md", origin: "operator-repository" }],
};

async function wait(result: unknown) {
  const cap = captureIo();
  const code = await withFixedUuid(WAIT_REQUEST_ID, () =>
    waitForRunCompletion(makeIpcClient([{ kind: "response", id: WAIT_REQUEST_ID, result }]), "run-1", cap.io),
  );
  const { stdout, stderr } = cap.read();
  return { code, stdout, stderr, payload: JSON.parse(stdout.trimEnd()) as Record<string, unknown> };
}

describe("waitForRunCompletion failure presentation", () => {
  test("a canonical failure adds failure and failureText to the payload and the block to stderr", async () => {
    const { code, payload, stderr } = await wait({ runStatus: "failed", failure: failureRecord });
    const block = [
      "failure:",
      "  expectation: plan artifact",
      "  observation: line one\\nline two",
      "  reissue can help: no",
      "  path (operator-repository): v2/spec/x.md",
    ].join("\n");
    expect(code).toBe(3);
    expect(payload.failure).toEqual(failureRecord);
    expect(payload.failureText).toBe(block);
    expect(stderr).toBe(`${block}\n`);
  });

  test("no failure leaves the payload without failure keys and stderr empty", async () => {
    const { payload, stderr } = await wait({ runStatus: "failed" });
    expect("failure" in payload).toBe(false);
    expect("failureText" in payload).toBe(false);
    expect(stderr).toBe("");
  });
});
