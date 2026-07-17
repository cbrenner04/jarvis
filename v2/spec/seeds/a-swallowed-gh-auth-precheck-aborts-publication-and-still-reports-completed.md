# A swallowed `gh auth status` pre-check aborts publication and the run still reports `completed`

## Problem

A v2 `implement` run committed its work locally, **never pushed, never opened a PR, never ran the
ready gate** — and reported `runStatus: "completed"` on every one of its five run rows. `daemon.log`
recorded nothing. Observed 2026-07-16 on `20260716T215724Z-promotion-consumes-its-input`; the same
commit-and-no-PR signature hit the prior session twice (`plan/triage-merges-v2-plan-worktrees`, the
cleanup implement), where it was written off as "publication failed silently" without a root cause.

This defeats the Wave 1 contract that `completed` implies PR evidence and a green gate (#1658), and
it ships **ungated code**: the hand-run gate on the recovered branch was red (5 biome errors) on a
run that called itself complete.

## Root cause — proven, not inferred

Publication **did** run. It aborted inside the publisher's auth pre-check, which discards the reason.

`v2/src/execution/completion-publisher.ts:93-95`:

```ts
if (!(await ghReady(input.worktreePath))) {
  throw new Error("GitHub auth unavailable; cannot publish PR");
}
```

`defaultGhReady` (`completion-publisher.ts:65-72`) catches **every** error from `gh auth status` and
returns `false`. The real stderr is never persisted.

Evidence chain:

1. **Publication was reached.** `telemetry.jsonl` has `work_boundary_recorded` at 23:26:21.310 for
   shrink run `713dba4b` (`commit_sha: ac138bf6`), emitted at `workflow-runner.ts:790-801` — after
   `if (published.commitSha !== undefined)`, immediately before `publishWithReadyRepair` (`:822`).
2. **It failed 287ms later.** `state/logs.jsonl` run `713dba4b` seq 4, 23:26:21.597:
   `loopOutcomeKind: "completion_commit_failed"`, `resumable: true`.
3. **The failure was outside the retry wrapper.** `runPublicationWithRetry` records
   `details.set(original, failure)` on every catch (`publication-retry.ts:84-88`), so any push/PR
   failure would persist a `publicationFailure` key (`workflow-runner.ts:842-848`). The record has
   **no** such key. In `createCompletionPublisher` the only throw before the first
   `runPublicationWithRetry` is the `ghReady` check.
4. **Timing corroborates a real `gh auth status` call:** timed at 0.248s in that worktree, against
   the observed 287ms gap. A sync throw (binding resolution) would fire at ~0ms.
5. The first push of that branch is the operator's, 21 minutes later. The daemon never pushed.

**Not a regression.** `ghReady` and the throw date to #1282, long before #1654/#1658. #1658's guard
cannot fire — it triggers on `pushSha && !prNumber`, and no push happened.

**Why the pre-check failed is unproven** and unprovable after the fact, because the error text is
discarded. `gh` reads the macOS **keyring** here, so a daemon without Keychain access or a transient
blip both fit. Pushing and `gh` by hand worked first try, 21 minutes later, from the same machine.
That is the point: a transient blip in a pre-check becomes a permanent, unretried, unexplained abort.

## Why it reports `completed`

`daemon/workflow-run-status-rollup.ts:29-43` reads only run-*row* statuses; publication is a
workflow-level activity with no row. `workflow-runner.ts:849-851` calls `setRunStatus(…, "failed")`
**only** for `ready_gate_failed` — `completion_commit_failed` leaves every row `completed`. The CLI
compounds it by waiting on the *entry* runId (`cli.ts:598`) while the failure is logged against the
*shrink* run.

## Decisions

- `completion_commit_failed` demotes the run row exactly as `ready_gate_failed` does; rules out a
  publication failure that rolls up as `completed` (`workflow-runner.ts:849`).
- The `gh auth status` pre-check either goes away — letting `push`/`gh` fail inside
  `runPublicationWithRetry`, which already classifies auth-vs-transient
  (`publication-retry.ts:52-62`) and records evidence — or moves inside the retry wrapper and
  propagates real stderr; rules out an unretried pre-check that converts a transient into a terminal
  abort. Prefer deletion: the pre-check adds a failure mode the retry layer already handles better.
- The underlying error text is persisted on the terminal record; rules out a failure whose only
  diagnosis is post-hoc timing forensics.
- A run that reports `completed` has PR evidence, or it does not report `completed`; rules out
  reasserting the #1658 contract in prose while a path bypasses it.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — the `completed` contract currently overstates what is
  enforced; state the enforcement honestly until this ships.
- Remove the § Recovery "Publication / completion failures" advice to inspect
  `error.publicationFailure` first — on this path that key is absent, which is the tell.
