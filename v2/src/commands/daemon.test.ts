import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIpcServer } from "../ipc/server.ts";
import { captureIo, cliMain as main, tempPaths } from "../testing/cli-test-helpers.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { reapDeadDaemonSockets } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

describe("daemon command", () => {
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

describe("reapDeadDaemonSockets", () => {
  test("identifies a socket with no listener as dead (ECONNREFUSED)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-"));
    const deadSocket = join(dir, "daemon-0000000000000001.sock");

    writeFileSync(deadSocket, "");

    const result = await reapDeadDaemonSockets(dir);
    expect(result.dead).toContain(deadSocket);
  });

  test("returns empty lists when jarvis home does not exist", async () => {
    const nonexistent = join(tmpdir(), `nonexistent-${Date.now()}`);

    const result = await reapDeadDaemonSockets(nonexistent);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([]);
  });

  test("enumeration failure leaves sockets untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-unreadable-"));
    const socket = join(dir, "daemon-0000000000000006.sock");
    writeFileSync(socket, "");
    chmodSync(dir, 0o000);
    try {
      const result = await reapDeadDaemonSockets(dir);
      expect(result.dead).toEqual([]);
      expect(result.preserved).toEqual([]);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(existsSync(socket)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("classifies each discovered socket independently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-multiple-"));
    const socket1 = join(dir, "daemon-aaaaaaaaaaaaaaaa.sock");
    const socket2 = join(dir, "daemon-bbbbbbbbbbbbbbbb.sock");
    const socket3 = join(dir, "daemon-cccccccccccccccc.sock");

    writeFileSync(socket1, "");
    writeFileSync(socket2, "");
    writeFileSync(socket3, "");

    const result = await reapDeadDaemonSockets(dir);
    expect(result.dead.length + result.preserved.length).toBeGreaterThanOrEqual(3);
  });

  test("ignores files that do not match daemon-*.sock pattern", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-filter-"));
    const socket = join(dir, "daemon-0000000000000004.sock");
    const pid = join(dir, "daemon-0000000000000004.pid");
    const other = join(dir, "other-file.sock");

    writeFileSync(socket, "");
    writeFileSync(pid, "12345");
    writeFileSync(other, "");

    const result = await reapDeadDaemonSockets(dir);
    const allClassified = result.dead.concat(result.preserved.map((p) => p.path));
    expect(allClassified).toContain(socket);
    expect(allClassified).not.toContain(pid);
    expect(allClassified).not.toContain(other);
  });

  socketTest("preserves sockets that probe with errors other than ECONNREFUSED/ENOENT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-preserved-"));
    const socket = join(dir, "daemon-0000000000000005.sock");
    rmSync(socket, { force: true });

    const server = createServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, () => resolve());
    });

    try {
      const result = await reapDeadDaemonSockets(dir);
      expect(result.dead).not.toContain(socket);
      expect(result.preserved).toEqual([
        expect.objectContaining({
          path: socket,
          reason: expect.stringContaining("timed out"),
        }),
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(socket, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  socketTest("does not classify a live daemon socket as dead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-live-"));
    const socket = join(dir, "daemon-0000000000000007.sock");
    rmSync(socket, { force: true });

    const server = await startIpcServer(socket, {
      health: () => ({ kind: "response", result: { ok: true } }),
    });

    try {
      const result = await reapDeadDaemonSockets(dir);
      expect(result.dead).not.toContain(socket);
      expect(result.preserved.map((item) => item.path)).not.toContain(socket);
      expect(existsSync(socket)).toBe(true);
    } finally {
      await server.close();
      rmSync(socket, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
