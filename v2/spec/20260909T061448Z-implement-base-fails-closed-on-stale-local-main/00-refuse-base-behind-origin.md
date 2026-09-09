# 00 - Refuse admission when the base branch is behind its upstream

## Problem

`buildImplementWorkflowSteps` (`v2/src/execution/implement-workflow-steps.ts`) preflights `--base` only for spec availability (`isSpecAvailableInBaseRef`, a `git cat-file -e <baseRef>:<specPath>`), then `materializeExternalWorktree` runs `git branch <lane> <baseRef>` against the local ref. Nothing compares that ref to its upstream. With `--base main` after a `gh pr merge`, the lane branches from a stale local `main` and the agent re-implements the merged lane (24 files / 1,687 insertions on homestead-service, 2026-09-02) with no warning at admission.

## Decisions

- Implement preflight gains a base-freshness check: when `baseRef` names a local branch with a configured upstream, the CLI runs `git fetch <remote> <upstream-branch>` and refuses admission when the local branch is strictly behind the fetched upstream (`git merge-base --is-ancestor <local> <upstream>` true and the SHAs differ); the error is `base_behind_origin: <baseRef> is at <localSha>, <upstream> is at <upstreamSha>; run git pull or pass --base <upstream>`; rules out silently materializing a stale base.
- A `baseRef` with no upstream (a detached SHA, `origin/main`, a local-only branch) and an up-to-date or ahead local branch admit unchanged; `--base origin/main` remains the documented escape hatch; rules out forcing a checkout pull as a hidden prerequisite.
- A failed fetch (offline, no such remote branch) does not refuse: preflight falls through to today's behavior with a stderr note; rules out making implement unusable offline.
- The check runs in the CLI preflight before daemon contact, alongside the existing spec-availability check, and is bypassed where that check is bypassed (external plan specs use the same `preflightBaseRef`); rules out discovering the stale base after the run has spent its budget.

## Acceptance criteria

- [x] `implement-workflow-steps.test.ts` test `--base main refuses base_behind_origin when local main is strictly behind its upstream` builds a project repo with an `origin` remote one commit ahead of local `main` and asserts `buildImplementWorkflowSteps` returns an error naming `base_behind_origin`, both SHAs, and the `--base origin/main` escape; it fails against the current silent admission.
- [x] A test proves `--base origin/main` on the same repo admits, and that an up-to-date local `main` admits.
- [x] A test proves a base branch with no upstream admits without fetching (the subprocess runner sees no `fetch`).
- [x] A test proves a failed fetch falls through to admission with a note rather than a refusal.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `--base main` names the checkout's local branch; `gh pr merge` does not advance it; the `base_behind_origin` refusal and the `--base origin/main` escape hatch. Replace the defensive fetch/ff ritual with the refusal.
- `v2/docs/workflow-runner.md` — implement admission preflight: the base-freshness check next to spec availability.
