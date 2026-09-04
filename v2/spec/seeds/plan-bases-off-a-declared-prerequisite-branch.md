---
name: plan-bases-off-a-declared-prerequisite-branch
---

# `plan` cannot base off an in-flight prerequisite, so a ready-intent chain is strictly serial

## Problem

`jarvis run workflow plan` resolves its own repository base (the default branch) and has no `--base` flag. When a queued ready-intent declares a prerequisite that is still in flight on another branch, the plan agent correctly reads the repo, finds the prerequisite absent, appends a `## Blocker`, and stops.

The refusal is right — the code genuinely is not there — but it is unconditional, so a chain of N ready-intents costs N serial plan+implement round trips even when every link's interface is fully specified in its own `## Prerequisites` section. Nothing can be planned while its predecessor implements. For the notifications chain (ledger store → daemon RPC → CLI wait/list → `--project` filter) that is four sequential round trips to deliver one operator-visible flag.

`implement` already takes `--base` and already chains: a pipeline's implement stage bases off the prior stage's branch. Plan has no equivalent, so the one stage that could absorb a predecessor's in-flight work is the one that cannot see it.

## Evidence

Observed 2026-09-03, run `0375b6cc-05df-4a1f-8ffc-046e94c5d45f`, ready-intent `daemon-notification-wait-and-list`. Dispatched deliberately while its prerequisite (subspec 01 of `20260903T181000Z-notification-ledger-persists-delivered-incidents`) was mid-implement on its own branch. Settled `blocked` in ~4 minutes with an accurate blocker:

> `StateStore` has no `listDeliveredNotificationIncidents` (or equivalent) ordered delivered-incident query with `sinceCursor` / `sinceMs` and optional `kinds`; … subspec 01 acceptance criteria remain unchecked and no matching API or tests exist in `v2/src/persistence/state-store.ts`.

The prerequisite branch existed and carried exactly that API in progress. Basing the plan on it would have satisfied the check.

Prior occurrence recorded 2026-07-30 and documented in `v2/docs/operator-runbook.md` § Concurrency as accepted cost ("a dependent plan run costs one dispatch to learn its prerequisite is unmerged"). This seed proposes retiring that cost rather than continuing to pay it.

## Decisions

- `plan` accepts `--base <ref>` with the same resolution and validation semantics `implement --base` already uses; omitted, it resolves the repository base exactly as today. Rules out a plan-only base concept or a new resolution path.
- The plan worktree materializes from the resolved base, so a prerequisite branch's in-flight code is present to the plan agent and its prerequisite check passes on its own merits. Rules out suppressing or weakening the prerequisite check itself — a plan whose prerequisite is absent from the resolved base must still block.
- The drafted spec tree is authored on the plan branch as today; the base only changes what the agent can read. Rules out the plan PR retargeting or stacking onto the prerequisite branch.
- The existing stale-workspace preflight gates (descendant check, landed criteria, dirty reuse) evaluate against the resolved base, not the repository default. Rules out a base override that silently bypasses the descendant gate.

## Acceptance criteria

- [ ] A new plan-command test `plan resolves the repository base when --base is omitted` asserts today's default resolution is unchanged; it passes before and after the fix and pins the default.
- [ ] A new plan-command test `plan materializes its worktree from an explicit --base ref` dispatches plan with `--base <branch>` and asserts the plan worktree `HEAD` is that ref's head rather than the repository base; it fails against the pre-fix absent flag.
- [ ] A new plan-command test `plan --base rejects an unresolvable ref before daemon contact` asserts an unknown ref exits non-zero naming the ref, with no run row or worktree created; it fails against the pre-fix absent flag.
- [ ] A new plan preflight test `plan --base evaluates the descendant gate against the resolved base` asserts an incomplete re-run whose worktree `HEAD` is not descended from the explicit base is refused naming that base; it fails against a base override that skips the gate.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Workflow presets: `plan --base`; and § Concurrency: replace the "a dependent plan run costs one dispatch" note with the chained-base practice for a declared-prerequisite chain.
- `v2/docs/workflow-runner.md` — plan preset contract: base resolution and its effect on the prerequisite read.
- `v2/docs/write-behavior.md` — CLI surface: the new flag.
