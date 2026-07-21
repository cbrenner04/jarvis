import { homedir } from "node:os";
import { join } from "node:path";

/** The only jarvis-home resolver: `homedir()` elsewhere escapes the tests' isolated home. */
export function jarvisHome(): string {
  return process.env.JARVIS_HOME ?? join(homedir(), ".jarvis");
}

/** Runtime ownership is isolated by the executable tree that started it. */
export function daemonPaths(executableDigest: string) {
  const name = `daemon-${executableDigest}`;
  return {
    // `/tmp` keeps the full digest key below the macOS Unix-socket path cap.
    socketPath: join("/tmp", `${name}.sock`),
    pidPath: join(jarvisHome(), `${name}.pid`),
    logPath: join(jarvisHome(), `${name}.log`),
    stateDbPath: join(jarvisHome(), "state", `${name}.sqlite`),
    logsPath: join(jarvisHome(), "state", `${name}.logs.jsonl`),
  };
}

/** Legacy paths are retained only for direct library callers; the CLI never selects them. */
export const DAEMON_SOCKET_PATH = join(jarvisHome(), "daemon.sock");
export const DAEMON_PID_PATH = join(jarvisHome(), "daemon.pid");
export const DAEMON_LOG_PATH = join(jarvisHome(), "daemon.log");
export const DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";
export const MACHINE_CONFIG_PATH = join(jarvisHome(), "config.json");
