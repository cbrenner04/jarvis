import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root of the jarvis home directory. `JARVIS_HOME` overrides the real `~/.jarvis`.
 *
 * Resolve every jarvis-home path through this — never call `homedir()` directly. The test
 * preload points `JARVIS_HOME` at a temp dir so the suite cannot write into the operator's
 * home; before that, fixture rows were appended to the real `telemetry.jsonl`.
 */
export function jarvisHome(): string {
  return process.env.JARVIS_HOME ?? join(homedir(), ".jarvis");
}

export const DAEMON_SOCKET_PATH = join(jarvisHome(), "daemon.sock");
export const DAEMON_PID_PATH = join(jarvisHome(), "daemon.pid");
export const DAEMON_LOG_PATH = join(jarvisHome(), "daemon.log");
export const MACHINE_CONFIG_PATH = join(jarvisHome(), "config.json");
export const DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";
