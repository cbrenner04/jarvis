import { describe, expect, test } from "bun:test";
import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import { makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withDaemonDispatch } from "./stale-dispatch.ts";

const io = { stdout: () => undefined, stderr: () => undefined };

test("auto-start swallows only a same-daemon start race", async () => {
  let connections = 0;
  let started = 0;
  const result = await withDaemonDispatch(
    io,
    {
      socketPath: "/tmp/daemon-digest.sock",
      pidPath: "/tmp/daemon-digest.pid",
      logPath: "/tmp/daemon-digest.log",
      connectIpcClient: async () => {
        connections += 1;
        if (connections === 1) throw new Error("not running yet");
        return makeIpcClient([]);
      },
      startDaemon: async (socketPath: string) => {
        started += 1;
        throw new DaemonAlreadyRunningError(socketPath);
      },
    } as never,
    async () => 0,
  );
  expect(result).toBe(0);
  expect({ connections, started }).toEqual({ connections: 2, started: 1 });
});

test("auto-start propagates non-race lifecycle failures", async () => {
  let stderr = "";
  const result = await withDaemonDispatch(
    { stdout: () => undefined, stderr: (message) => (stderr += message) },
    {
      socketPath: "/tmp/daemon-digest.sock",
      pidPath: "/tmp/daemon-digest.pid",
      logPath: "/tmp/daemon-digest.log",
      connectIpcClient: async () => {
        throw new Error("not running yet");
      },
      startDaemon: async () => {
        throw new Error("spawn failed");
      },
    } as never,
    async () => 0,
  );
  expect(result).toBe(1);
  expect(stderr).toContain("spawn failed");
});
