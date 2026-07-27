# 00 - Continue cleanup without a listening daemon

## Problem

`runCleanupCliCommand` connects to the digest-keyed socket before `runCleanupCommand`. Connect
`ENOENT` (and the same no-listener cases the reaper already treats as dead) abort with exit 1
and a raw socket error, so dead-socket reaping and open-home stranded archival never run.

## Decisions

- Keyed-socket connect failures that prove no listener (`ENOENT`, `ECONNREFUSED`) continue into cleanup with an absent-daemon client — rules out CLI exit 1 before reaper/stranded phases.
- Other keyed-socket connect failures (timeout, permission, unexpected errno) still abort the command — rules out classifying every connect error as absent daemon.
- Absent-daemon client fails daemon live probes in `checkEligibility` with a stable unreachable reason — rules out fail-open `() => []` that would retire under no daemon.
- `--abandon` shares the same connect classification and absent-daemon client — rules out bulk cleanup continuing while abandon still hard-aborts at connect.
- Exit 1 when one or more discovered worktrees were skipped because the daemon was unreachable (absent keyed socket or failed live probe); exit 0 when none did — rules out the current daemon-throws dry-run exit 0.
- One stderr recovery line when continuing without a listener, naming the condition and `jarvis daemon start` — rules out printing the bare keyed socket path or `connect ENOENT` alone.
- `store.listRuns()` throw still aborts the command — rules out per-worktree skip on store failure (`v2/docs/operator-runbook.md` § Cleanup).
- Reaper and stranded open-home scan always run inside `runCleanupCommand` for that invocation — rules out gating them on successful keyed-socket connect.

## Tasks

- [ ] Classify keyed-socket connect errors in `cleanup-cli.ts`; on no-listener, emit the recovery stderr line and construct an absent-daemon `DaemonClient` (including abandon).
- [ ] Surface daemon-unreachable worktree skips during preview and fold them into the command exit code in `cleanup.ts`.
- [ ] Add regression coverage in `v2/src/commands/cleanup-cli.test.ts` and/or `v2/src/commands/cleanup.test.ts`; adjust tests that assumed connect failure always exits 1 before any cleanup work.
- [ ] Update documentation listed below.

## Acceptance criteria

- [ ] With no daemon listening on the keyed socket, `jarvis cleanup` (via `runCleanupCliCommand` or `runCleanupCommand` with an absent-daemon client) reaps dead sockets, scans stranded open-home specs, and skips merged worktrees with a daemon-unreachable reason instead of aborting at connect; a regression test named in `cleanup-cli.test.ts` or `cleanup.test.ts` fails against the pre-fix abort.
- [ ] Stderr from that path names the missing-daemon condition and `jarvis daemon start` and does not print the bare keyed socket path.
- [ ] Exit status is 0 when no discovered worktree required daemon reachability and non-zero when at least one was skipped for daemon unreachability (including the absent-daemon client case).
- [ ] Inverting the absent-socket continue guard turns the first regression test RED.
- [ ] When `listRuns()` throws, cleanup still aborts with that error rather than skipping worktrees; a test in `cleanup.test.ts` fails if the error is swallowed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — absent keyed socket vs connected-but-unreachable daemon, phases that run without a listener, exit-status contract.
- `v2/docs/v1-behaviors.md` — no-listener continue, stderr recovery hint, and exit contract for cleanup.
