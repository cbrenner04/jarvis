# Cleanup's retirement path cannot identify any workflow-produced spec

## Problem

`artifactForRetiredWorktree` (`v2/src/commands/cleanup.ts`) resolves the spec for a just-retired
worktree with:

```ts
const run = store.findRunByProjectBranch({ project: candidate.project, branch: candidate.worktree.branch });
if (run === null || run === undefined) return undefined;   // → "no durable spec identity"
```

No `stepId` is passed, and the store treats an absent `stepId` as an explicit **`step_id IS NULL`**
match (`v2/src/persistence/state-store.ts:462`):

```sql
SELECT id FROM runs WHERE project = ? AND branch = ? AND step_id IS NULL ORDER BY created_at DESC …
```

Every workflow-created run has a non-null step id. Actual rows for one of tonight's branches:

```text
cdf1f14d …  implement~link-0    v2/spec/20260721T125736Z-…/index.md
fdf3580f …  implement~shrink    v2/spec/20260721T125736Z-…/index.md
f1ac311a …  implement-review    …/verdict-patch.md
```

So the lookup matches nothing and cleanup prints
`Skipped artifact: <worktree> — no durable spec identity`, despite the spec path being recorded on
those very rows. The only runs it can resolve are ad-hoc `jarvis run start` rows — the one path that
creates no workflow step. Since `jarvis run workflow` is the primary path, the retirement-side
archive is effectively dead code for real work.

Observed 2026-07-21: ten specs, ten skips.

## Why it has gone unnoticed

A second, independent path covers it. `recordedStrandedBranch` scans **all** runs and matches by
resolved source path, so it has no such bug and archives the same specs on a later invocation. It
does not fire in the same run because ownership (`hasStrandedOwner`) is judged against the worktree
list discovered before retirement, so a spec whose worktree is being retired in this very
invocation still looks owned.

Net effect: **cleanup needs to be run twice.** The first run retires worktrees and skips every
artifact; the second archives them. Verified — a `--dry-run` immediately after the operator's
cleanup listed all 8 complete specs as eligible.

That is silent, and an operator who runs cleanup once reasonably concludes the specs are not
archivable.

## Decisions

- Pass the step identity through, or resolve by recorded spec path as the stranded scan already
  does; rules out leaving a lookup whose default semantics exclude the primary path.
- Make `findRunByProjectBranch`'s absent-`stepId` behavior explicit at the call site — an omitted
  `stepId` silently meaning `IS NULL` is the trap. Prefer a named argument or separate method for
  "the ad-hoc run with no step".
- Retirement and stranded scanning must agree within one invocation: a worktree retired in this run
  must not count as its own spec's materialized owner. Rules out requiring two invocations.
- Rules out deleting the retirement-side archive in favor of the stranded scan alone: the stranded
  scan is a whole-store sweep, and per-retirement resolution is the cheap path.

## Acceptance criteria

- [ ] A retired worktree whose runs were created by `jarvis run workflow` resolves its spec and
      archives in the **same** cleanup invocation.
- [ ] `Skipped artifact: … no durable spec identity` no longer appears for a workflow-produced spec.
- [ ] A worktree retired during the current invocation does not count as its own spec's materialized
      owner.
- [ ] One `jarvis cleanup` run leaves nothing that a second, immediate run would archive.
- [ ] Specs with unchecked acceptance criteria are still skipped, naming the criterion.
- [ ] Ad-hoc `run start` specs archive exactly as today.
- [ ] Regression coverage seeds workflow-shaped run rows (non-null `step_id`) and fails against the
      current lookup.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup — remove any implication that a single run may leave
  artifacts behind, once fixed.
