---
name: triage-sees-and-merges-everything
---

# `triage` sees only half the worktrees and merges only some of the PRs

`jarvis1 triage` is the gated merge path — the only one that runs the local ready gate (including
the `lint:md` PR CI omits) before waiting on CI green. It refuses v2 plan PRs and every spec-less
PR, and it cannot list or drill into v2 worktrees at all. So the operator hand-merges with
`gh pr merge --admin --squash`, bypassing the gate the command exists to enforce, on exactly the
PRs most likely to carry markdown.

Consolidates seeds `triage-merge-refuses-v2-plan-prs` and `triage-merge-only-handles-spec-branches`
plus ready-intent `triage-lists-v2-worktrees`. One defect: triage's view of the world is narrower
than the operator's.

## Problem

**v2 plan PRs are refused.** Observed 2026-07-14 on `main` at `0e7dee14`:

```sh
$ jarvis1 triage 1567 --merge
triage --merge (plan PR): no spec found for branch plan/workflow-routing-read-failure-surfaces-named-error
```

The spec exists — it is *in the PR*. A plan PR's spec is not yet on `main`, so the
primary-checkout scan cannot find it; the documented fallback scans "the worktree's own target
directories", but only under `<repo>/.worktree/`. A v2 plan worktree lives at
`~/.jarvis/worktrees/<project>/plan/<name>/`, so there is nothing to scan.
`triage-merge-resolves-v2-worktrees` (shipped) taught `--merge` the v2 home for **implementation**
specs (`resolve-merge-target.ts:47`); the plan-PR path did not get the same treatment. Every v2
plan PR that session (#1567, #1568) was hand-merged.

**Spec-less PRs are refused.** Observed 2026-07-12:

```sh
$ jarvis1 triage 1452 --merge
triage --merge (implementation PR): no spec found for branch seeds/operator-notifications
```

Operators routinely open PRs that are not spec-backed — seed PRs, session reports under
`reports/`, runbook and doc edits, prioritization updates. All are refused. The gap bites hardest
where it matters: **`lint:md` globs `v1/spec/**`, `v1/docs/**`, and `reports/**`** — the very trees
these PRs touch — and PR CI does not run `lint:md`. A green-CI markdown PR merges dirty and reddens
every subsequent run's completion gate, and the one command that would have caught it is the one
that refuses to look.

**v2 worktrees are invisible.** No-arg `jarvis1 triage` enumerates only `<repo>/.worktree/`, and
`triage <name>` drill-down resolves the same single home. v2 work does not appear in the one
command meant to show what is in flight.

## Scope

- `--merge` resolves a `plan/*` branch's spec from the v2 worktree home as well as
  `<repo>/.worktree/`, reusing the two-home search `resolve-merge-target.ts` already performs.
- `--merge` accepts a PR with no spec, runs the same local gate + CI-green check, and merges. "No
  spec" is a valid shape, not an error.
- No-arg `triage` lists worktrees from both homes, each row naming its home; `triage <name>`
  drill-down resolves either home and refuses on ambiguity rather than picking. Per-row
  classification (dirty, ahead/behind, PR state, spec progress, landed/draft) works the same for
  v2-home rows.

## Decisions

- Reuse the existing two-home resolution rather than adding a v2-specific branch. Rules out a
  second code path that can drift from the implementation-spec resolver the way this one did.
- Do not add a second merge command for non-spec PRs. One gated merge path, per the north star; a
  `jarvis1 merge` alongside `triage --merge` would be two commands for one operator intent.
- A doc/seed PR is not "less risky" than a spec PR and does not deserve a weaker gate — it is the
  *only* kind that can poison the shared ready gate via `lint:md`.
- Resolution keys off the PR/branch, not the existence of a spec — the gate it runs (`bun run
  ready`, CI green) does not depend on one.
- A plan PR with unchecked subspec acceptance criteria still merges (existing documented
  behavior); this only fixes *finding* the spec. Rules out tightening plan-PR completeness as a
  side effect.
- Keep spec-backed behavior otherwise unchanged (completeness checks, active-spec marker).

## Prerequisites

- None.

## Out of scope

- `jarvis1 cleanup` v2 support (`v2-reclaims-its-workspace`).
- Branch-protection / admin-merge policy.
- The `lint:md`-not-in-CI gap itself (`ci-cannot-protect-the-local-ready-gate`).

## Documentation updates

- `v1/docs/operator-runbook.md` § Merging — `plan/*` and spec-less resolution search both worktree
  homes; drop the hand-merge workaround and the manual-fallback carve-out for seed/report/doc PRs.
  Triage listing now covers v2 worktrees.
- `v2/docs/operator-runbook.md` — remove the "hand-merge plan PRs" gotcha.
- `v2/docs/v1-behaviors.md` — record widened merge/listing/drill-down resolution.
