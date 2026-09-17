---
name: redispatch-continues-committed-lane
---

# Incomplete re-dispatch continues a lane with committed subspec work

Issue #3974 asks 2–3 (ask 1 is covered by spec `20260917T031307Z-resume-failed-link-row-through-workflow` subspec 01). Surface: the stale-workspace preflight (`maybeResetStaleWorkspace` in `v2/src/commands/stale-reset-workspace.ts`, gate `staleResetUnlandedCommitsGateReason` in `v2/src/commands/cleanup.ts`), shared by CLI and daemon pipeline dispatch.

## Prerequisites

## Decisions

- An incomplete re-dispatch whose worktree has no live owner, a clean tree, `HEAD` descended from the resolved base, and commits ahead of base continues on that worktree from the first subspec with unchecked non-human-only criteria; no reset, no retirement.
- Continuation keeps branch, commits, ticked criteria, and any open draft PR; routing uses the fresh-dispatch unticked-criteria rule.
- Continuation refuses dirty trees, non-descendant `HEAD`, live owners, or ticked criteria absent from the branch's own commits; each refusal names its fix.
- In-repo and external (`specs: external`) plan trees behave alike.

## Acceptance criteria

- [ ] A workflow command test drives a lane with two committed, ticked subspecs, one unchecked subspec, a clean tree and no live owner, and asserts re-dispatch continues on the same worktree and branch at the unchecked subspec with no retirement; it fails against the current unlanded-commits refusal.
- [ ] A test asserts continuation refuses a dirty tree and a non-descendant `HEAD`, each naming its fix.
- [ ] A test covers the same continuation for an external plan tree.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — continuation.
- `v2/docs/workflow-runner.md` — re-dispatch continuation.
- `v2/docs/v1-behaviors.md` — changed re-dispatch behavior.
