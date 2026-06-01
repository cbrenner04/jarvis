import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import type { WriteExecuteInput, WriteExecuteResult } from "./write.ts";

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

const WRITE_ARGS = [
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
];

function completeResult(): WriteExecuteResult {
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

  test("missing required write args prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["write", "--project", "demo"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis write");
  });

  test("unknown write args print usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main([...WRITE_ARGS, "--unknown", "x"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis write");
  });

  test("write command maps complete result to exit 0", async () => {
    const cap = captureIo();

    const code = await main(WRITE_ARGS, cap.io, {
      executeWrite: async () => completeResult(),
    });

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

    const code = await main(WRITE_ARGS, cap.io, {
      executeWrite: async () => result,
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toContain('"kind": "progress"');
  });

  test("forwards parsed agents to the injected binding factory", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;
    let capturedInput: WriteExecuteInput | undefined;

    const code = await main(
      [...WRITE_ARGS, "--agents", "claude,codex"],
      cap.io,
      {
        createBindings: (agentIds) => {
          capturedAgents = agentIds;
          return simulatedBindings(["done"]);
        },
        executeWrite: async (input) => {
          capturedInput = input;
          return completeResult();
        },
      },
    );

    expect(code).toBe(0);
    expect(capturedAgents).toEqual(["claude", "codex"]);
    expect(capturedInput?.bindings).toHaveLength(1);
  });

  test("defaults to the claude agent when --agents is omitted", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;

    await main(WRITE_ARGS, cap.io, {
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWrite: async () => completeResult(),
    });

    expect(capturedAgents).toEqual(["claude"]);
  });

  test("default binding factory yields not-wired error bindings", async () => {
    const cap = captureIo();
    let captured: WriteExecuteInput | undefined;

    // Omit createBindings so the real default (createAgentBindings) runs.
    await main(WRITE_ARGS, cap.io, {
      executeWrite: async (input) => {
        captured = input;
        return completeResult();
      },
    });

    expect(captured?.bindings).toHaveLength(1);
    await expect(
      captured?.bindings[0]?.invoke({ prompt: "p", cwd: "/tmp" }),
    ).resolves.toMatchObject({ kind: "error" });
  });
});

describe("simulated bindings", () => {
  test("replays scripted outcomes and emits the artifact on success", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "jarvis-sim-bindings-"));
    const bindings = simulatedBindings(
      ["quota", "model_config", "error", "done"],
      { artifactPath: "proof.txt", emitArtifact: true },
    );

    await expect(bindings[0]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "quota",
      stderr: "quota",
    });
    await expect(bindings[1]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "model_config",
      stderr: "model-config",
    });
    await expect(bindings[2]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "error",
    });
    await expect(bindings[3]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "ok",
      stdout: "done",
      stderr: "",
    });
    expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("ok\n");
  });
});
