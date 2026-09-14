import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeDeps } from "../cli/deps.ts";
import { startIpcServer } from "../ipc/server.ts";
import { captureIo, cliMain as main, tempPaths } from "../testing/cli-test-helpers.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { reapLegacyDaemonArtifacts, runDaemonCommand } from "./daemon.ts";

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
    });

    expect(code).toBe(0);
    expect(called).toEqual({ socketPath: paths.socketPath, pidPath: paths.pidPath });
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify({ pid: 42, socketPath: paths.socketPath })}\n`,
      stderr: "",
    });
  });

  test("daemon start forwards privateSocketPath when injected", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    let seenPrivateSocketPath: string | undefined;

    const code = await main(["daemon", "start"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      privateSocketPath: "/my/private.sock",
      startDaemon: async (socketPath, options) => {
        seenPrivateSocketPath = options?.privateSocketPath;
        return { pid: 42, socketPath };
      },
    });

    expect(code).toBe(0);
    expect(seenPrivateSocketPath).toBe("/my/private.sock");
  });

  test("daemon start omits privateSocketPath when absent", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    let sawKey = true;
    const deps = createRuntimeDeps({
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      startDaemon: async (socketPath, options) => {
        sawKey = options !== undefined && "privateSocketPath" in options;
        return { pid: 42, socketPath };
      },
    });

    const code = await runDaemonCommand(["start"], cap.io, deps);

    expect(code).toBe(0);
    expect(sawKey).toBe(false);
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
        return { reconciledRunIds: [] };
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
        return { reconciledRunIds: [] };
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
      getDaemonStatus: async (socketPath) => {
        expect(socketPath).toBe(paths.socketPath);
        return { state: "running", loadedRevision: "abc123" };
      },
    });

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "running loaded=abc123\n", stderr: "" });
  });

  // The pid file is a hint, not the service. A doomed start clobbers it with a pid that never
  // served, and short-circuiting on that reported `stopped` for a daemon answering normally.
  test("daemon status reports running when the pid file is missing but the socket answers", async () => {
    const cap = captureIo();
    const paths = tempPaths();

    const code = await main(["daemon", "status"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      getDaemonStatus: async () => ({
        state: "running",
        loadedRevision: "abc123",
      }),
    });

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "running loaded=abc123\n", stderr: "" });
  });

  test("daemon status prints stopped with exit 1 when the socket does not answer", async () => {
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

describe("reapLegacyDaemonArtifacts", () => {
  test("preserves a PID-less keyed socket the real probe cannot prove dead (absent is not stale)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-"));
    const socket = join(dir, "daemon-0000000000000001.sock");

    // A regular file at the socket path is not a real listener: the real probe reads ENOENT
    // (`absent`), which is not proof of death — a sandboxed caller sees ENOENT for a live socket
    // too. Only a proven-`stale` (connection-refused) verdict is reapable.
    writeFileSync(socket, "");

    const result = await reapLegacyDaemonArtifacts(dir);
    expect(result.dead).not.toContain(socket);
    expect(result.preserved).toEqual([{ unit: "daemon-0000000000000001", reason: "socket probe was inconclusive" }]);
  });

  test("returns empty lists when jarvis home does not exist", async () => {
    const nonexistent = join(tmpdir(), `nonexistent-${Date.now()}`);

    const result = await reapLegacyDaemonArtifacts(nonexistent);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([]);
  });

  test("enumeration failure leaves artifacts untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-unreadable-"));
    const socket = join(dir, "daemon-0000000000000006.sock");
    writeFileSync(socket, "");
    chmodSync(dir, 0o000);
    try {
      const result = await reapLegacyDaemonArtifacts(dir);
      expect(result.dead).toEqual([]);
      expect(result.preserved).toEqual([]);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(existsSync(socket)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("classifies each discovered unit independently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-multiple-"));
    const socket1 = join(dir, "daemon-aaaaaaaaaaaaaaaa.sock");
    const socket2 = join(dir, "daemon-bbbbbbbbbbbbbbbb.sock");
    const socket3 = join(dir, "daemon-cccccccccccccccc.sock");

    writeFileSync(socket1, "");
    writeFileSync(socket2, "");
    writeFileSync(socket3, "");

    const result = await reapLegacyDaemonArtifacts(dir);
    expect(result.dead.length + result.preserved.length).toBeGreaterThanOrEqual(3);
    rmSync(dir, { recursive: true, force: true });
  });

  test("ignores files that do not match the daemon-<16hex> pattern, including the stable triplet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-filter-"));
    const socket = join(dir, "daemon-0000000000000004.sock");
    const pid = join(dir, "daemon-0000000000000004.pid");
    const log = join(dir, "daemon-0000000000000004.log");
    const other = join(dir, "other-file.sock");
    const uppercase = join(dir, "daemon-000000000000000A.sock");
    const short = join(dir, "daemon-000000000000000.sock");
    const stableSocket = join(dir, "daemon.sock");
    const stablePid = join(dir, "daemon.pid");
    const stableLog = join(dir, "daemon.log");

    writeFileSync(socket, "");
    writeFileSync(pid, "999999"); // dead: a parseable PID decides before any socket probe
    writeFileSync(log, "daemon output");
    writeFileSync(other, "");
    writeFileSync(uppercase, "");
    writeFileSync(short, "");
    writeFileSync(stableSocket, "");
    writeFileSync(stablePid, String(process.pid));
    writeFileSync(stableLog, "stable output");

    const result = await reapLegacyDaemonArtifacts(dir);
    const allClassified = result.dead.concat(result.preserved.map((p) => p.unit));
    expect(result.dead).toContain(socket);
    expect(result.dead).toContain(pid);
    expect(result.dead).toContain(log);
    expect(allClassified).not.toContain(other);
    expect(allClassified).not.toContain(uppercase);
    expect(allClassified).not.toContain(short);
    expect(result.dead).not.toContain(stableSocket);
    expect(result.dead).not.toContain(stablePid);
    expect(result.dead).not.toContain(stableLog);
    rmSync(dir, { recursive: true, force: true });
  });

  test("discovers a socketless keyed PID/log pair and reaps it when the recorded process is dead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-socketless-"));
    const pid = join(dir, "daemon-0000000000000009.pid");
    const log = join(dir, "daemon-0000000000000009.log");
    writeFileSync(pid, "999999");
    writeFileSync(log, "daemon output");

    const result = await reapLegacyDaemonArtifacts(dir);
    expect(result.dead.sort()).toEqual([log, pid].sort());
    expect(result.preserved).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves a legacy unit whose recorded PID is running; the PID decides over its socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-live-pid-"));
    const socket = join(dir, "daemon-000000000000000b.sock");
    const pid = join(dir, "daemon-000000000000000b.pid");
    writeFileSync(socket, ""); // present but never consulted: the parseable live PID decides first
    writeFileSync(pid, String(process.pid));

    const result = await reapLegacyDaemonArtifacts(dir);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([{ unit: "daemon-000000000000000b", reason: `pid ${process.pid} is running` }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves a legacy unit with neither a parseable PID file nor a socket file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-ambiguous-"));
    const log = join(dir, "daemon-000000000000000c.log");
    writeFileSync(log, "daemon output");

    const result = await reapLegacyDaemonArtifacts(dir);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([
      { unit: "daemon-000000000000000c", reason: "no PID file or socket to prove death" },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves a legacy unit whose PID file is unparseable and has no socket, ambiguous not live", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-garbage-pid-"));
    const pid = join(dir, "daemon-000000000000000d.pid");
    writeFileSync(pid, "not-a-pid");

    const result = await reapLegacyDaemonArtifacts(dir);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([
      { unit: "daemon-000000000000000d", reason: "no PID file or socket to prove death" },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("classifies a legacy unit's recorded PID via an injected isProcessAlive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-injected-pid-"));
    const pid = join(dir, "daemon-0000000000000010.pid");
    writeFileSync(pid, "424242");
    let checkedPid: number | undefined;

    const result = await reapLegacyDaemonArtifacts(dir, undefined, {
      isProcessAlive: (p) => {
        checkedPid = p;
        return true;
      },
      probeSocketLiveness: async () => "stale",
    });

    expect(checkedPid).toBe(424242);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([{ unit: "daemon-0000000000000010", reason: "pid 424242 is running" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves a PID-less keyed socket via an injected probe reporting live, without a real socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-injected-live-"));
    const socket = join(dir, "daemon-000000000000000e.sock");
    writeFileSync(socket, "");
    let probedPath: string | undefined;

    const result = await reapLegacyDaemonArtifacts(dir, undefined, {
      isProcessAlive: () => false,
      probeSocketLiveness: async (path) => {
        probedPath = path;
        return "live";
      },
    });

    expect(probedPath).toBe(socket);
    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([{ unit: "daemon-000000000000000e", reason: "socket is live" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("reaps a PID-less keyed socket via an injected probe reporting stale, without a real socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-injected-stale-"));
    const socket = join(dir, "daemon-000000000000000f.sock");
    writeFileSync(socket, "");

    const result = await reapLegacyDaemonArtifacts(dir, undefined, {
      isProcessAlive: () => false,
      probeSocketLiveness: async () => "stale",
    });

    expect(result.dead).toEqual([socket]);
    expect(result.preserved).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves a PID-less keyed socket via an injected probe reporting absent, without a real socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-injected-absent-"));
    const socket = join(dir, "daemon-0000000000000011.sock");
    writeFileSync(socket, "");

    const result = await reapLegacyDaemonArtifacts(dir, undefined, {
      isProcessAlive: () => false,
      probeSocketLiveness: async () => "absent",
    });

    expect(result.dead).toEqual([]);
    expect(result.preserved).toEqual([{ unit: "daemon-0000000000000011", reason: "socket probe was inconclusive" }]);
    rmSync(dir, { recursive: true, force: true });
  });

  socketTest("preserves a PID-less keyed socket a raw peer accepts on, without issuing an RPC", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-preserved-"));
    const socket = join(dir, "daemon-0000000000000005.sock");
    rmSync(socket, { force: true });

    const server = createServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, () => resolve());
    });

    try {
      const result = await reapLegacyDaemonArtifacts(dir);
      expect(result.dead).not.toContain(socket);
      expect(result.preserved).toEqual([{ unit: "daemon-0000000000000005", reason: "socket is live" }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(socket, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  socketTest("preserves a PID-less keyed socket a live daemon answers on, without issuing an RPC", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-reap-live-"));
    const socket = join(dir, "daemon-0000000000000007.sock");
    rmSync(socket, { force: true });

    const server = await startIpcServer(socket, {
      health: () => ({ kind: "response", result: { ok: true } }),
    });

    try {
      const result = await reapLegacyDaemonArtifacts(dir);
      expect(result.dead).not.toContain(socket);
      expect(result.preserved).toEqual([{ unit: "daemon-0000000000000007", reason: "socket is live" }]);
      expect(existsSync(socket)).toBe(true);
    } finally {
      await server.close();
      rmSync(socket, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("keyed PID and log files are never written", () => {
  test("cli.ts and daemon.ts read only the digest-keyed socketPath, never pidPath or logPath", () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const guardedFiles = [join(repoRoot, "v2", "src", "cli.ts"), join(repoRoot, "v2", "src", "daemon", "daemon.ts")];
    let totalCalls = 0;

    for (const path of guardedFiles) {
      const source = readFileSync(path, "utf-8");
      const digestFieldAccesses = source.match(/daemonPathsByDigest\([^)]*\)\.\w+/g) ?? [];
      totalCalls += digestFieldAccesses.length;
      for (const access of digestFieldAccesses) {
        expect(access.endsWith(".socketPath")).toBe(true);
      }
    }

    // Guards against a no-op pass: at least one call site must exist to prove the assertion ran.
    expect(totalCalls).toBeGreaterThan(0);
  });
});

const RPC_AGAINST_KEYED_SOCKET_PATTERN =
  /connectIpcClient\s*\(|createRpcTransport\s*\(|\.request\s*\(\s*[^,]*,\s*["']health["']/;

/** Violations for one legacy-classifier source: any call that would treat a keyed socket as a
 * live service endpoint (an RPC transport, or a `health` request) rather than a bare connect probe. */
function legacyClassifierRpcViolations(source: string): string[] {
  return RPC_AGAINST_KEYED_SOCKET_PATTERN.test(source) ? ["issues an RPC against a keyed socket"] : [];
}

describe("legacy daemon artifact classifier never issues an RPC against a keyed socket", () => {
  test("v2/src/commands/daemon.ts never calls connectIpcClient, createRpcTransport, or a health request", () => {
    const source = readFileSync(join(import.meta.dir, "daemon.ts"), "utf-8");
    expect(legacyClassifierRpcViolations(source)).toEqual([]);
  });

  test("fails against the pre-fix classifySocket, which issued a health RPC on an inconclusive probe", () => {
    const preFixClassifySocket = [
      "async function classifySocket(socketPath) {",
      "  const client = await connectIpcClient(socketPath);",
      "  const transport = createRpcTransport(client);",
      '  await transport.request("health", undefined, { timeoutMs: 500 });',
      "}",
    ].join("\n");

    expect(legacyClassifierRpcViolations(preFixClassifySocket)).toEqual(["issues an RPC against a keyed socket"]);
  });
});
