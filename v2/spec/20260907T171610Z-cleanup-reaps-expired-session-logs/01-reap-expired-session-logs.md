# Reap expired session logs

## Problem

`jarvis cleanup` never deletes settled session logs under `~/.jarvis/sessions/`; only direct `.log` children of that directory are in scope, but they grow without bound while `jarvis run log` reads the state store instead.

## Decision ledger

- Session-log retention is a fifth independent cleanup slice; it runs on every cleanup invocation even when merged-worktree, ref-prune, stranded-artival, and socket slices report nothing eligible; rules out tying reaping to worktree eligibility or the early "nothing to clean" return.
- Expiry compares the owning run's durable `finishedAt` against `now - retentionDays`; rules out file mtime or filename timestamp as the age signal.
- A `.log` file is reap-eligible only when its basename resolves to a run id present in the injected state store, that run's status is terminal (`isTerminalRunStatus`), and `finishedAt` is a finite timestamp older than the retention cutoff; rules out deleting logs for live, non-terminal, recent, or unowned runs.
- Unparseable basenames, unknown run ids, terminal rows with null `finishedAt`, and non-terminal rows preserve the file; rules out age-only deletion when settlement cannot be proved.
- The slice enumerates only regular files whose names end in `.log` directly under the sessions directory; rules out recursing nested directories or mutating non-`.log` siblings such as decoy `telemetry.jsonl` or `state/v2.sqlite` placed in that directory.
- Invalid `cleanup.sessionLogRetentionDays` skips this slice: stderr names the key, no session `.log` is deleted, and other cleanup slices proceed; rules out silently falling back to a coerced default when config is invalid.
- `--dry-run` prints aggregate expired count, reclaimable bytes, and oldest-kept calendar date without listing filenames; apply prints the same summary for reaped logs; rules out flooding stdout with hundreds of thousands of paths.
- Run-id extraction from `<run-id>-<session-log-timestamp>.log` uses the standard UUID prefix before the session-log timestamp segment; rules out splitting on the first hyphen inside the UUID.

## Prerequisites

- Subspec 00: `readCleanupSessionLogRetentionDays`.
- `Run.finishedAt`, `isTerminalRunStatus`, and `store.listRuns()` in `v2/src/persistence/state-store.ts`.
- Session log filename shape from `shared/invocation/session-log.ts` and `formatSessionLogTimestamp` in `v2/src/execution/write-loop.ts`.

## Task checklist

- Implement session-log discovery, eligibility, deletion, and summary reporting in `v2/src/commands/cleanup.ts`; inject sessions directory, clock, config path, and state store for tests.
- Wire the slice into `runCleanupCommand` for both `--dry-run` and apply after existing discovery preview (or alongside socket reaping) without blocking other slices on invalid retention config.
- Add `v2/src/commands/cleanup.test.ts` fixtures with temp jarvis home, sessions dir, and state-store rows covering default and configured retention windows, invalid config refusal, scope guard files, and dry-run vs apply summaries.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `session retention reaps only old terminal run logs` proves the default and configured windows remove old terminal-owned logs while preserving recent, live, non-terminal, and unknown-owner logs; it fails against the pre-fix no-reap behavior.
- [x] `v2/src/commands/cleanup.test.ts` test `session retention config default and invalid values refuse reaping` proves an absent `cleanup.sessionLogRetentionDays` uses 14 days and each invalid value reports the key and preserves candidate logs; it fails against the pre-fix missing-validation behavior.
- [x] `v2/src/commands/cleanup.test.ts` test `session retention guard preserves excluded paths` proves cleanup touches only direct `.log` children of `~/.jarvis/sessions/` and preserves `telemetry.jsonl`, `state/v2.sqlite`, and files outside that directory; it fails against the pre-fix no-reap behavior reachable on main because cleanup never enumerates session logs today.
- [x] `v2/src/commands/cleanup.test.ts` test `session retention dry-run reports aggregate summary without filenames` proves `--dry-run` reports expired session-log count, bytes, and oldest-kept date without filenames and performs no mutation; it fails against the pre-fix no-reap behavior.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None — operator, config, and parity prose land in subspecs 02–04 after behavior lands here.
