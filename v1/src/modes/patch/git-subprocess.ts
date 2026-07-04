/** Bound on every real `git` subprocess spawned from patch-mode code: a wedged git call must not hang the caller past this. */
export const GIT_SUBPROCESS_TIMEOUT_MS = 10_000;

/** Shared timeout+kill options for every `git` subprocess spawned from patch-mode code (`execFileSync`/`spawnSync`). */
export const GIT_SUBPROCESS_OPTS = { timeout: GIT_SUBPROCESS_TIMEOUT_MS, killSignal: "SIGKILL" as const };
