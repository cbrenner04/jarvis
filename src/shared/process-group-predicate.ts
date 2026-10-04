/**
 * The current process's own ids. The daemon runs detached (pid == pgid), so `process.pid` also
 * names its group; Bun has no `getpgid` and sync `ps` spawns are guarded out.
 */
export function ownProcessGroupIds(): ReadonlySet<number> {
  return new Set([process.pid]);
}

/** True when signalling/recording `pgid` is safe: a positive id that is not our own pid or group. */
export function isForeignProcessGroup(pgid: number, own: ReadonlySet<number> = ownProcessGroupIds()): boolean {
  return Number.isInteger(pgid) && pgid > 1 && !own.has(pgid);
}
