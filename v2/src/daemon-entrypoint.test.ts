import { describe, expect, test } from "bun:test";
import { resolveHandoffOptions } from "./daemon-entrypoint";

const entrypoint = new URL("./daemon-entrypoint.ts", import.meta.url).pathname;

describe("daemon-entrypoint process", () => {
  test("exits 1 with a required-var message when DAEMON_SOCKET_PATH is unset", async () => {
    const { DAEMON_SOCKET_PATH: _unused, ...envWithoutSocketPath } = process.env;
    const proc = Bun.spawn([process.execPath, "run", entrypoint], {
      env: envWithoutSocketPath,
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    expect(stderr).toContain("DAEMON_SOCKET_PATH environment variable required");
  });
});

describe("resolveHandoffOptions", () => {
  test("omits predecessorSocketPath when DAEMON_PREDECESSOR_SOCKET_PATH is unset", () => {
    expect(resolveHandoffOptions({})).not.toHaveProperty("predecessorSocketPath");
  });

  test("includes predecessorSocketPath when DAEMON_PREDECESSOR_SOCKET_PATH is set", () => {
    expect(resolveHandoffOptions({ DAEMON_PREDECESSOR_SOCKET_PATH: "predecessor.sock" })).toHaveProperty(
      "predecessorSocketPath",
      "predecessor.sock",
    );
  });

  test("omits privateSocketPath when DAEMON_PRIVATE_SOCKET_PATH is unset", () => {
    expect(resolveHandoffOptions({})).not.toHaveProperty("privateSocketPath");
  });

  test("includes privateSocketPath when DAEMON_PRIVATE_SOCKET_PATH is set", () => {
    expect(resolveHandoffOptions({ DAEMON_PRIVATE_SOCKET_PATH: "private.sock" })).toHaveProperty(
      "privateSocketPath",
      "private.sock",
    );
  });
});
