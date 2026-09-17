---
name: implement-continues-committed-lane
---

# Re-dispatching implement continues a lane with committed subspec work instead of refusing or resetting

## Problem

Issue #3974. A multi-subspec implement lane whose driver stopped mid-chain (paused then resumed, gate refusal, quota, stranded link) has committed subspec work on its branch and unchecked subspecs remaining. The only relaunch path, `jarvis run workflow implement` on the same spec, goes through `maybeResetStaleWorkspace` (`v2/src/commands/stale-reset-workspace.ts`, called from `v2/src/commands/workflow.ts:343`), whose unlanded-commits gate (`staleResetUnlandedCommitsGateReason`, `v2/src/commands/cleanup.ts:2325`, used at `:2495`) refuses because the branch is ahead of base, and it has no override. That is correct for a reset but wrong for this case: "continue this lane" is conflated with "reset a stale workspace". The refusal then offers only hand-finish or `cleanup --abandon`, both of which waste committed, correct work.

Ask 1 of #3974 (resume re-drives the linked chain) is covered by spec `20260917T031307Z-resume-failed-link-row-through-workflow` subspec 01; this seed covers asks 2 and 3.

## Evidence

Issue #3974 (playwright-agent, external plan tree, 6 subspecs): link-2 paused `missing_blocker`, `run resume` settled it `completed`, no link-3 was created, and re-dispatch refused with `branch has N commit(s) not on base`. Four correct subspec commits were stranded. The same shape was hand-worked around on jarvis lanes on 2026-09-16 (#3953, #3957).

## Decisions

- An incomplete re-dispatch whose materialized worktree has no live owner, a clean tree, a `HEAD` descended from the resolved base, and commits ahead of base continues on that worktree from the first subspec with unchecked non-human-only criteria. It is not reset. Rules out a reset as the only entry point.
- Continuation keeps the branch, commits, ticked criteria, and any open draft PR; routing is the same unticked-criteria rule fresh dispatch uses.
- Reset stays available only by explicit request (a flag), and still passes every existing gate. Rules out silently discarding committed work.
- Continuation still refuses on dirty trees, non-descendant `HEAD`, live owners, or ticked criteria absent from the branch's own commits; each refusal names the fix.
- The unlanded-commits refusal (when continuation does not apply, e.g. an explicit reset request) names the continue path first, before hand-finish and `--abandon`.
- Works for in-repo and external (`specs: external`) plan trees alike.

## Acceptance criteria

- [ ] A workflow command test drives a lane with two committed, ticked subspecs, one unchecked subspec, a clean tree and no live owner, and asserts re-dispatch continues on the same worktree and branch at the unchecked subspec with no retirement; it fails against the current unlanded-commits refusal.
- [ ] A test asserts the explicit reset flag still refuses on unlanded commits, and that the refusal text names the continue path.
- [ ] A test asserts continuation refuses a dirty tree and a non-descendant `HEAD`, each naming its fix.
- [ ] A test covers the same continuation for an external plan tree.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — continue vs reset.
- `v2/docs/workflow-runner.md` — re-dispatch continuation.
- `v2/docs/v1-behaviors.md` — changed re-dispatch behavior.
