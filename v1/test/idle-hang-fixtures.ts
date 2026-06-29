import { execSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { collectSubtree, DescendantTracker, listProcesses } from "../src/modes/patch/reap.ts";

/** Matches harness `__testKillGraceMs` used by idle watchdog tests. */
export const HANG_FIXTURE_KILL_GRACE_MS = 200;

/** Headroom for parent-death and teardown reap assertions. */
export const HANG_FIXTURE_EXIT_HEADROOM_MS = 400;

export const HANG_FIXTURE_EXIT_DEADLINE_MS = HANG_FIXTURE_KILL_GRACE_MS + HANG_FIXTURE_EXIT_HEADROOM_MS;

/** Backstop when per-test teardown cannot run or see orphans. */
export const IDLE_HANG_MAX_LIFETIME_SEC = 3600;

const IDLE_HANG_STALL = "exec tail -f /dev/null";

/** Parent-death poll and bounded lifetime, then zero-CPU stall. */
export function composeIdleHangWait(): string {
  return `_idle_hang_main=$$
(
  _idle_hang_parent=$PPID
  while kill -0 "$_idle_hang_parent" 2>/dev/null; do sleep 0.05; done
  kill -TERM "$_idle_hang_main" 2>/dev/null || exit 0
) &
(
  sleep ${IDLE_HANG_MAX_LIFETIME_SEC}
  kill -TERM "$_idle_hang_main" 2>/dev/null || exit 0
) &
${IDLE_HANG_STALL}`;
}

export const IDLE_HANG_WAIT = composeIdleHangWait();
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

export function hangFixtureOnSpawned(child: { pid: number }): void {
  trackHangFixtureRoot(child.pid);
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
  reapHangFixtureRegistry(activeRegistry);
  activeRegistry = null;
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

function reapHangFixtureRegistry(registry: HangFixtureRegistry): void {
  const rootPids = new Set(registry.rootPids);
  for (const scriptPath of registry.scriptPaths) {
    for (const pid of findPidsForScriptPath(scriptPath)) {
      rootPids.add(pid);
    }
  }
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") {
      return false;
    }
    throw err;
  }
}

export async function waitForProcessExit(pid: number, deadlineMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(`pid ${pid} still alive after ${deadlineMs}ms`);
}

export function subtreePids(rootPid: number): number[] {
  const procs = listProcesses();
  return [rootPid, ...collectSubtree(rootPid, procs).map((proc) => proc.pid)];
}

export async function waitForSubtreeExit(rootPid: number, deadlineMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (subtreePids(rootPid).every((pid) => !isProcessAlive(pid))) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(`process subtree rooted at ${rootPid} still alive after ${deadlineMs}ms`);
}

export async function waitForSubtreeGrowth(rootPid: number, minimumSize: number, deadlineMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (subtreePids(rootPid).length >= minimumSize) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(`process subtree rooted at ${rootPid} did not reach size ${minimumSize} within ${deadlineMs}ms`);
}

export async function waitForScriptRunning(scriptPath: string, deadlineMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (findPidsForScriptPath(scriptPath).length > 0) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(`no processes matching ${scriptPath} within ${deadlineMs}ms`);
}

export async function waitForScriptExit(scriptPath: string, deadlineMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (findPidsForScriptPath(scriptPath).length === 0) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(`processes matching ${scriptPath} still alive after ${deadlineMs}ms`);
}
