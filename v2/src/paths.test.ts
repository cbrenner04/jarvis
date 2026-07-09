import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { DAEMON_PID_PATH, DAEMON_SOCKET_DISPLAY, DAEMON_SOCKET_PATH, MACHINE_CONFIG_PATH } from "./paths.ts";

describe("paths", () => {
  test("DAEMON_SOCKET_PATH is ~/.jarvis/daemon.sock", () => {
    expect(DAEMON_SOCKET_PATH).toBe(join(homedir(), ".jarvis", "daemon.sock"));
  });

  test("DAEMON_PID_PATH is ~/.jarvis/daemon.pid", () => {
    expect(DAEMON_PID_PATH).toBe(join(homedir(), ".jarvis", "daemon.pid"));
  });

  test("MACHINE_CONFIG_PATH is ~/.jarvis/config.json", () => {
    expect(MACHINE_CONFIG_PATH).toBe(join(homedir(), ".jarvis", "config.json"));
  });

  test("DAEMON_SOCKET_DISPLAY is ~/.jarvis/daemon.sock", () => {
    expect(DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
  });
});
