/**
 * Shared timeout+kill options for every `git` subprocess spawned from patch-mode code
 * (`execFileSync`/`spawnSync`): a wedged git call must not hang the caller past 10s.
 */
export const GIT_SUBPROCESS_OPTS = { timeout: 10_000, killSignal: "SIGKILL" as const };
