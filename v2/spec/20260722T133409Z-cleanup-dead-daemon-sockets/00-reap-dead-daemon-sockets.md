# 00 - Reap dead daemon sockets during cleanup

## Problem

Digest-keyed turnover (`~/.jarvis/daemon-<key>.sock`, `v2/src/paths.ts`) accumulates one socket per executable
digest ever run. Nothing removes them, and nothing distinguishes a socket whose daemon exited from one a live
daemon — current or superseded — is still serving.

## Decisions

- Classify a socket dead only when a connect attempt proves no listener is bound (`ECONNREFUSED`/`ENOENT`); rules out age-, digest-, or current-version-based deletion.
- Classify every other probe result — success, timeout, permission error, unexpected throw — as preserve; rules out reusing `probeSocket`'s boolean, which collapses "busy daemon" into "dead".
- Classify each discovered socket independently; rules out assuming only the invoking digest can be live.
- A failure enumerating the daemon home reaps nothing that pass; rules out partial-result reaping.
- Reap sockets only, not the sibling `.pid`/`.log` files; rules out widening removal to files an operator may still be reading. Deferred to first consumer: keyed `.pid`/`.log` reaping — pin when an operator reports them accumulating.
- Reaping runs inside `runCleanupCommand` alongside worktree and stranded-artifact handling, honoring `--dry-run` and the single confirm prompt; rules out a separate operator command.
- Dead sockets count toward the "nothing to clean up" early return; rules out a reap that the early return silently skips.
- Reaper lives in `v2/src/commands/daemon.ts` beside the command's existing daemon-path helpers; rules out a new module whose co-located tests would sit off the surface this spec pins.

## Tasks

- [ ] Export a reaper from `v2/src/commands/daemon.ts`: enumerate `daemon-*.sock` under the jarvis home, classify each, return the dead set plus preserved-with-reason entries.
- [ ] Wire it into `runCleanupCommand` preview, dry-run, confirm, and apply paths in `v2/src/commands/cleanup.ts` (+ `cleanup-cli.ts` if the jarvis home is not already threaded).
- [ ] Cover liveness classification and the unprobeable-preserve branch in `v2/src/commands/daemon.test.ts`; cover cleanup wiring in `v2/src/commands/cleanup.test.ts`.
- [ ] Update the documentation listed below.

## Acceptance criteria

- [ ] `jarvis cleanup` removes a `~/.jarvis/daemon-<key>.sock` whose connect proves no listener is bound.
- [ ] `jarvis cleanup` preserves every socket a daemon answers on, whether that daemon is the invoking digest or a superseded one.
- [ ] A socket whose probe neither succeeds nor proves absence of a listener (timeout, permission error, unexpected error) is preserved and reported with its reason.
- [ ] A failure enumerating the daemon home removes no socket in that cleanup run.
- [ ] `jarvis cleanup --dry-run` lists the dead sockets and removes none.
- [ ] A cleanup run whose only work is dead sockets previews and reaps them instead of reporting nothing to clean up.
- [ ] A regression test in `v2/src/commands/daemon.test.ts` proves an unprobeable socket is preserved; it fails against the pre-fix code.
- [ ] Inverting each added guard fails a test: inverting the live-socket guard, the unprobeable-preserve guard, the enumeration-failure guard, or the dry-run guard each makes a test observe a socket removed that must survive.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Socket path: who owns a keyed socket and the connect-refused reaping rule.
- `v2/docs/write-behavior.md` — cleanup's daemon-socket artifact behavior, including dry-run.
- `v2/docs/operator-runbook.md` — running cleanup while overlapping keyed daemons are live.
- `v2/docs/v1-behaviors.md` — record that cleanup now reaps dead daemon sockets.
