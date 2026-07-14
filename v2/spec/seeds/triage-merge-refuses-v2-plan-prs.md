# `triage --merge` refuses every v2 plan PR

`jarvis1 triage <pr> --merge` is the prescribed merge path — it is the only one that runs the local
ready gate (including `lint:md`, which PR CI does not run) before waiting on CI. It refuses every
plan PR produced by a v2 workflow, so the operator hand-merges and the `lint:md` gap reopens on
exactly the PRs most likely to carry markdown.

## Problem

Observed 2026-07-14 on `main` at `0e7dee14`:

```sh
$ jarvis1 triage 1567 --merge
triage --merge (plan PR): no spec found for branch plan/workflow-routing-read-failure-surfaces-named-error
```

The spec exists — it is *in the PR*, at
`v2/spec/20260714T143711Z-workflow-routing-read-failure-surfaces-named-error/`. Two things combine:

- A plan PR's spec is not yet on `main`, so the primary-checkout scan cannot find it. The documented
  fallback is to scan "the worktree's own target directories" for `plan/*` branches
  (`v1/docs/operator-runbook.md` § Merging).
- That fallback only looks in `<repo>/.worktree/`. A v2 plan worktree lives at
  `~/.jarvis/worktrees/<project>/plan/<name>/`, so there is nothing to scan and resolution fails.

`triage-merge-resolves-v2-worktrees` (shipped) taught `--merge` the v2 worktree home for
**implementation** specs — `resolve-merge-target.ts:47` pushes `~/.jarvis/worktrees/<project>`. The
plan-PR spec-resolution path did not get the same treatment, so v2 plan PRs still fall through.

Every v2 plan PR this session (#1567, #1568) had to be hand-merged with `gh pr merge --admin`, with
`bun run lint:md` run by hand first.

## Scope

- `--merge` resolves a `plan/*` branch's spec from the **v2 worktree home** as well as
  `<repo>/.worktree/`, reusing the two-home search `resolve-merge-target.ts` already performs.
- Applies to plan PRs specifically — the class the refusal message already names.

## Decisions

- Reuse the existing two-home resolution rather than adding a v2-specific branch. Rules out a second
  code path that can drift from the implementation-spec resolver the way this one did.
- A plan PR with unchecked subspec acceptance criteria still merges (existing documented behavior);
  this only fixes *finding* the spec. Rules out tightening plan-PR completeness as a side effect.

## Out of scope

- `--mark-ready`, drill-down, and listing, which remain v1-home-only (`triage-lists-v2-worktrees`).
- Non-spec branches (seed/report/doc PRs) — that is `triage-merge-only-handles-spec-branches`.

## Documentation updates

- `v1/docs/operator-runbook.md` § Merging — state that `plan/*` resolution searches both worktree
  homes, and drop the hand-merge workaround.
- `v2/docs/operator-runbook.md` — remove the "hand-merge plan PRs" guidance once this ships.
