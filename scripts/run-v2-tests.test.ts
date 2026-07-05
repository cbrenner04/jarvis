import { describe, expect, test } from "bun:test";
import { isSpawnTimeout, spawnTimeoutMessage } from "./run-v2-tests.ts";

describe("isSpawnTimeout", () => {
  test("detects a SIGKILL with null status as a timeout", () => {
    expect(isSpawnTimeout({ signal: "SIGKILL", status: null })).toBe(true);
  });

  test("does not treat a normal SIGKILL exit as a timeout when status is set", () => {
    expect(isSpawnTimeout({ signal: "SIGKILL", status: 137 })).toBe(false);
  });

  test("does not treat a clean exit as a timeout", () => {
    expect(isSpawnTimeout({ signal: null, status: 0 })).toBe(false);
  });

  test("does not treat a non-SIGKILL signal as a timeout", () => {
    expect(isSpawnTimeout({ signal: "SIGTERM", status: null })).toBe(false);
  });
});

describe("spawnTimeoutMessage", () => {
  test("per-file loop names the mode and file", () => {
    expect(spawnTimeoutMessage("integration", "v2/src/foo.test.ts")).toBe(
      'error: v2 "integration" test run timed out or was killed on file "v2/src/foo.test.ts"\n',
    );
  });

  test("agent mode names the mode without a file", () => {
    expect(spawnTimeoutMessage("agent")).toBe('error: v2 "agent" test run timed out or was killed\n');
  });
});
