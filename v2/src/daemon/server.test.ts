import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callDaemon, isDaemonReachable, removeStaleSocket } from "./client.ts";
import { daemonSocketPath } from "./paths.ts";
import { type DaemonResponse, parseResponseLine } from "./protocol.ts";
import { createDaemonHost } from "./server.ts";

describe("daemon server", () => {
  const hosts: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    while (hosts.length > 0) {
      const host = hosts.pop();
      if (host) await host.stop();
    }
  });

  async function startHost(root: string) {
    const socketPath = daemonSocketPath(root);
    const host = createDaemonHost({ socketPath, pid: 99 });
    await host.start();
    hosts.push(host);
    return { host, socketPath };
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
    const second = createDaemonHost({ socketPath, pid: 100 });
    await expect(second.start()).rejects.toThrow("daemon already running");
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
