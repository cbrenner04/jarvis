# `jarvis cleanup` reaps dead daemon sockets but leaves their .log/.pid files to accumulate unbounded

## Problem

Every source-tree digest that ever ran a daemon leaves three files in `~/.jarvis`: `daemon-<digest>.sock`, `daemon-<digest>.log`, and `daemon-<digest>.pid`. `jarvis cleanup`'s socket-reaping removes dead `.sock` files (connect probe → `ECONNREFUSED`/`ENOENT`), but does NOT touch the paired `.log` and `.pid`. Since the digest rotates on every merge/rebuild, these pairs accumulate one-per-digest without bound.

Observed 2026-08-31: exactly 1 dead `.sock` remained (reaping works), but dozens of `daemon-*.log` / `daemon-*.pid` pairs dating back to 2026-07-27 sat un-reaped. They are tiny (100 B – 28 KB each), so this is clutter/hygiene, not a disk problem — but it makes `~/.jarvis` hard to eyeball and grows forever.

## Decisions

- Extend cleanup's dead-daemon-socket reaping to also remove the paired `daemon-<digest>.log` and `daemon-<digest>.pid` for a digest proven dead — same liveness test already used for the socket (dead `.sock`, or no live process for the recorded pid). Keep live daemons' files. Rules out reaping a live daemon's log/pid.
- Optionally retain the most-recent-N dead-daemon logs (e.g. 3) for post-mortem, reaping the rest; a dead daemon's `.pid` has no retention value and is always removed. Rules out destroying the immediately-useful recent log while still bounding growth.
- Report reaped files in cleanup stdout (and `--dry-run` preview) the same way dead sockets are reported. Rules out silent deletion.
- Scope: the `~/.jarvis` daemon-file triplet only. The separate unbounded-growth concerns below get their own treatment — do not conflate.

## Acceptance criteria

- [ ] A cleanup test proves a dead digest's `daemon-<digest>.log` and `.pid` are removed alongside its dead `.sock`, and a live daemon's `.log`/`.pid`/`.sock` are all preserved; it fails against the pre-fix reap that removes only the socket.
- [ ] `--dry-run` lists the log/pid files it would reap without removing them.
- [ ] If a most-recent-N retention is implemented, a test pins that the newest N dead-daemon logs survive and older ones are reaped, and every dead `.pid` is removed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the cleanup socket-reaping section notes it also reaps dead daemons' `.log`/`.pid` files.

## Related (separate, larger retention gaps — not this seed)

The actual `~/.jarvis` disk bloat is elsewhere and unbounded: `sessions/` (~6.2 GB of agent transcripts) and `telemetry.jsonl` (~148 MB, append-only, read by session-report cost queries). Both want a retention/rotation policy but are out of scope here — candidate seeds if they bite. Fold this seed into [[cleanup-improvements]] if that is being worked at the same time.

## Sequencing

P3 — cosmetic hygiene, KB-scale. Cheap; slot with any cleanup work.
