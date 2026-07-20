import { describe, expect, test } from "bun:test";
import { captureIo, cliMain as main } from "./testing/cli-test-helpers.ts";

/** Top-level dispatch only; per-command behavior is covered next to each module in `commands/`. */
describe("v2 cli dispatch", () => {
  test("no args prints v2 boundary message and exits 0", async () => {
    const cap = captureIo();

    const code = await main([], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "v2 not ready\n", stderr: "" });
  });

  test("an unknown command falls through to the v2 boundary message", async () => {
    const cap = captureIo();

    const code = await main(["bogus"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "v2 not ready\n", stderr: "" });
  });

  test("--version prints package version and exits 0", async () => {
    const cap = captureIo();

    const code = await main(["--version"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
