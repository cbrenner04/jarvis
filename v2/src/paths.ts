import { homedir } from "node:os";
import { join } from "node:path";

export const DAEMON_SOCKET_PATH = join(homedir(), ".jarvis", "daemon.sock");
export const DAEMON_PID_PATH = join(homedir(), ".jarvis", "daemon.pid");
export const DAEMON_LOG_PATH = join(homedir(), ".jarvis", "daemon.log");
export const MACHINE_CONFIG_PATH = join(homedir(), ".jarvis", "config.json");
export const DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";
