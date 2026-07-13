import { homedir } from "node:os";
import { join } from "node:path";

/** The only jarvis-home resolver: `homedir()` elsewhere escapes the tests' isolated home. */
export function jarvisHome(): string {
  return process.env.JARVIS_HOME ?? join(homedir(), ".jarvis");
}

export const DAEMON_SOCKET_PATH = join(jarvisHome(), "daemon.sock");
export const DAEMON_PID_PATH = join(jarvisHome(), "daemon.pid");
export const DAEMON_LOG_PATH = join(jarvisHome(), "daemon.log");
export const MACHINE_CONFIG_PATH = join(jarvisHome(), "config.json");
export const DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";
