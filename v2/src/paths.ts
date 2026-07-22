import { homedir } from "node:os";
import { join } from "node:path";

/** The only jarvis-home resolver: `homedir()` elsewhere escapes the tests' isolated home. */
export function jarvisHome(): string {
  return process.env.JARVIS_HOME ?? join(homedir(), ".jarvis");
}

export function daemonPaths(executableDigest: string): { socketPath: string; pidPath: string; logPath: string } {
  const path = join(jarvisHome(), `daemon-${executableDigest}`);
  return {
    // macOS limits Unix-domain socket paths to 103 bytes. Keep the complete
    // digest as identity, but place its socket under the short system temp root.
    socketPath: join("/tmp", `jarvis-${executableDigest}.sock`),
    pidPath: `${path}.pid`,
    logPath: `${path}.log`,
  };
}

/** Legacy paths remain exported only for callers that explicitly opt into the old daemon. */
export const DAEMON_SOCKET_PATH = join(jarvisHome(), "daemon.sock");
export const DAEMON_PID_PATH = join(jarvisHome(), "daemon.pid");
export const DAEMON_LOG_PATH = join(jarvisHome(), "daemon.log");
export const MACHINE_CONFIG_PATH = join(jarvisHome(), "config.json");
export const DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";
