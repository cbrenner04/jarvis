import { execSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { isProcessAlive } from "../../shared/worktree-lock.ts";
import { collectSubtree, DescendantTracker, listProcesses } from "../src/modes/patch/reap.ts";

/** `__testKillGraceMs` (200) + headroom for parent-death/teardown assertions. */
export const HANG_FIXTURE_EXIT_DEADLINE_MS = 600;

/** Backstop when per-test teardown cannot run or see orphans. */
const IDLE_HANG_MAX_LIFETIME_SEC = 3600;

export const IDLE_HANG_WAIT = `_idle_hang_main=$$
(
  _idle_hang_parent=$PPID
  while kill -0 "$_idle_hang_parent" 2>/dev/null; do sleep 0.05; done
  kill -TERM "$_idle_hang_main" 2>/dev/null || exit 0
) &
(
  sleep ${IDLE_HANG_MAX_LIFETIME_SEC}
  kill -TERM "$_idle_hang_main" 2>/dev/null || exit 0
) &
exec tail -f /dev/null`;

export const IDLE_HANG_BODY = `set -euo pipefail
${IDLE_HANG_WAIT}
`;

export function writeIdleHangScript(path: string): string {
  writeFileSync(path, `#!/usr/bin/env bash\n${IDLE_HANG_BODY}`);
  chmodSync(path, 0o755);
  trackHangFixtureScript(path);
  return path;
}

export function trackHangFixtureScript(path: string): void {
  activeRegistry?.scriptPaths.add(path);
}

export function trackHangFixtureRoot(rootPid: number): void {
  activeRegistry?.rootPids.add(rootPid);
}

export function withHangFixtureSpawned<T extends { onSpawned?: (child: { pid: number }) => void }>(opts: T): T {
  return {
    ...opts,
    onSpawned: (child) => {
      trackHangFixtureRoot(child.pid);
      opts.onSpawned?.(child);
    },
  };
}

type HangFixtureRegistry = {
  rootPids: Set<number>;
  scriptPaths: Set<string>;
};

let activeRegistry: HangFixtureRegistry | null = null;

export function beginHangFixtureTracking(): void {
  activeRegistry = { rootPids: new Set(), scriptPaths: new Set() };
}

export function reapActiveHangFixtures(): void {
  if (activeRegistry === null) {
    return;
  }
  const rootPids = new Set(activeRegistry.rootPids);
  for (const scriptPath of activeRegistry.scriptPaths) {
    for (const pid of findPidsForScriptPath(scriptPath)) {
      rootPids.add(pid);
    }
  }
  activeRegistry = null;
  if (rootPids.size === 0) {
    return;
  }

  const tracker = new DescendantTracker();
  for (const rootPid of rootPids) {
    tracker.poll(rootPid);
    try {
      process.kill(rootPid, "SIGTERM");
    } catch {
      // already exited
    }
  }
  tracker.reap();
  for (const rootPid of rootPids) {
    try {
      process.kill(rootPid, "SIGKILL");
    } catch {
      // already exited
    }
    for (const proc of collectSubtree(rootPid, listProcesses())) {
      try {
        process.kill(proc.pid, "SIGKILL");
      } catch {
        // already exited
      }
    }
  }
}

function findPidsForScriptPath(scriptPath: string): number[] {
  try {
    const out = execSync(`pgrep -f ${JSON.stringify(scriptPath)}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return out
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

async function pollUntil(deadlineMs: number, ready: () => boolean, error: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (ready()) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(error);
}

function subtreePids(rootPid: number): number[] {
  const procs = listProcesses();
  return [rootPid, ...collectSubtree(rootPid, procs).map((proc) => proc.pid)];
}

export function waitForProcessExit(pid: number, deadlineMs: number): Promise<void> {
  return pollUntil(deadlineMs, () => !isProcessAlive(pid), `pid ${pid} still alive after ${deadlineMs}ms`);
}

export function waitForSubtreeExit(rootPid: number, deadlineMs: number): Promise<void> {
  return pollUntil(
    deadlineMs,
    () => subtreePids(rootPid).every((pid) => !isProcessAlive(pid)),
    `process subtree rooted at ${rootPid} still alive after ${deadlineMs}ms`,
  );
}

export function waitForSubtreeGrowth(rootPid: number, minimumSize: number, deadlineMs: number): Promise<void> {
  return pollUntil(
    deadlineMs,
    () => subtreePids(rootPid).length >= minimumSize,
    `process subtree rooted at ${rootPid} did not reach size ${minimumSize} within ${deadlineMs}ms`,
  );
}

export function waitForScriptRunning(scriptPath: string, deadlineMs: number): Promise<void> {
  return pollUntil(
    deadlineMs,
    () => findPidsForScriptPath(scriptPath).length > 0,
    `no processes matching ${scriptPath} within ${deadlineMs}ms`,
  );
}

export function waitForScriptExit(scriptPath: string, deadlineMs: number): Promise<void> {
  return pollUntil(
    deadlineMs,
    () => findPidsForScriptPath(scriptPath).length === 0,
    `processes matching ${scriptPath} still alive after ${deadlineMs}ms`,
  );
}
