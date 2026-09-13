import { describe, expect, test } from "bun:test";
import { daemonEntrypointArgs, withoutDaemonAddressEnv } from "./daemon/daemon-lifecycle";
import { parseEntrypointArgs, resolveHandoffOptions, shouldWatchOwnerPid } from "./daemon-entrypoint";

const entrypoint = new URL("./daemon-entrypoint.ts", import.meta.url).pathname;

describe("daemon-entrypoint process", () => {
  test("exits 1 with a required-argument message when --socket is absent", async () => {
    const proc = Bun.spawn([process.execPath, "run", entrypoint], {
      env: { ...process.env, DAEMON_SOCKET_PATH: "/tmp/ignored-env.sock" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(1);
    expect(stderr).toContain("--socket <path> argument required");
  });
});

describe("shouldWatchOwnerPid", () => {
  test("watches a positive integer PID", () => {
    expect(shouldWatchOwnerPid(123)).toBe(true);
  });

  test("does not watch zero, negative, or non-integer PIDs", () => {
    expect(shouldWatchOwnerPid(0)).toBe(false);
    expect(shouldWatchOwnerPid(-1)).toBe(false);
    expect(shouldWatchOwnerPid(Number.NaN)).toBe(false);
  });
});

describe("entrypoint addressing", () => {
  test("argv round-trips every address the spawner sets", () => {
    const address = {
      socketPath: "public.sock",
      privateSocketPath: "private.sock",
      predecessorSocketPath: "predecessor.sock",
      testOwnerPid: 42,
    };
    expect(parseEntrypointArgs(daemonEntrypointArgs(address))).toEqual(address);
  });

  test("resolveHandoffOptions omits unset handoff addresses", () => {
    expect(resolveHandoffOptions(parseEntrypointArgs(daemonEntrypointArgs({ socketPath: "p.sock" })))).toEqual({});
  });

  test("the daemon spawn env carries no daemon address to inherit", () => {
    const env = withoutDaemonAddressEnv({
      DAEMON_SOCKET_PATH: "/home/.jarvis/daemon.sock",
      DAEMON_PRIVATE_SOCKET_PATH: "/home/.jarvis/daemon-0123456789abcdef.sock",
      DAEMON_PREDECESSOR_SOCKET_PATH: "/home/.jarvis/daemon-fedcba9876543210.sock",
      TEST_DAEMON_OWNER_PID: "42",
      PATH: "/usr/bin",
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});
