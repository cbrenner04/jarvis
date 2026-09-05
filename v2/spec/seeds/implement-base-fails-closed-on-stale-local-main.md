---
name: implement-base-fails-closed-on-stale-local-main
---

# `--base main` fails closed when the local branch is behind its upstream

## Problem

`implement --base main` materializes from the operator checkout's local `main` without fetching or comparing against `origin/main`. Merging PRs via `gh pr merge` (the normal landing path) does not advance the local branch, so the next implement silently starts from a stale base and the agent re-implements the previous lane — 24 files / 1,687 insertions of duplicate work and a file-for-file conflicted PR, with no warning at admission and nothing in the run row. Evidence: #3381 (homestead-service, 2026-09-02). The daemon already runs `git ls-remote` against origin at exactly this point, so network and remote name are in hand.

## Decisions

- At admission, when `--base` names a local branch with an upstream, compare against the fetched upstream and fail closed (`base_behind_origin`, naming both SHAs) when the local branch is strictly behind; rules out silently materializing a stale base.
- `--base origin/main` stays the explicit escape hatch and an explicit fast-forward of the materialization ref is an acceptable alternative to refusal; rules out forcing the operator to pull the checkout as a hidden prerequisite.
- Detection at admission, not mid-run; rules out discovering the stale base after the re-implementation is committed.

## Acceptance criteria

- [ ] An admission test proves `--base main` with local `main` strictly behind its upstream refuses `base_behind_origin` naming both SHAs (or fast-forwards the materialization ref); fails against the current silent stale materialization.
- [ ] `--base origin/main` and an up-to-date local base admit unchanged, pinned by tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `--base main` resolves the local branch; the fail-closed contract and the escape hatch.
