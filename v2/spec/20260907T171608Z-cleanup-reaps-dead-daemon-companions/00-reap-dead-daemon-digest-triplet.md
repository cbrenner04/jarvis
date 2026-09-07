# 00 - Reap dead daemon digest triplet during cleanup

## Problem

Digest-keyed daemon turnover writes a socket, PID file, and process log per executable digest under `JARVIS_HOME` (`daemonPathsByDigest` in `v2/src/paths.ts`). Cleanup's dead-socket reaper (`reapDeadDaemonSockets` in `v2/src/commands/daemon.ts`, wired from `v2/src/commands/cleanup.ts`) removes a provably dead `.sock` but leaves its paired `.pid` and `.log`, so dead daemon generations accumulate.

## Decisions

- Resolves `20260722T133409Z-cleanup-dead-daemon-sockets` deferral "keyed `.pid`/`.log` reaping — pin when an operator reports them accumulating"; this spec is that first consumer and supersedes socket-only reaping tests and docs.
- Treat each keyed daemon digest as one lifecycle unit keyed off its `daemon-<16hex>.sock` path; rules out independent per-file classification or removal.
- Classify liveness only from the socket connect probe (`ECONNREFUSED`/`ENOENT` → dead; success → live; all other errors → preserved with reason); rules out inferring daemon death from stale-looking PID or log metadata.
- When the socket probe is dead, remove the matching `.sock`, `.pid`, and `.log` if present; rules out socket-only cleanup that leaves one companion pair per dead digest.
- When the socket probe is live or ambiguously preserved, keep the whole triplet even if `.pid` or `.log` look stale; rules out companion-only reaping while the socket is preserved.
- Remove every companion for a provably dead digest; rules out a most-recent-N log retention exception whose ordering contract has no current caller.
- Socket-less `.pid`/`.log` orphans are out of scope; the reaper enumerates `daemon-*.sock` only and cannot reap companions without a socket-gated liveness proof; rules out orphan-only discovery that would infer death from PID or log metadata.
- Extend the reaper return shape and cleanup preview/apply to carry all dead digest artifact paths; rules out companion removal logic duplicated only in `cleanup.ts` without `daemon.ts` owning the triplet contract.
- Resolve companion paths from the socket filename's digest key using the same `daemon-<key>.{sock,pid,log}` naming as `daemonPathsByDigest`; rules out a second path-construction scheme.
- Preview and apply output stay artifact-level (not digest-level): count `reaperResult.dead.length` as dead daemon artifacts, list every selected path under `remove:`, and print one apply line per removed path; update preview header and apply prefix copy from socket-only wording; rules out digest-level summaries that hide companion paths or leave stale "socket" labels after triplet expansion.
- Normal and `--dry-run` output list every dead digest artifact selected for removal; rules out silent companion deletion without preview lines.
- Fail-safe socket classification is unchanged; revise `daemon.test.ts` `reapDeadDaemonSockets` `ignores files that do not match daemon-*.sock pattern` to expect a dead socket's present `.pid`/`.log` companions in `dead` instead of preserving the superseded socket-only contract.

## Tasks

- [ ] Extend `reapDeadDaemonSockets` in `v2/src/commands/daemon.ts` to derive each digest's `.pid` and `.log` companions from the socket filename and include all provably dead digest artifact paths in its dead set (present files only).
- [ ] Update cleanup preview and apply in `v2/src/commands/cleanup.ts` so dead digest artifacts beyond the socket are reported and removed on apply, with artifact-level preview/apply copy, without changing preserved/live reporting semantics.
- [ ] Revise `v2/src/commands/daemon.test.ts` `reapDeadDaemonSockets` `ignores files that do not match daemon-*.sock pattern` for triplet companions; keep live, preserved-probe, and enumeration-failure cases unchanged.
- [ ] Add regression coverage in `v2/src/commands/cleanup.test.ts` under the existing dead daemon reaping describe block.
- [ ] Update the documentation listed below.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `dead daemon digest reaps socket pid and log` proves apply removes the `.sock`, `.pid`, and `.log` triplet, `--dry-run` reports all three under artifact-level preview copy without mutation, and live and ambiguously probed triplets are preserved; it fails against the pre-fix socket-only reaper.
- [ ] `v2/src/commands/daemon.test.ts` `reapDeadDaemonSockets` `returns empty lists when jarvis home does not exist`, `enumeration failure leaves sockets untouched`, `preserves sockets that probe with errors other than ECONNREFUSED/ENOENT`, and `does not classify a live daemon socket as dead` stay green.
- [ ] `v2/src/commands/daemon.test.ts` `reapDeadDaemonSockets` `ignores files that do not match daemon-*.sock pattern` expects a dead socket's present `.pid`/`.log` companions in `dead`.
- [ ] `v2/docs/operator-runbook.md` documents dead daemon digest artifact preview, triplet reaping on apply, and fail-safe preservation when the socket probe is live or ambiguous.
- [ ] `v2/docs/v1-behaviors.md` records v2 cleanup's keyed daemon triplet lifecycle (dead digest removes `.sock`/`.pid`/`.log`; live or ambiguous probe preserves the triplet); supersedes the socket-only reaping note from `20260722T133409Z-cleanup-dead-daemon-sockets`.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/daemon-host.md` cross-link or align with the operator-runbook triplet lifecycle so no durable home still describes socket-only reaping.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — durable home for dead daemon digest artifact preview, triplet reaping on apply, and fail-safe preservation (§ Fail-closed daemon reads and socket reaping).
- `v2/docs/v1-behaviors.md` — record v2 cleanup's keyed daemon triplet lifecycle; supersede the socket-only reaping note from `20260722T133409Z-cleanup-dead-daemon-sockets`.
- `v2/docs/write-behavior.md` — cross-link or align cleanup's daemon digest artifact behavior with the operator-runbook home.
- `v2/docs/daemon-host.md` — cross-link or align keyed socket cleanup/reaping with the operator-runbook home.
