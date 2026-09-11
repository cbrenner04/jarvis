// Guard coverage for the private-endpoint startup-options ternary in daemon-entrypoint.ts:
// startDaemonRuntime receives `privateSocketPath` in its options object only when
// DAEMON_PRIVATE_SOCKET_PATH is actually injected; inverting the guard drops it.

import { expect, mock, test } from "bun:test";
import * as realDaemonModule from "./daemon/daemon";

test("passes the injected private socket path through to startDaemonRuntime", async () => {
  const calls: unknown[][] = [];
  mock.module("./daemon/daemon", () => ({
    ...realDaemonModule,
    startDaemonRuntime: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ close: async () => undefined });
    },
  }));

  const previousSocketPath = process.env.DAEMON_SOCKET_PATH;
  const previousPrivateSocketPath = process.env.DAEMON_PRIVATE_SOCKET_PATH;
  process.env.DAEMON_SOCKET_PATH = "/fake/public.sock";
  process.env.DAEMON_PRIVATE_SOCKET_PATH = "/fake/private.sock";
  try {
    await import("./daemon-entrypoint.ts");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[3]).toEqual({ privateSocketPath: "/fake/private.sock" });
  } finally {
    if (previousSocketPath === undefined) delete process.env.DAEMON_SOCKET_PATH;
    else process.env.DAEMON_SOCKET_PATH = previousSocketPath;
    if (previousPrivateSocketPath === undefined) delete process.env.DAEMON_PRIVATE_SOCKET_PATH;
    else process.env.DAEMON_PRIVATE_SOCKET_PATH = previousPrivateSocketPath;
    mock.module("./daemon/daemon", () => realDaemonModule);
  }
});
