# `jarvis run kill --force <id>` Clears a Stale Non-Active Run

repo: cbrenner04/jarvis

- [x] [00 - Parse and forward `--force` on `run kill`](./00-run-kill-force-flag.md)

Scope note: CLI admission only. The daemon force-settlement path already ships (`20260820T085143Z-daemon-force-settles-stale-nonactive-run`); this spec makes it reachable from a terminal, inheriting that path's abort-vs-force-settle behavior as-is. Declared non-goals: the tui kill binding keeps sending unforced `kill`; `run wait`'s pre-existing flag-shaped-argv mis-parsing (`v2/src/commands/run.ts:367`) is left alone, since fixing it means a third parse path on a read-only command whose failure mode is a harmless `unknown_run`.
