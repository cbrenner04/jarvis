import { describe, expect, test } from "bun:test";
import { run } from "./cli.ts";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

describe("v2 cli", () => {
  test("no args prints v2 boundary message and exits 0", () => {
    const cap = captureIo();

    const code = run([], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "v2 not ready\n", stderr: "" });
  });

  test("--version prints package version and exits 0", () => {
    const cap = captureIo();

    const code = run(["--version"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
