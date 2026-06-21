import { describe, expect, test } from "bun:test";
import { collectSubtree, DescendantTracker, type ProcInfo } from "../../../src/modes/patch/reap.ts";

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
  // Inject a fixed process table + recording kill so the reap logic is exercised
  // deterministically — no real process spawning (timing-flaky under load and
  // unavailable in restricted sandboxes). The behavior under test (capture
  // descendants, kill survivors by PID+identity, prune gone/reused PIDs) is pure
  // and does not depend on real OS scheduling.
  const proc = (pid: number, ppid: number, pgid: number, identity = `id-${pid}`): ProcInfo => ({
    pid,
    ppid,
    pgid,
    identity,
  });

  test("reap on an empty tracker kills nothing and never throws", () => {
    const tracker = new DescendantTracker();
    expect(tracker.trackedCount).toBe(0);
    expect(tracker.reap()).toBe(0);
  });

  test("reaps a descendant that escaped its group and re-parented to init", () => {
    // Agent 1000 has a grandchild 2000 that detached into its own group (setsid).
    // Killing the agent leaves the grandchild re-parented to init (PPID 1) with
    // no live lineage — the exact orphan a process-group kill cannot reach.
    let table: ProcInfo[] = [proc(1000, 1, 1000), proc(2000, 1000, 2000)];
    const killed: number[] = [];
    const tracker = new DescendantTracker({
      listProcesses: () => table,
      kill: (pid) => {
        killed.push(pid);
      },
    });

    // Sample while the lineage is intact: the grandchild is captured.
    tracker.poll(1000);
    expect(tracker.trackedCount).toBeGreaterThanOrEqual(1);

    // Agent dies; the grandchild survives and re-parents to init, keeping its
    // start-time identity.
    table = [proc(2000, 1, 2000)];

    // The reaper kills the orphan by its recorded PID + start-time identity.
    expect(tracker.reap()).toBe(1);
    expect(killed).toEqual([2000]);
  });

  test("does not target a tracked PID that has exited or been reused (reuse guard)", () => {
    let table: ProcInfo[] = [proc(1000, 1, 1000), proc(2000, 1000, 2000)];
    const killed: number[] = [];
    const tracker = new DescendantTracker({
      listProcesses: () => table,
      kill: (pid) => {
        killed.push(pid);
      },
    });

    // Capture the descendant.
    tracker.poll(1000);
    expect(tracker.trackedCount).toBeGreaterThanOrEqual(1);

    // It exits: the tracked PID is gone. reap must not kill it and must prune it.
    table = [];
    expect(tracker.reap()).toBe(0);
    expect(killed).toEqual([]);
    expect(tracker.trackedCount).toBe(0);

    // Reuse variant: the same PID reappears with a DIFFERENT start-time identity
    // (an unrelated process). reap must still skip and prune it.
    table = [proc(1000, 1, 1000), proc(2000, 1000, 2000)];
    tracker.poll(1000);
    table = [proc(2000, 1, 2000, "reused-by-unrelated-process")];
    expect(tracker.reap()).toBe(0);
    expect(killed).toEqual([]);
    expect(tracker.trackedCount).toBe(0);
  });
});
