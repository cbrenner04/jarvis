import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import { callDaemon } from "./daemon/client.ts";
import { createDaemonHost } from "./daemon/server.ts";
import { openLogRepository } from "./log-repository.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import { mkdtempJarvisDaemon, mkdtempJarvisRoot } from "./testing/jarvis-root.ts";
import type { WriteLoopInput, WriteLoopResult } from "./write-loop.ts";

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

const START_ARGS = [
  "start",
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

function completeResult(): WriteLoopResult {
  return {
    kind: "complete",
    runId: "run-123",
    iterationsConsumed: 1,
    resumable: false,
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
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toContain('"kind": "complete"');
  });

  test("write command maps blocked result to exit 1", async () => {
    const cap = captureIo();
    const result: WriteLoopResult = {
      kind: "blocked",
      runId: "run-456",
      iterationsConsumed: 1,
      resumable: false,
    };

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => result,
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toContain('"kind": "blocked"');
  });

  test("write command maps invocation_failure to exit 2", async () => {
    const cap = captureIo();
    const result: WriteLoopResult = {
      kind: "invocation_failure",
      runId: "run-789",
      iterationsConsumed: 0,
      resumable: false,
    };

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => result,
    });

    expect(code).toBe(2);
    expect(cap.read().stdout).toContain('"kind": "invocation_failure"');
  });

  test("write command maps budget-exhausted to exit 5", async () => {
    const cap = captureIo();
    const result: WriteLoopResult = {
      kind: "budget-exhausted",
      runId: "run-999",
      iterationsConsumed: 5,
      resumable: true,
    };

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => result,
    });

    expect(code).toBe(5);
    expect(cap.read().stdout).toContain('"kind": "budget-exhausted"');
  });

  test("forwards parsed agents to the injected binding factory", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;
    let capturedInput: WriteLoopInput | undefined;

    const code = await main([...WRITE_ARGS, "--agents", "claude,codex"], cap.io, {
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async (input) => {
        capturedInput = input;
        return completeResult();
      },
    });

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
      executeWriteLoop: async () => completeResult(),
    });

    expect(capturedAgents).toEqual(["claude"]);
  });

  test("default binding factory yields not-wired error bindings", async () => {
    const cap = captureIo();
    let captured: WriteLoopInput | undefined;

    // Omit createBindings so the real default (createAgentBindings) runs.
    await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async (input) => {
        captured = input;
        return completeResult();
      },
    });

    expect(captured?.bindings).toHaveLength(1);
    expect(captured?.bindings[0]?.invoke({ prompt: "p", cwd: "/tmp" })).resolves.toMatchObject({ kind: "error" });
  });

  test("daemon status reports unreachable daemon without starting a run", async () => {
    const cap = captureIo();
    const root = mkdtempJarvisRoot("c");

    const code = await main(["daemon", "status", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
    });

    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout)).toEqual({ reachable: false });
  });

  test("daemon start uses ensureDaemonRunning and prints structured result", async () => {
    const cap = captureIo();
    const { root, socketPath } = mkdtempJarvisDaemon("c");

    const code = await main(["daemon", "start", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      ensureDaemonRunning: async () => ({ ok: true }),
    });

    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout)).toEqual({ started: true, socketPath });
  });

  test("daemon stop exits 1 when active invocations block shutdown", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-"));

    const code = await main(["daemon", "stop", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemon: async () => ({
        id: "stop",
        ok: false,
        error: {
          code: "active_invocations",
          message: "daemon has active invocations",
          data: { activeRunIds: ["run-1"] },
        },
      }),
    });

    expect(code).toBe(1);
    expect(JSON.parse(cap.read().stdout).error.data.activeRunIds).toEqual(["run-1"]);
  });

  test("start autostarts the daemon and returns a run id without blocking", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-start-"));
    let startCalled = false;

    const code = await main([...START_ARGS, "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemonWithAutostart: async (request) => {
        if (request.method === "run.start") {
          startCalled = true;
          return { id: request.id, ok: true, result: { runId: "run-detached" } };
        }
        return { id: request.id, ok: false, error: { code: "unexpected", message: "unexpected" } };
      },
    });

    expect(code).toBe(0);
    expect(startCalled).toBe(true);
    expect(JSON.parse(cap.read().stdout).result.runId).toBe("run-detached");
  });

  test("status autostarts the daemon and lists durable run snapshots", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-status-"));

    const code = await main(["status", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemonWithAutostart: async (request) => {
        expect(request.method).toBe("run.list");
        return {
          id: request.id,
          ok: true,
          result: {
            runs: [{ id: "run-1", project: "demo", branch: "b", status: "completed", active: false }],
            activeRunIds: [],
          },
        };
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout).result.runs).toHaveLength(1);
  });

  test("pause autostarts the daemon and forwards run.pause", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-pause-"));

    const code = await main(["pause", "run-1", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemonWithAutostart: async (request) => {
        expect(request.method).toBe("run.pause");
        expect(request.params).toEqual({ runId: "run-1" });
        return { id: request.id, ok: true, result: { accepted: true } };
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout).result.accepted).toBe(true);
  });

  test("resume autostarts the daemon and forwards run.resume", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-resume-"));

    const code = await main(["resume", "run-2", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemonWithAutostart: async (request) => {
        expect(request.method).toBe("run.resume");
        expect(request.params).toEqual({ runId: "run-2" });
        return { id: request.id, ok: true, result: { accepted: true } };
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout).result.accepted).toBe(true);
  });

  test("kill autostarts the daemon and forwards run.kill", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-kill-"));

    const code = await main(["kill", "run-3", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemonWithAutostart: async (request) => {
        expect(request.method).toBe("run.kill");
        expect(request.params).toEqual({ runId: "run-3" });
        return { id: request.id, ok: true, result: { accepted: true } };
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(cap.read().stdout).result.accepted).toBe(true);
  });

  test("steering without run id prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["pause"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis <pause|resume|kill>");
  });

  test("log-tail autostarts the daemon and streams structured records", async () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-log-tail-"));
    let autostartProbe = false;
    let tailOpened = false;

    const code = await main(["log-tail", "run-1", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemonWithAutostart: async (request) => {
        autostartProbe = true;
        expect(request.method).toBe("status");
        return { id: request.id, ok: true, result: { pid: 1, socketPath: "/tmp/s", activeInvocationRunIds: [] } };
      },
      tailDaemon: (_params, options) => {
        tailOpened = true;
        options.onRecord({ event: "run.started", seq: 1 });
        return {
          close: () => {},
          done: Promise.resolve({ id: "tail", ok: true, result: { closed: true } }),
        };
      },
    });

    expect(code).toBe(0);
    expect(autostartProbe).toBe(true);
    expect(tailOpened).toBe(true);
    expect(cap.read().stdout).toContain('"event":"run.started"');
  });

  test("daemon lifecycle integrates start status and stop over temp socket", async () => {
    const cap = captureIo();
    const { root, socketPath } = mkdtempJarvisDaemon("c");
    const logRepository = openLogRepository(join(root, "state", "logs.sqlite"));
    const host = createDaemonHost({ socketPath, logRepository });
    await host.start();

    const statusCode = await main(["daemon", "status", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
    });
    expect(statusCode).toBe(0);
    expect(JSON.parse(cap.read().stdout).reachable).toBe(true);

    const stopCode = await main(["daemon", "stop", "--jarvis-root", root], cap.io, {
      jarvisRoot: () => root,
      callDaemon,
    });
    expect(stopCode).toBe(0);
    await host.waitUntilStopped();
    host.logRepository.close();
    host.stateStore.close();
  });
});

describe("simulated bindings", () => {
  test("replays scripted outcomes and emits the artifact on success", () => {
    const cwd = mkdtempSync(join(tmpdir(), "jarvis-sim-bindings-"));
    const bindings = simulatedBindings(["quota", "model_config", "error", "done"], {
      artifactPath: "proof.txt",
      emitArtifact: true,
    });

    expect(bindings[0]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "quota",
      stderr: "quota",
    });
    expect(bindings[1]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "model_config",
      stderr: "model-config",
    });
    expect(bindings[2]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "error",
    });
    expect(bindings[3]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "ok",
      stdout: "done",
      stderr: "",
    });
    expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("ok\n");
  });
});
