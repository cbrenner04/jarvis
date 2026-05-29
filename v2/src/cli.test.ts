import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import type { WriteExecuteResult } from "./write.ts";

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
  test("no args prints v2 boundary message and exits 0", async () => {
    const cap = captureIo();

    const code = await main([], cap.io);

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

  test("write command maps complete result to exit 0", async () => {
    const cap = captureIo();
    const result: WriteExecuteResult = {
      worktreePath: "/tmp/worktree",
      worktreeReused: false,
      lock: { kind: "acquired" },
      result: {
        kind: "complete",
        token: "done",
        invocation: { attempts: [], final: null },
      },
    };

    const code = await main(
      [
        "write",
        "--project-root",
        "/tmp/repo",
        "--project",
        "demo",
        "--branch",
        "write-run",
        "--base",
        "HEAD",
        "--spec",
        "spec.md",
        "--artifact",
        "proof.txt",
        "--agent-outcomes",
        "done",
      ],
      cap.io,
      { executeWrite: async () => result },
    );

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toContain('"kind": "complete"');
  });

  test("write command maps non-success result to exit 1", async () => {
    const cap = captureIo();
    const result: WriteExecuteResult = {
      worktreePath: "/tmp/worktree",
      worktreeReused: true,
      lock: { kind: "recovered", stalepid: 123 },
      result: {
        kind: "progress",
        token: "progress",
        invocation: { attempts: [], final: null },
      },
    };

    const code = await main(
      [
        "write",
        "--project-root",
        "/tmp/repo",
        "--project",
        "demo",
        "--branch",
        "write-run",
        "--base",
        "HEAD",
        "--spec",
        "spec.md",
        "--artifact",
        "proof.txt",
        "--agent-outcomes",
        "progress",
      ],
      cap.io,
      { executeWrite: async () => result },
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toContain('"kind": "progress"');
  });

  test("write CLI bindings map invocation failures and emit artifact", async () => {
    const cap = captureIo();
    let captured:
      | Parameters<NonNullable<Parameters<typeof main>[2]>["executeWrite"]>[0]
      | undefined;

    const code = await main(
      [
        "write",
        "--project-root",
        "/tmp/repo",
        "--project",
        "demo",
        "--branch",
        "write-run",
        "--base",
        "HEAD",
        "--spec",
        "spec.md",
        "--artifact",
        "proof.txt",
        "--agent-outcomes",
        "quota,model_config,error,done",
        "--emit-artifact",
        "true",
      ],
      cap.io,
      {
        executeWrite: async (input) => {
          captured = input;
          return {
            worktreePath: "/tmp/worktree",
            worktreeReused: false,
            lock: { kind: "acquired" },
            result: {
              kind: "complete",
              token: "done",
              invocation: { attempts: [], final: null },
            },
          };
        },
      },
    );

    expect(code).toBe(0);
    expect(captured).toBeDefined();
    if (captured === undefined) return;
    const cwd = mkdtempSync(join(tmpdir(), "jarvis-cli-bindings-"));
    await expect(
      captured.bindings[0]?.invoke({ prompt: "p", cwd }),
    ).resolves.toEqual({ kind: "quota", stderr: "quota" });
    await expect(
      captured.bindings[1]?.invoke({ prompt: "p", cwd }),
    ).resolves.toEqual({ kind: "model_config", stderr: "model-config" });
    await expect(
      captured.bindings[2]?.invoke({ prompt: "p", cwd }),
    ).resolves.toEqual({ kind: "error", exitCode: 1, stderr: "error" });
    await expect(
      captured.bindings[3]?.invoke({ prompt: "p", cwd }),
    ).resolves.toEqual({ kind: "ok", stdout: "done", stderr: "" });
    expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("ok\n");
  });
});
