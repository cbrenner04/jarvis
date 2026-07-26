# 02 - Load-sensitive files run isolated

## Problem

Three load-dependent failures were observed on 2026-07-26, each green on a quiet machine and red with
three concurrent implement runs saturating the box:

- `v2/src/daemon/daemon-workflow-start.test.ts` — "eagerly provisions the managed worktree before
  dispatch for a linked implement step" asserted 3 provisioning calls, got 2 under load; 26/26 pass
  idle.
- `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` — "captures a real child's stdout into
  logPath" is known to fail under load; passes 23/23 idle.
- One unnamed `test:integration:v2` file failed under load, all green idle on the same commit.

The bounded pool from subspec 01 makes added load the default condition of every gate run. Without an
isolation rule these three become routine failures rather than occasional operator surprises.

## Decisions

- A dedicated `isLoadSensitive` predicate in `scripts/test-slice.ts`, distinct from the existing
  `isSandboxUnrunnable` (`scripts/test-slice.ts:4-8`), covers two declaration mechanisms: it defaults
  to including every `*.sandbox-unrunnable.test.ts` file, plus an exported explicit list for files
  outside that suffix set. Rules out overloading `isSandboxUnrunnable` itself as the load-sensitivity
  signal — that predicate is the slice-partition key (which `test:*` script runs a file), a distinct
  concern from scheduling, and conflating them would block ever graduating one suffix-matched file to
  poolable without touching the partition. Rules out an explicit list alone (the unnamed integration
  failure cannot be named) and rules out a new filename suffix (renaming would churn the files and
  hide the per-file flake rationale the list's comments carry). Defaulting to the suffix set preserves
  today's serialization for those files exactly — they already run serially in both the pre-change and
  post-change paths, so the isolation default costs nothing beyond unrealized pooling opportunity.
- The two named daemon failures are explicit-list entries (the suffix-matched one is covered by
  convention, no separate entry needed); the third, unnamed `test:integration:v2` failure is covered
  by the suffix-convention half of the predicate, not a third named entry — the intent's three
  observed failures resolve to two declaration paths, not three list rows. Each explicit-list entry
  carries a comment naming the observed failure. Rules out an unannotated list, which rots into a list
  nobody can prune, and rules out treating the count mismatch as an oversight.
- Isolated means no co-runners in either direction: the pool is drained before an isolated file
  starts, and no other file starts while it runs. Rules out "excluded from the pool but overlapping
  the pool", which leaves the file running under exactly the load it was excluded for.
- Isolated files run after the concurrent phase, one at a time. Rules out running them first, which
  leaves the box idle for their whole serial duration before any concurrency starts.
- Isolation does not change mode semantics: `agent` mode still continues past an isolated file's
  timeout and stops on a plain failure exactly as subspec 01 defines for pooled files; other modes
  still start nothing further after either. Rules out treating an isolated file's failure as a
  distinct class.
- The `.sandbox-unrunnable.test.ts` slice partition itself is untouched. Rules out folding isolation
  into `partitionTestFiles`, which would change which roster each `test:*` script runs.

## Acceptance criteria

- [ ] Every `*.sandbox-unrunnable.test.ts` file and every file on the explicit load-sensitive list is
      scheduled with no co-runners: a test drives a mixed fixture roster and asserts observed overlap
      is exactly 1 for the whole duration of each isolated file, while the remaining files overlap up
      to the limit. It fails against subspec 01's runner, which schedules them into the pool.
- [ ] `v2/src/daemon/daemon-workflow-start.test.ts` and
      `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` are both classified load-sensitive:
      a test asserts each is isolated when present in a roster.
- [ ] `isLoadSensitive` is distinct from `isSandboxUnrunnable`: a test asserts a file matched by the
      suffix convention but not on the explicit list is both sandbox-unrunnable and load-sensitive,
      and that the two predicates are independently callable.
- [ ] Isolated files run after the concurrent files: a test asserts no isolated file starts while any
      pooled file is in flight.
- [ ] `agent` mode continues past a timed-out isolated file and stops on a plain failure exactly as
      it does for pooled files (subspec 01); a non-`agent` mode starts nothing after either: a test
      asserts both, and the roster's failing file is still reported by name.
- [ ] Inverting the isolation predicate fails a test: treating a load-sensitive file as poolable, and
      treating a poolable file as load-sensitive, each break at least one test; the predicate's
      negative case asserts the suppressed effect — that no co-runner is spawned during an isolated
      file's window — not merely that the run passed.
- [ ] Roster equivalence holds: `test/test-slices.test.ts` stays green, including its slice-partition
      assertions (isolation reorders execution, it does not change the roster).
- [ ] `bun run check` is green.

## Documentation updates

- `v2/docs/test-writing.md` — how a file is declared load-sensitive (both mechanisms), what isolation
  guarantees, that isolated files run after the concurrent phase, and when to add an entry (a test
  that is green idle and red under load).
- `v2/docs/v1-behaviors.md` — extend the runnable-test-commands entry with the isolation rule.
