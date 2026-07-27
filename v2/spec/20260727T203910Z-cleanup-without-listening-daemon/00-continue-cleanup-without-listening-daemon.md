# 00 - Continue cleanup without a listening daemon

## Problem

`runCleanupCliCommand` connects to the digest-keyed socket for the invoking `jarvis` before
`runCleanupCommand`. Connect `ENOENT` / `ECONNREFUSED` (and the same no-listener cases the reaper
already treats as dead) abort with exit 1 and a raw socket error, so dead-socket reaping and
open-home stranded archival never run.

## Decisions

- Scope is the **digest-keyed socket for the invoking `jarvis`** only — rules out multi-socket
  discovery or “any key” behavior in this spec (discovery is a sibling intent; docs may note that
  interim gap).
- Keyed-socket connect failures that prove no listener (`ENOENT`, `ECONNREFUSED`) continue into
  cleanup with an absent-daemon client — rules out CLI exit 1 before reaper/stranded phases.
- Other keyed-socket connect failures (timeout, permission, unexpected errno) still abort the
  command before reaper/stranded work — rules out classifying every connect error as absent daemon.
- Absent-daemon client fails daemon list probes in `checkEligibility` with a **stable**
  unreachable reason (no keyed socket path, no raw `connect ENOENT`, no leaked `err.message`) —
  rules out fail-open `() => []` that would retire under no daemon.
- Absent-daemon client implements `checkWorkflowStartClaim` to fail stale-reset claim checks with
  the same stable unreachable semantics — rules out abandon/stale-reset paths dying on “missing
  workflow start claim probe” when the real issue is no listener.
- Bulk discovery records each merged worktree skipped solely for daemon unreachability (absent keyed
  listener or failed live list probe); **only** those skips set a non-zero exit — PR-not-merged,
  active runs, and other `checkEligibility` outcomes keep today’s exit-code behavior.
- Daemon-unreachable skip count drives exit on **dry-run preview**, operator **cancel/decline**, and
  **apply**, including when reaper/stranded are empty and eligible candidates are empty (today’s
  `hasNothingToClean` early return 0) — rules out silent success when merged worktrees were
  withheld only for daemon reachability.
- Bulk preview stdout lists each merged worktree skipped for daemon unreachability with the stable
  reason — rules out silent omission while exit is non-zero.
- One stderr recovery line when continuing after no-listener connect on the keyed socket, **before**
  reaper/stranded phases, naming the condition and `jarvis daemon start` — rules out emitting it
  only when merged worktrees exist or printing the bare socket path / `connect ENOENT` alone.
- `--abandon` shares connect classification; when continuing on absent keyed listener, **refuses**
  before destructive preview with stable daemon-unreachable stderr and exit non-zero — rules out
  fail-open `isWorktreeLiveHeld` abandonment while the keyed daemon cannot be consulted (lock-only
  refusal semantics unchanged once a reachable daemon is in use).
- `store.listRuns()` throw still aborts the command — rules out per-worktree skip on store failure
  (`v2/docs/operator-runbook.md` § Cleanup).
- Reaper and stranded open-home scan always run inside `runCleanupCommand` for bulk invocations —
  rules out gating them on successful keyed-socket connect.

## Tasks

- [ ] Classify keyed-socket connect errors in `cleanup-cli.ts`; on no-listener, emit the recovery
  stderr line, construct an absent-daemon `DaemonClient`, and refuse `--abandon` with stable
  stderr.
- [ ] Record daemon-unreachable merged-worktree skips during discovery; surface them in bulk preview
  stdout; fold skip count into exit code for dry-run, cancel/decline, and apply (including
  `hasNothingToClean` path).
- [ ] Add regression coverage in `cleanup-cli.test.ts` and `cleanup.test.ts`; update
  `cleanup with daemon connection failure prints error and exits 1` for replaced no-listener vs
  fail-closed connect behavior.
- [ ] Update documentation listed below.

## Acceptance criteria

- [ ] With no daemon listening on the invoking jarvis digest-keyed socket, bulk `jarvis cleanup`
  reaps dead sockets, scans stranded open-home specs, and lists merged worktrees skipped for
  daemon unreachability instead of aborting at connect; `continues cleanup when keyed socket has no
  listener` in `cleanup-cli.test.ts` fails against the pre-fix abort.
- [ ] Stderr from the no-listener continue path names the missing-daemon condition and
  `jarvis daemon start`, is emitted once before reaper/stranded work, and does not print the bare
  keyed socket path or raw `connect ENOENT`.
- [ ] Bulk preview stdout names each merged worktree skipped for daemon unreachability using stable
  text (no keyed socket path, no raw connect errno, no leaked probe `err.message`).
- [ ] Exit status is 0 when no discovered merged worktree was skipped for daemon unreachability;
  exit non-zero when at least one was, including dry-run, operator cancel/decline, and apply when
  reaper/stranded are empty and no eligible candidates remain (`daemon-unreachable skip exits
  nonzero when nothing else to clean` in `cleanup.test.ts` fails against pre-fix exit 0).
- [ ] Skips for PR-not-merged, non-terminal runs, and other non-daemon ineligibility do not change
  exit code from current behavior (`runCleanupCommand makes worktree ineligible when daemon client
  throws` is updated for daemon-skip exit semantics, not PR/run cases).
- [ ] Non–no-listener keyed-socket connect failures (e.g. timeout, permission) still abort before
  reaper/stranded phases with exit non-zero.
- [ ] `jarvis cleanup --abandon <name>` with absent keyed listener refuses before destructive
  preview, stderr is stable daemon-unreachable text with recovery hint, exit non-zero (`abandon
  refuses when keyed daemon absent` in `cleanup-cli.test.ts` or `cleanup.test.ts`).
- [ ] Inverting the no-listener connect-continue guard turns `continues cleanup when keyed socket
  has no listener` RED.
- [ ] When `listRuns()` throws, cleanup still aborts with that error rather than skipping
  worktrees; inverting that guard turns `listRuns failure aborts cleanup` in `cleanup.test.ts`
  RED.
- [ ] Keyed-socket connect failure that is not no-listener: `cleanup with daemon connection
  failure prints error and exits 1` in `cleanup-cli.test.ts` stays green for fail-closed errors
  (replaced behavior for former blanket connect abort).

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: digest-keyed socket for invoking `jarvis` vs
  connected-but-unreachable daemon; phases that run without a listener; bulk preview lines for
  daemon-unreachable skips; exit contract (daemon skips only vs other ineligibility unchanged);
  interim note that a live daemon on another digest may still yield exit 1 + skipped merges until
  discovery sibling ships; `--abandon` refuses when keyed daemon absent.
- `v2/docs/v1-behaviors.md` — no-listener bulk continue, recovery stderr timing, preview skip
  lines, exit contract, and `--abandon` refusal under absent keyed listener.
