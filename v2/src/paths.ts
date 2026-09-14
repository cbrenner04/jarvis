import { join } from "node:path";
import { jarvisHome } from "../../shared/paths.ts";

export { jarvisHome };

export const DAEMON_SOCKET_PATH = join(jarvisHome(), "daemon.sock");
export const DAEMON_PID_PATH = join(jarvisHome(), "daemon.pid");
export const DAEMON_LOG_PATH = join(jarvisHome(), "daemon.log");
export const MACHINE_CONFIG_PATH = join(jarvisHome(), "config.json");
export const DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";

export function orchestrationStorePath(jarvisHomeDir?: string): string {
  return join(jarvisHomeDir ?? jarvisHome(), "state", "v2.sqlite");
}

export const ORCHESTRATION_STORE_PATH = orchestrationStorePath();

/** Digest-keyed daemon paths: socket, PID, and log paths keyed by executable tree digest. */
export function daemonPathsByDigest(
  digest: string,
  home: string = jarvisHome(),
): {
  socketPath: string;
  pidPath: string;
  logPath: string;
} {
  const key = digest.slice(0, 16);
  return {
    socketPath: join(home, `daemon-${key}.sock`),
    pidPath: join(home, `daemon-${key}.pid`),
    logPath: join(home, `daemon-${key}.log`),
  };
}

/** Root of every managed worktree under a jarvis home. */
export function worktreesRoot(jarvisRoot: string): string {
  return join(jarvisRoot, "worktrees");
}

/** The managed worktree for a `(project, branch)` key; the only place the layout is spelled out. */
export function managedWorktreePath(jarvisRoot: string, projectName: string, branchName: string): string {
  return join(worktreesRoot(jarvisRoot), projectName, branchName);
}
