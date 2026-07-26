---
name: implement-review-bounds-diff-payload
---

# Implement review bounds diff payload with production-first ordering

**Moved from `ready-intents/` 2026-07-26.** It has no acceptance criteria, so it is a seed, not a
ready intent. Budget hygiene, deferred — see issue #2181.

Large implement branches can exceed review context. When unified diff output exceeds
a budget, include production-source hunks before test, fixture, and lockfile hunks and
state explicitly what was omitted.

## Decisions

- Budget caps unified-diff hunks only; stat/path orientation block is always included; rules out trimming orientation metadata.
- Trim at whole-file boundaries: include or omit entire per-file `diff --git` sections; never splice partial hunks within a file when the budget is exhausted; rules out intra-file truncation that would omit paths from the trim notice.
- Ordering is per-file tier priority within that whole-file trim: production paths first, then test, fixture, and lockfile paths; rules out blind head/tail truncation of the diff string.
- Path tiers (repo-relative, first match wins): **lockfile** — basename is a conventional lockfile (`package-lock.json`, `bun.lock`, `bun.lockb`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`); **fixture** — any path segment is `fixtures` or `fixture`, or basename ends with `-fixtures.ts`; **test** — basename matches `*.{test,spec,sandbox-unrunnable.test}.*` or any path segment is `test` or `tests`; **production** — all other changed paths; rules out per-implementer incompatible classifiers.
- Trimmed payloads prepend an explicit notice listing omitted repo-relative paths; rules out silent partial diffs the reviewer may treat as complete.
- Deferred to first consumer: exact character/byte budget — pin when plan drafts subspecs.

## Documentation updates

- `v2/docs/workflow-runner.md` — review diff budget, production-first ordering, and trim notice semantics.
- `v2/docs/v1-behaviors.md` — record trim notice semantics and bounded review diff input.

## Prerequisites

- Implement review `BRANCH_DIFF` includes merge-base unified diff content (not stat/name-only).
- Do not plan or run in parallel with `implement-review-supplies-unified-diff` — same `branchDiff` seam; merge supplies first (merge-first sibling rule).
