# Promoting a seed or ready-intent does not consume it

The spec pipeline is `seed → ready-intent → spec dir → completed/`. Each hop *copies* its input
forward and leaves the original in place, so `seeds/` and `ready-intents/` accumulate artifacts for
work that has already shipped and the backlog stops meaning anything.

Cleaned up by hand on 2026-07-14: **40 dead artifacts** across both surfaces (v1 seeds 14→7,
v1 ready-intents 5→3, v2 seeds 34→22, v2 ready-intents 38→19). Every one described work already on
`main`. Doing that by hand is the harness gap.

## Problem

Three of the four promotion hops leak. Only v1's plan consumes its input:

| hop | v1 | v2 |
|---|---|---|
| `intent` writes ready-intents → delete the seed | **missing** | **missing** |
| `plan` writes a spec dir → delete the ready-intent | works — `deleteReadyIntentFromWorktree` (`v1/src/modes/plan/run.ts:632`, called `:1388`) | **missing** |

- `v1/src/commands/intent.ts:743` validates `inv.seedPath` is inside `<targetDir>/seeds/` and never
  removes it. No `unlinkSync`/`rmSync` of the seed anywhere in the command.
- `v2/src/execution/plan-workflow-steps.ts:134` is a straight port of v1's `validateReadyIntent`, but
  the delete counterpart was never ported. Nothing in `v2/src` removes a ready-intent or a seed.
- `v1/src/commands/cleanup.ts:505` removes the ready-intent on archive — but **only** on the
  `commit: false` (external specs root) branch. The in-repo `commit: true` branch, which is what
  jarvis-on-jarvis uses, has no such `onArchive` step.

Deletion is lossless: `plan` already copies the ready-intent into the spec dir as `intent.md`
(199/199 completed and 6/6 planned v2 spec dirs carry one), so the `ready-intents/` copy is redundant
the moment the spec dir exists.

## Scope

- `intent` deletes the seed it consumed, in **both** v1 and v2, when the ready-intents are written.
  Inline-mode intents (no `seedPath`) have nothing to delete.
- v2's `plan` deletes the ready-intent it consumed when the spec dir is created — parity with v1's
  `deleteReadyIntentFromWorktree`, including its containment checks (target must resolve inside the
  worktree; `realpath` both sides before comparing).
- The deletion is part of the same commit as the artifact it produced, so a failed run leaves the
  input intact and the operation is idempotent on re-run.
- Multi-seed / multi-intent invocations consume every input they actually read, not just the first.

## Decisions

- **Consume on write, not on archive.** The producing command owns the deletion, because that is the
  only point that knows which input it read. Rules out bolting this onto `cleanup`, which would keep
  the backlog wrong for the whole life of the branch — precisely the window in which the operator
  reads it to decide what to do next.
- Deletion is committed with the produced artifact. Rules out an uncommitted `rm` that `git add -A`
  absorbs into an unrelated commit, and rules out a run that produces intents but strands the seed.
- Fix both hops and both surfaces in one change — they are the same defect, and fixing one hop leaves
  the backlog just as untrustworthy.

## Out of scope

- The `commit: false` external-specs path in `cleanup.ts`, which already works.
- Retroactive pruning of the existing backlog — done by hand, PR #1565.

## Documentation updates

- `v1/docs/spec-guidance.md` — state that promotion consumes its input, so `seeds/` and
  `ready-intents/` are always open work.
- `v1/docs/plan-mode.md` — the seed/ready-intent lifecycle.
