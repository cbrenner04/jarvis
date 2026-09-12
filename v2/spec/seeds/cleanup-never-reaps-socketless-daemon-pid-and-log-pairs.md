---
name: cleanup-never-reaps-socketless-daemon-pid-and-log-pairs
---

# `jarvis cleanup` discovers dead daemon artifacts only through `.sock` files, so socket-less `.pid`/`.log` pairs accumulate forever

> **Absorbed by the daemon-identity chain (annotated 2026-09-12).** This seed is not separately scheduled: its fix falls out of [[daemon-identity-is-not-its-version]], specifically the `retire-digest-daemon-artifacts` lane. It is retained rather than reaped because the chain's ready-intents do **not** carry the reproductions recorded below, and those are the evidence that the lane actually closed this shape. Reap it once that lane lands and the behaviour here is verified on `main` — not before.

## Problem

The dead daemon-digest artifact slice in `v2/src/commands/cleanup.ts` enumerates `~/.jarvis/daemon-<key>.sock` names and treats each key's `.sock`/`.pid`/`.log` as one lifecycle unit. A daemon that exits cleanly (supersede, `daemon stop`, restart on a new digest) unlinks its socket but leaves its `.pid` and `.log`. Because discovery starts from the socket, those keys are never enumerated and the pairs are never reaped. Every merge that rotates the digest adds one more pair.

## Evidence

Observed 2026-09-08 on the operator machine: `ls ~/.jarvis` listed 297 `daemon-<key>.pid` files and 297 matching `.log` files against exactly one `daemon-<key>.sock`. Repeated `jarvis cleanup` runs across prior sessions did not reduce the count.

## Decisions

- Discovery enumerates keys from the union of `daemon-<key>.sock`, `.pid`, and `.log` names (same exact lowercase 16-hex key grammar), not from sockets alone.
- A key with no socket is reaped when its `.pid` names no live process (or the pid file is unreadable); a key whose pid is alive is preserved and reported, since a socket-less live daemon is a bug to surface, not hide.
- The existing socket-present rules (`ECONNREFUSED`, `ENOENT` on a present socket with no live pid) are unchanged; the current-digest daemon's artifacts are never touched.
- `cleanup --dry-run` lists socket-less keys under the same daemon-artifact heading with a `no socket` reason.

## Documentation updates

- `v2/docs/operator-runbook.md` § Fail-closed daemon reads and digest artifact reaping: describe socket-less discovery and the live-pid preservation rule.
- `v2/docs/v1-behaviors.md`: update the `[v2 additive]` cleanup daemon-digest reaping entry.
