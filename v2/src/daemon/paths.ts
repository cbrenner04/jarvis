import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default Jarvis data root (`~/.jarvis`). */
export function defaultJarvisRoot(): string {
  return join(homedir(), ".jarvis");
}

/** Unix socket path for the daemon IPC API. */
export function daemonSocketPath(jarvisRoot: string = defaultJarvisRoot()): string {
  return join(jarvisRoot, "daemon.sock");
}

/** Create the Jarvis data root when missing. */
export function ensureJarvisRoot(jarvisRoot: string): void {
  mkdirSync(jarvisRoot, { recursive: true });
}
