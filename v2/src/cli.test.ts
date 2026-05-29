import { describe, expect, test } from "bun:test";
import { type CliDeps, main } from "./cli.ts";

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

function makeDeps(): CliDeps {
  return {
    acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
    invoke: async () => ({ kind: "ok", stdout: "done\n", stderr: "" }),
    invocationCount: 1,
    checkOutputContract: async () => ({ ok: true }),
  };
}

describe("v2 cli", () => {
  test("write runs one step end to end", async () => {
    const cap = captureIo();

    const code = await main(
      ["write", "--task", "Finish acceptance item."],
      cap.io,
      makeDeps(),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "done /tmp/worktree\n", stderr: "" });
  });

  test("unknown command prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main([], cap.io, makeDeps());

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "usage: jarvis write [--task <text>]\n",
      stderr: "",
    });
  });

  test("--version prints package version and exits 0", async () => {
    const cap = captureIo();

    const code = await main(["--version"], cap.io, makeDeps());

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
