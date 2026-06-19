import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { collectSubtree, DescendantTracker, listProcesses, type ProcInfo } from "../../../src/modes/patch/reap.ts";

/** Wait until `cond()` is true or `timeoutMs` elapses. */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("collectSubtree", () => {
  const proc = (pid: number, ppid: number, pgid: number): ProcInfo => ({ pid, ppid, pgid, identity: `id-${pid}` });

  test("collects transitive descendants and excludes the root and unrelated processes", () => {
    const procs = [
      proc(100, 1, 100), // root
      proc(200, 100, 100), // child
      proc(300, 200, 200), // grandchild (own group via setsid)
      proc(400, 1, 400), // unrelated
      proc(500, 400, 400), // unrelated child
    ];
    const pids = collectSubtree(100, procs)
      .map((p) => p.pid)
      .sort((a, b) => a - b);
    expect(pids).toEqual([200, 300]);
  });

  test("includes processes still sharing the root's process group", () => {
    const procs = [
      proc(100, 1, 100), // root
      proc(250, 1, 100), // re-parented to init but still in root's pgid
    ];
    expect(collectSubtree(100, procs).map((p) => p.pid)).toEqual([250]);
  });
});

describe("DescendantTracker", () => {
  const spawned: number[] = [];

  afterEach(() => {
    for (const pid of spawned.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  test("reap on an empty tracker kills nothing and never throws", () => {
    const tracker = new DescendantTracker();
    expect(tracker.trackedCount).toBe(0);
    expect(tracker.reap()).toBe(0);
  });

  test("reaps a descendant that escaped its group and re-parented to init", async () => {
    // "Agent" forks a grandchild that detaches via setsid() and ignores
    // SIGTERM, then both sleep. Killing the agent leaves the grandchild
    // re-parented to init (PPID=1) with no live lineage back to us — the
    // exact orphan the process-group kill cannot reach.
    const agent = spawn(
      "perl",
      [
        "-e",
        'use POSIX qw(setsid); my $p = fork(); die unless defined $p; if ($p == 0) { setsid(); $SIG{TERM} = sub {}; sleep 60; exit 0; } $| = 1; print "$p\\n"; sleep 60;',
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const agentPid = agent.pid;
    expect(agentPid).toBeDefined();
    if (agentPid !== undefined) spawned.push(agentPid);

    // Read the grandchild PID the agent prints once the fork has happened.
    let buf = "";
    const grandchildPid = await new Promise<number>((resolve, reject) => {
      agent.stdout?.on("data", (chunk) => {
        buf += String(chunk);
        const nl = buf.indexOf("\n");
        if (nl >= 0) resolve(Number.parseInt(buf.slice(0, nl), 10));
      });
      agent.on("error", reject);
      setTimeout(() => reject(new Error("agent did not report grandchild pid")), 3000);
    });
    spawned.push(grandchildPid);

    // Sample the subtree while the lineage is intact, capturing the grandchild.
    const tracker = new DescendantTracker();
    expect(await waitFor(() => alive(grandchildPid))).toBe(true);
    tracker.poll(agentPid as number);
    expect(tracker.trackedCount).toBeGreaterThanOrEqual(1);

    // Kill the agent; the grandchild survives and re-parents to init.
    process.kill(agentPid as number, "SIGKILL");
    const reparented = await waitFor(() => {
      const self = listProcesses().find((p) => p.pid === grandchildPid);
      return self !== undefined && self.ppid === 1;
    });
    expect(reparented).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    // The reaper kills the orphan by its recorded PID + start-time identity.
    const killed = tracker.reap();
    expect(killed).toBeGreaterThanOrEqual(1);
    expect(await waitFor(() => !alive(grandchildPid))).toBe(true);
  });

  test("does not target a tracked PID that has already exited (reuse guard)", async () => {
    const child = spawn("perl", ["-e", "$SIG{TERM} = sub {}; sleep 60;"], { stdio: "ignore" });
    const childPid = child.pid;
    expect(childPid).toBeDefined();
    if (childPid === undefined) return;
    spawned.push(childPid);

    // Capture the child as a descendant of this test process.
    const tracker = new DescendantTracker();
    expect(await waitFor(() => alive(childPid))).toBe(true);
    tracker.poll(process.pid);
    expect(tracker.trackedCount).toBeGreaterThanOrEqual(1);

    // It exits on its own; the tracked PID is now gone (or could be reused by
    // an unrelated process). reap must not report a kill for it, and must prune
    // it so the map stays bounded.
    process.kill(childPid, "SIGKILL");
    expect(await waitFor(() => !alive(childPid))).toBe(true);
    expect(tracker.reap()).toBe(0);
    expect(tracker.trackedCount).toBe(0);
  });
});
