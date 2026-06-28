import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "./ipc/client.ts";
import { encodeFrame } from "./ipc/codec.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";

// Check if sockets can be created in /tmp; skip all tests if not (sandbox restriction)
let canCreateSockets: boolean;

const testSocketPath = join(tmpdir(), `.jarvis-socket-test-ipc-${process.pid}-${Date.now()}`);
const testServer = createServer();

await new Promise<void>((resolve) => {
  testServer.once("listening", () => {
    canCreateSockets = true;
    testServer.close();
    try {
      rmSync(testSocketPath, { force: true });
    } catch {}
    resolve();
  });

  testServer.once("error", () => {
    canCreateSockets = false;
    process.stderr.write("skip: IPC tests require socket support in /tmp\n");
    resolve();
  });

  testServer.listen(testSocketPath);
  setTimeout(() => resolve(), 100);
});

const SOCKET_PATH = join(tmpdir(), `jarvis-ipc-test-${process.pid}.sock`);

let server: IpcServer;

beforeEach(async () => {
  if (!canCreateSockets) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  server = await startIpcServer(SOCKET_PATH);
});

afterEach(async () => {
  if (!canCreateSockets || !server) {
    return;
  }
  await server.close();
  rmSync(SOCKET_PATH, { force: true });
});

function request(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, ...(params !== undefined ? { params } : {}) };
}

function skipIfNoSockets(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!canCreateSockets) {
      return;
    }
    return fn();
  };
}

test(
  "health RPC round-trips",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    client.send(request("h1", "health"));
    const frame = await client.nextFrame();
    expect(frame).toEqual({ kind: "response", id: "h1", result: { ok: true } });
    client.close();
  }),
);

test(
  "status RPC reports daemon-host liveness",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    client.send(request("s1", "status"));
    const frame = await client.nextFrame();
    expect(frame).toEqual({ kind: "response", id: "s1", result: { state: "running" } });
    client.close();
  }),
);

test(
  "unknown method returns correlated error",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    client.send(request("e1", "nope"));
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("error");
    if (frame.kind !== "error") return;
    expect(frame.id).toBe("e1");
    expect(frame.code).toBe("unknown_method");
    expect(frame.message).toContain("nope");
    client.close();
  }),
);

test(
  "stream-data chunks echo on the same streamId",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    client.send({ kind: "stream-open", streamId: "st1" });
    client.send({ kind: "stream-data", streamId: "st1", payload: Buffer.from("ab").toString("base64") });
    const echoed = await client.nextFrame();
    expect(echoed).toEqual({
      kind: "stream-data",
      streamId: "st1",
      payload: Buffer.from("ab").toString("base64"),
    });
    client.send({ kind: "stream-end", streamId: "st1" });
    client.close();
  }),
);

test(
  "RPC round-trips while a stream is open",
  skipIfNoSockets(async () => {
    const client = await connectIpcClient(SOCKET_PATH);
    client.send({ kind: "stream-open", streamId: "mix" });
    client.send(request("r1", "health"));
    client.send({ kind: "stream-data", streamId: "mix", payload: "Zg==" });

    const first = await client.nextFrame();
    const second = await client.nextFrame();
    const frames = [first, second];
    const response = frames.find((f) => f.kind === "response");
    const stream = frames.find((f) => f.kind === "stream-data");
    expect(response).toEqual({ kind: "response", id: "r1", result: { ok: true } });
    expect(stream).toEqual({ kind: "stream-data", streamId: "mix", payload: "Zg==" });
    client.close();
  }),
);

test(
  "serves multiple simultaneous client connections",
  skipIfNoSockets(async () => {
    const [a, b] = await Promise.all([connectIpcClient(SOCKET_PATH), connectIpcClient(SOCKET_PATH)]);
    a.send(request("a1", "health"));
    b.send(request("b1", "status"));
    const [aFrame, bFrame] = await Promise.all([a.nextFrame(), b.nextFrame()]);
    expect(aFrame).toEqual({ kind: "response", id: "a1", result: { ok: true } });
    expect(bFrame).toEqual({ kind: "response", id: "b1", result: { state: "running" } });
    a.close();
    b.close();
  }),
);

test(
  "oversized length closes the connection",
  skipIfNoSockets(async () => {
    const socket = connect(SOCKET_PATH);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    const header = Buffer.alloc(4);
    header.writeUInt32BE(16 * 1024 * 1024 + 1, 0);
    socket.write(header);
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  }),
);

test(
  "truncated body closes the connection",
  skipIfNoSockets(async () => {
    const socket = connect(SOCKET_PATH);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    const header = Buffer.alloc(4);
    header.writeUInt32BE(32, 0);
    socket.write(header);
    socket.write(Buffer.from('{"kind":"request"'));
    socket.end();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  }),
);

test(
  "invalid JSON closes the connection",
  skipIfNoSockets(async () => {
    const socket = connect(SOCKET_PATH);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    const body = Buffer.from("{not-json", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  }),
);

test(
  "missing kind closes the connection",
  skipIfNoSockets(async () => {
    const socket = connect(SOCKET_PATH);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    socket.write(encodeFrame({ id: "x" }));
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  }),
);

test(
  "invalid kind closes the connection",
  skipIfNoSockets(async () => {
    const socket = connect(SOCKET_PATH);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    socket.write(encodeFrame({ kind: "wat", id: "x" }));
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  }),
);

test(
  "server stays up after a malformed client disconnects",
  skipIfNoSockets(async () => {
    const bad = connect(SOCKET_PATH);
    await new Promise<void>((resolve, reject) => {
      bad.once("connect", () => resolve());
      bad.once("error", reject);
    });
    bad.write(encodeFrame({ kind: "nope" }));
    await new Promise<void>((resolve) => bad.once("close", () => resolve()));

    const client = await connectIpcClient(SOCKET_PATH);
    client.send(request("ok", "health"));
    expect(await client.nextFrame()).toEqual({ kind: "response", id: "ok", result: { ok: true } });
    client.close();
  }),
);
