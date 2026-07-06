import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canUseUnixSockets, socketProbeErrored } from "../testing/unix-socket.ts";
import { connectIpcClient } from "./client.ts";
import { encodeFrame } from "./codec.ts";
import { type IpcServer, startIpcServer } from "./server.ts";

// Judgment call (2026-07-05): the deleted `ipc.sandbox-unrunnable.test.ts` caused
// `v2-test-runner-unbounded-spawn` flakes. Transport RPC coverage stays in-process here;
// `daemon.sandbox-unrunnable.test.ts` carries the one irreducible real-process/socket
// smoke test for this subsystem's wire boundary. Not restoring a second real-subprocess test here.
if (socketProbeErrored) {
  process.stderr.write("skip: IPC tests require socket support in /tmp\n");
}

const SOCKET_PATH = join(tmpdir(), `jarvis-ipc-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

let server: IpcServer;

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  server = await startIpcServer(SOCKET_PATH);
});

afterEach(async () => {
  if (!canUseUnixSockets() || !server) {
    return;
  }
  await server.close();
  rmSync(SOCKET_PATH, { force: true });
});

function request(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, ...(params !== undefined ? { params } : {}) };
}

async function connectRaw() {
  const socket = connect(SOCKET_PATH);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

function untilClose(socket: ReturnType<typeof connect>): Promise<void> {
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

socketTest("health RPC round-trips", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  client.send(request("h1", "health"));
  const frame = await client.nextFrame();
  expect(frame).toEqual({ kind: "response", id: "h1", result: { ok: true } });
  client.close();
});

socketTest("status RPC reports daemon-host liveness", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  client.send(request("s1", "status"));
  const frame = await client.nextFrame();
  expect(frame).toEqual({ kind: "response", id: "s1", result: { state: "running" } });
  client.close();
});

socketTest("unknown method returns correlated error", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  client.send(request("e1", "nope"));
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("error");
  if (frame.kind !== "error") return;
  expect(frame.id).toBe("e1");
  expect(frame.code).toBe("unknown_method");
  expect(frame.message).toContain("nope");
  client.close();
});

socketTest("serves multiple simultaneous client connections", async () => {
  const [a, b] = await Promise.all([connectIpcClient(SOCKET_PATH, 2_000), connectIpcClient(SOCKET_PATH, 2_000)]);
  a.send(request("a1", "health"));
  b.send(request("b1", "status"));
  const [aFrame, bFrame] = await Promise.all([a.nextFrame(), b.nextFrame()]);
  expect(aFrame).toEqual({ kind: "response", id: "a1", result: { ok: true } });
  expect(bFrame).toEqual({ kind: "response", id: "b1", result: { state: "running" } });
  a.close();
  b.close();
});

socketTest("oversized length closes the connection", async () => {
  const socket = await connectRaw();
  const header = Buffer.alloc(4);
  header.writeUInt32BE(16 * 1024 * 1024 + 1, 0);
  socket.write(header);
  await untilClose(socket);
});

socketTest("truncated body closes the connection", async () => {
  const socket = await connectRaw();
  const header = Buffer.alloc(4);
  header.writeUInt32BE(32, 0);
  socket.write(header);
  socket.write(Buffer.from('{"kind":"request"'));
  socket.end();
  await untilClose(socket);
});

socketTest("invalid JSON closes the connection", async () => {
  const socket = await connectRaw();
  const body = Buffer.from("{not-json", "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
  await untilClose(socket);
});

socketTest("missing kind closes the connection", async () => {
  const socket = await connectRaw();
  socket.write(encodeFrame({ id: "x" }));
  await untilClose(socket);
});

socketTest("invalid kind closes the connection", async () => {
  const socket = await connectRaw();
  socket.write(encodeFrame({ kind: "wat", id: "x" }));
  await untilClose(socket);
});

socketTest("nextFrame() with no timeoutMs falls back to the client's default timeout", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 50);
  await expect(client.nextFrame()).rejects.toThrow("timed out waiting for frame");
  client.close();
});

socketTest("parked unbounded nextFrame() rejects when the socket closes", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const pending = client.nextFrame();
  client.close();
  await expect(pending).rejects.toThrow("connection closed");
});

socketTest("parked timed nextFrame() rejects when the socket closes before the timeout fires", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
  const pending = client.nextFrame(2_000);
  client.close();
  await expect(pending).rejects.toThrow("connection closed");
  expect(clearTimeoutSpy).toHaveBeenCalled();
  clearTimeoutSpy.mockRestore();
});

socketTest("server stays up after a malformed client disconnects", async () => {
  const bad = await connectRaw();
  bad.write(encodeFrame({ kind: "nope" }));
  await untilClose(bad);

  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  client.send(request("ok", "health"));
  expect(await client.nextFrame()).toEqual({ kind: "response", id: "ok", result: { ok: true } });
  client.close();
});
