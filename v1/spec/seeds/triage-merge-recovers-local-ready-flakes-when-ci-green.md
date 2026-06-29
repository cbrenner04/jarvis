# triage merge recovers local ready flakes when ci green

## Problem

`jarvis1 triage <worktree> --merge` reruns the full local ready gate before
merging. When that local gate fails on known timing/load flakes unrelated to the
PR, but GitHub CI is green for the same head SHA, the operator must choose
between repeated local reruns or a manual admin merge.

Observed on PR #821: CI passed after the fixture-specific fix, while local
`triage --merge` failed on unrelated timing-sensitive tests
(`run.sandbox-unrunnable.test.ts`, `triage-command.test.ts`).

## Desired behavior

Jarvis should distinguish local ready flakes from PR-specific failures when the
current head already has green CI, and provide a safe operator path that avoids
manual `gh pr merge --admin`.

## Decisions

- Prefer improving `triage --merge` over adding a command.
- Only allow bypassing/recovering local ready when the PR head SHA has green CI
  and the local failures match known flake classes or pass in targeted reruns.
- Keep deterministic local failures blocking.

## Documentation updates

- Update `v1/docs/operator-runbook.md` flaky parallel-load recovery guidance once
  `triage --merge` can safely rely on green CI for known local flakes.
