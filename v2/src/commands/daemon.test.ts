import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureIo, cliMain as main, makeIpcClient, tempPaths } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";

describe("daemon command", () => {
  test("digest-keyed dispatch bypasses a differently keyed daemon", async () => {
    const cap = captureIo();
    const paths: string[] = [];
    const resumeId = "00000000-0000-4000-8000-000000000003";
    const code = await withFixedUuid(
      ["00000000-0000-4000-8000-000000000001", resumeId],
      () => main(["run", "resume", "run-123"], cap.io, {
      getExecutableDigest: async () => "new-digest",
      connectIpcClient: async (socketPath) => {
        paths.push(socketPath);
        return makeIpcClient([{ kind: "response", id: resumeId, result: { ok: true } }]);
      },
    }),
    );

    expect(code).toBe(0);
    expect(paths).toEqual([`${process.env.JARVIS_HOME}/daemon-new-digest.sock`]);
    expect(cap.read()).toEqual({ stdout: "resumed run-123\n", stderr: "" });
  });

  test("digest-keyed list and wait use only the invoking executable daemon", async () => {
    const paths: string[] = [];
    const waitId = "00000000-0000-4000-8000-000000000004";
    const listId = "00000000-0000-4000-8000-000000000003";
    const digest = "selected-digest";
    await withFixedUuid(["00000000-0000-4000-8000-000000000005", listId, "00000000-0000-4000-8000-000000000006", waitId], async () => {
      const listCode = await main(["run", "list"], captureIo().io, {
        getExecutableDigest: async () => digest,
        connectIpcClient: async (socketPath) => {
          paths.push(socketPath);
          return makeIpcClient([{ kind: "response", id: listId, result: { runs: [] } }]);
        },
      });
      const waitCode = await main(["run", "wait", "run-123"], captureIo().io, {
        getExecutableDigest: async () => digest,
        connectIpcClient: async (socketPath) => {
          paths.push(socketPath);
          return makeIpcClient([{ kind: "response", id: waitId, result: { runStatus: "completed", loopOutcomeKind: "complete" } }]);
        },
      });
      expect({ listCode, waitCode }).toEqual({ listCode: 0, waitCode: 0 });
    });
    expect(paths).toEqual([
      `${process.env.JARVIS_HOME}/daemon-${digest}.sock`,
      `${process.env.JARVIS_HOME}/daemon-${digest}.sock`,
    ]);
  });

  test("daemon start uses injected production paths and prints metadata", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    let called: { socketPath: string; pidPath: string } | undefined;

    const code = await main(["daemon", "start"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      startDaemon: async (socketPath, options) => {
        called = { socketPath, pidPath: options?.pidPath ?? "" };
        return { pid: 42, socketPath };
      },
      executeWriteLoop: async () => {
        throw new Error("write loop should not run");
      },
    });

    expect(code).toBe(0);
    expect(called).toEqual({ socketPath: paths.socketPath, pidPath: paths.pidPath });
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify({ pid: 42, socketPath: paths.socketPath })}\n`,
      stderr: "",
    });
  });

  test("daemon start passes through lifecycle errors tersely", async () => {
    const cap = captureIo();

    const code = await main(["daemon", "start"], cap.io, {
      startDaemon: async () => {
        const error = new Error("Daemon already running on socket /tmp/demo.sock");
        error.name = "DaemonAlreadyRunningError";
        throw error;
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toBe("DaemonAlreadyRunningError: Daemon already running on socket /tmp/demo.sock\n");
  });

  test("daemon stop calls the lifecycle helper once and exits 0", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    let called = 0;

    const code = await main(["daemon", "stop"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      stopDaemon: async (socketPath, options) => {
        called += 1;
        expect(socketPath).toBe(paths.socketPath);
        expect(options?.pidPath).toBe(paths.pidPath);
      },
    });

    expect(code).toBe(0);
    expect(called).toBe(1);
    expect(cap.read()).toEqual({ stdout: "stopped\n", stderr: "" });
  });

  test("daemon stop reports refusal and does not print stopped", async () => {
    const cap = captureIo();
    const code = await main(["daemon", "stop"], cap.io, {
      stopDaemon: async () => {
        throw new Error("DaemonStopRefusedError: active durable runs: queued-id, live-id");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "Error: DaemonStopRefusedError: active durable runs: queued-id, live-id\n",
    });
  });

  test("daemon stop --force passes force and unsupported args print usage", async () => {
    const cap = captureIo();
    let force: boolean | undefined;
    const forcedCode = await main(["daemon", "stop", "--force"], cap.io, {
      stopDaemon: async (_socket, options) => {
        force = options?.force;
      },
    });
    expect(forcedCode).toBe(0);
    expect(force).toBe(true);
    expect(cap.read().stdout).toBe("stopped\n");

    const invalid = captureIo();
    const invalidCode = await main(["daemon", "stop", "--unexpected"], invalid.io);
    expect(invalidCode).toBe(1);
    expect(invalid.read().stderr).toBe("usage: jarvis daemon <start|stop|status|log>\n");
  });

  test("daemon status prints running with exit 0", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    writeFileSync(paths.pidPath, "77\n");

    const code = await main(["daemon", "status"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      getDaemonStatus: async (pid, socketPath) => {
        expect(pid).toBe(77);
        expect(socketPath).toBe(paths.socketPath);
        return { state: "running", loadedRevision: "abc123", currentRevision: "abc123" };
      },
    });

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "running loaded=abc123 current=abc123\n", stderr: "" });
  });

  test("daemon status prints stopped with exit 1 when pid is missing", async () => {
    const cap = captureIo();
    const paths = tempPaths();

    const code = await main(["daemon", "status"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "stopped\n", stderr: "" });
  });

  test("daemon log writes retained bytes to stdout and exits 0", async () => {
    const cap = captureIo();
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-log-"));
    const logPath = join(dir, "daemon.log");
    writeFileSync(logPath, "line one\nline two\n");

    const code = await main(["daemon", "log"], cap.io, { logPath });

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "line one\nline two\n", stderr: "" });
  });

  test("daemon log reports the missing configured path on stderr and exits nonzero", async () => {
    const cap = captureIo();
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-log-"));
    const logPath = join(dir, "absent.log");

    const code = await main(["daemon", "log"], cap.io, { logPath });

    expect(code).not.toBe(0);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain(logPath);
  });

  test("daemon log --follow replays retained content then stops on SIGINT with exit 130", async () => {
    const cap = captureIo();
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-log-"));
    const logPath = join(dir, "daemon.log");
    writeFileSync(logPath, "retained\n");
    let sigintHandler: (() => void) | undefined;

    const code = await main(["daemon", "log", "--follow"], cap.io, {
      logPath,
      onSigint: (handler) => {
        sigintHandler = handler;
        queueMicrotask(() => sigintHandler?.());
        return () => {
          sigintHandler = undefined;
        };
      },
    });

    expect(code).toBe(130);
    expect(cap.read().stdout).toBe("retained\n");
  });

  test("daemon log rejects unknown flags and other forms with usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main(["daemon", "log", "--bogus"], cap.io, {});

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis daemon log");
  });

  test("daemon rejects unknown subcommands with usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main(["daemon", "bogus"], cap.io, {});

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis daemon");
  });
});
