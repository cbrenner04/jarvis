import { mkdtempSync } from "node:fs";
import { daemonSocketPath } from "../daemon/paths.ts";

/**
 * Temp Jarvis data root for tests that bind a Unix socket.
 *
 * Uses `/tmp` with a short prefix so socket paths stay under the macOS AF_UNIX
 * limit and remain bindable when TMPDIR points at a long worktree path.
 */
export function mkdtempJarvisRoot(prefix = "j"): string {
  return mkdtempSync(`/tmp/${prefix}-`);
}

/** Temp Jarvis root and its daemon socket path. */
export function mkdtempJarvisDaemon(prefix = "j"): { root: string; socketPath: string } {
  const root = mkdtempJarvisRoot(prefix);
  return { root, socketPath: daemonSocketPath(root) };
}
