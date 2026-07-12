# `triage --merge` refuses seed, report, and doc PRs

`jarvis1 triage <pr> --merge` is the gated merge path — it runs the local ready gate
(including the `lint:md` that PR CI omits), waits for CI green, then merges. It only
works for branches it can resolve a *spec* for. Every other PR an operator opens
falls back to raw `gh`, bypassing the gate the command exists to enforce.

## Problem

Observed 2026-07-12:

```sh
$ jarvis1 triage 1452 --merge
triage --merge (implementation PR): no spec found for branch seeds/operator-notifications
```

The PR was a seed-only branch. Operators routinely open PRs that are not
spec-backed:

- seed PRs (`seeds/*`)
- session reports under `reports/`
- operator-runbook and doc edits
- prioritization / scratch updates

All of them are refused, so the operator hand-merges with
`gh pr ready && gh pr merge --admin --squash` — which skips both the local ready
gate and CI verification. That is exactly the path the runbook calls "last-resort",
and it is currently the *only* path for a whole class of routine PR.

The gap bites hardest precisely where it matters: **`lint:md` globs
`v1/spec/**`, `v1/docs/**`, and `reports/**`** — the very trees these refused PRs
touch. PR CI does not run `lint:md`. So a green-CI markdown PR can merge dirty and
redden every subsequent run's completion gate, and the one command that would have
caught it is the one that refuses to look.

## Scope

- `triage --merge` should accept a PR that has no spec, run the same local gate +
  CI-green check, and merge. "No spec" is a valid shape, not an error.
- Keep the spec-backed behavior unchanged (completeness checks, active-spec marker,
  plan-PR allowances).
- Resolution should key off the PR/branch, not require a spec to exist — the gate it
  runs (`bun run ready`, CI green) does not depend on a spec.

## Decisions

- Do not add a second merge command for non-spec PRs. One gated merge path, per the
  north star; a `jarvis1 merge` alongside `triage --merge` would be two commands for
  one operator intent.
- A doc/seed PR is not "less risky" than a spec PR and does not deserve a weaker
  gate — it is the *only* kind that can poison the shared ready gate via `lint:md`.

## Out of scope

- Branch-protection / admin-merge policy.
- The `lint:md`-not-in-CI gap itself (separate: PR CI's scoping deliberately skips
  doc-only diffs).

## Documentation updates

- `v1/docs/operator-runbook.md` — the [Merging](../../v1/docs/operator-runbook.md#merging)
  section tells operators to prefer `triage --merge` and to hand-run `bun run lint:md`
  before any manual admin-merge of markdown. Once triage accepts these PRs, the
  manual-fallback carve-out for seed/report/doc PRs goes away.
