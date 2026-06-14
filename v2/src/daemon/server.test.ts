import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LogRepository, openLogRepository } from "../log-repository.ts";
import { callDaemon, isDaemonReachable, removeStaleSocket, tailDaemon } from "./client.ts";
import { daemonSocketPath } from "./paths.ts";
import { type DaemonResponse, encodeFrame, parseResponseLine } from "./protocol.ts";
import { createDaemonHost } from "./server.ts";

describe("daemon server", () => {
  const hosts: Array<{ stop: () => Promise<void>; logRepository: LogRepository }> = [];

  afterEach(async () => {
    while (hosts.length > 0) {
      const host = hosts.pop();
      if (host) {
        host.logRepository.close();
        await host.stop();
      }
    }
  });

  async function startHost(root: string) {
    const socketPath = daemonSocketPath(root);
    const logRepository = openLogRepository(join(root, "state", "logs.sqlite"));
    const host = createDaemonHost({ socketPath, pid: 99, logRepository });
    await host.start();
    hosts.push(host);
    return { host, socketPath, logRepository };
  }

  test("status answers over the unix socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);

    const response = await callDaemon({ id: "1", method: "status" }, { socketPath });
    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      pid: 99,
      socketPath,
      activeInvocationRunIds: [],
    });
  });

  test("stop exits and removes the socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { host, socketPath } = await startHost(root);

    const response = await callDaemon({ id: "1", method: "stop" }, { socketPath });
    expect(response.ok).toBe(true);
    await host.waitUntilStopped();
    hosts.pop();
    expect(existsSync(socketPath)).toBe(false);
  });

  test("second start against a live socket fails cleanly", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);
    const second = createDaemonHost({
      socketPath,
      pid: 100,
      logRepository: openLogRepository(join(root, "state", "second.sqlite")),
    });
    await expect(second.start()).rejects.toThrow("daemon already running");
    second.logRepository.close();
  });

  test("stale socket is removed before bind", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const socketPath = daemonSocketPath(root);
    writeFileSync(socketPath, "");
    expect(await removeStaleSocket(socketPath)).toBe(true);
    const { host } = await startHost(root);
    expect(await isDaemonReachable(socketPath)).toBe(true);
    await host.stop();
    hosts.pop();
  });

  test("stop refuses active invocations and reports run IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { host, socketPath } = await startHost(root);
    host.registerActiveInvocation("run-active");

    const response = await callDaemon({ id: "1", method: "stop" }, { socketPath });
    expect(response.ok).toBe(false);
    expect(response.error).toEqual({
      code: "active_invocations",
      message: "daemon has active invocations",
      data: { activeRunIds: ["run-active"] },
    });
    expect(await isDaemonReachable(socketPath)).toBe(true);
  });

  test("stop succeeds when no active invocations remain", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { host, socketPath } = await startHost(root);
    host.registerActiveInvocation("run-done");
    host.unregisterActiveInvocation("run-done");

    const response = await callDaemon({ id: "1", method: "stop" }, { socketPath });
    expect(response.ok).toBe(true);
    await host.waitUntilStopped();
    hosts.pop();
  });

  test("malformed JSON, unknown methods, and handler errors keep the daemon alive", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath } = await startHost(root);

    const malformed = await sendRaw(socketPath, "{");
    expect(malformed.ok).toBe(false);
    expect(malformed.error?.code).toBe("invalid_json");

    const unknown = await callDaemon({ id: "2", method: "nope" }, { socketPath });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe("unknown_method");

    expect(await isDaemonReachable(socketPath)).toBe(true);
  });

  test("log.tail replays history then streams live records", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);
    logRepository.append({ runId: "run-a", level: "info", event: "one" });
    logRepository.append({ runId: "run-a", level: "info", event: "two" });

    const seen: string[] = [];
    const tail = tailDaemon(
      { runId: "run-a" },
      {
        socketPath,
        timeoutMs: 2_000,
        onRecord: (record) => {
          if (typeof record === "object" && record !== null && "event" in record) {
            seen.push(String(record.event));
          }
        },
      },
    );

    await waitFor(() => seen.length >= 2);
    logRepository.append({ runId: "run-a", level: "info", event: "three" });
    await waitFor(() => seen.includes("three"));
    tail.close();
    await tail.done;
    expect(seen).toEqual(["one", "two", "three"]);
  });

  test("log.tail accepts unknown run IDs and follows later appends", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);

    const seen: string[] = [];
    const tail = tailDaemon(
      { runId: "future-run" },
      {
        socketPath,
        timeoutMs: 2_000,
        onRecord: (record) => {
          if (typeof record === "object" && record !== null && "event" in record) {
            seen.push(String(record.event));
          }
        },
      },
    );

    await waitFor(() => seen.length === 0, 100);
    logRepository.append({ runId: "future-run", level: "info", event: "late" });
    await waitFor(() => seen.includes("late"));
    tail.close();
    expect(seen).toEqual(["late"]);
  });

  test("log.tail resumes from sequence without replaying earlier records", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);
    logRepository.append({ runId: "run-a", level: "info", event: "one" });
    logRepository.append({ runId: "run-a", level: "info", event: "two" });

    const seen: string[] = [];
    const tail = tailDaemon(
      { runId: "run-a", fromSeq: 1 },
      {
        socketPath,
        timeoutMs: 2_000,
        onRecord: (record) => {
          if (typeof record === "object" && record !== null && "event" in record) {
            seen.push(String(record.event));
          }
        },
      },
    );

    await waitFor(() => seen.includes("two"));
    logRepository.append({ runId: "run-a", level: "info", event: "three" });
    await waitFor(() => seen.includes("three"));
    tail.close();
    expect(seen).toEqual(["two", "three"]);
  });

  test("disconnect cleans up live tail subscribers without blocking append", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);

    const tail = tailDaemon(
      { runId: "run-a" },
      {
        socketPath,
        timeoutMs: 500,
        onRecord: () => {},
      },
    );
    tail.close();
    await tail.done;

    const record = logRepository.append({ runId: "run-a", level: "info", event: "after-disconnect" });
    expect(record.seq).toBe(1);
  });

  test("request/response works while log.tail is open on the same socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const { socketPath, logRepository } = await startHost(root);
    logRepository.append({ runId: "run-a", level: "info", event: "seed" });

    const response = await multiplexStatusDuringTail(socketPath, "run-a");
    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      pid: 99,
      socketPath,
      activeInvocationRunIds: [],
    });
  });
});

async function sendRaw(socketPath: string, line: string): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      resolve(parseResponseLine(chunk.toString().trim()));
      socket.destroy();
    });
    socket.on("connect", () => socket.write(`${line}\n`));
  });
}

async function multiplexStatusDuringTail(socketPath: string, runId: string): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    const statusId = "status-while-tail";

    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = parseResponseLine(line);
          if (response.id === statusId) {
            socket.destroy();
            resolve(response);
            return;
          }
        } catch {
          // Ignore stream frames.
        }
      }
    });

    socket.on("connect", () => {
      socket.write(encodeFrame({ id: "tail-1", method: "log.tail", params: { runId } }));
      socket.write(encodeFrame({ id: statusId, method: "status" }));
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
