# 00 - Relocate v1-work completed specs to v1/spec/completed

One-time backlog reconciliation. `v2/spec/completed/` accumulated five completed specs under the
old layout. Classify each by what its merged implementation changed (any change under `v1/**` → v1)
and move the v1-work ones to `v1/spec/completed/`, leaving `v2/spec/completed/` holding only genuine
v2 planning.

## Decisions

- Classification rule = **any change under `v1/**` → v1**, else stays in `v2/spec/completed/`. Rules out classifying by topic/title (dir names start `v2-` yet some changed v1 code) and rules out misreading "mixed → v1" as flipping a shared-only spec (coding-standards touched root `prompts/` + `shared/` but nothing under `v1/**`, so it stays).
- Pure move: relocate directories with content byte-identical; no edits to subspec/index/intent files. Rules out "fixing up" the moved specs, which would corrupt the historical record.
- Internal `v2/spec/...` cross-references *inside the moved trees* (e.g. `v2-meta-index.md`, `intent.md`) are intentionally retained as frozen historical records, not live links. The intent's "only genuine v2 planning remains" governs the tree's location, not its frozen contents. Rules out a future reviewer reading these stale internal links as a missed cleanup.
- Verdicts (recorded so a reviewer can re-check the merged diffs):
  - `2026-05-25T23-55-09Z-v2-meta-intent-loop-rca` → **v1** (changed `prompts/plan/*`, `v1/test/modes/plan/prompts.test.ts`, `v1/docs/spec-guidance.md`).
  - `2026-05-29T12-56-13Z-first-write-behavior` → **v1** (mixed: extracted v1 prompt/invocation into root-shared and refactored `v1/src/worktree.ts` onto `shared/worktree-lock.ts`).
  - `2026-05-23T23-17-59Z-v2-engine-scaffold` → **stays** (v2/src + v2/docs + new shared scaffold; only references v1 entrypoint shape, changes nothing in v1).
  - `2026-06-09T13-47-28Z-v2-coding-standards` → **stays** (shared + v2/src + v2/docs + new v2 prompt; Biome gate explicitly excludes `v1/**`).
  - `2026-06-12T00-24-39Z-phase-2-write-loop` → **stays** (v2/src + v2/docs only).
- No reference fix-ups: nothing outside the moved trees links these dir paths (`v2-meta-index.md` tracks phases, not spec dirs; runbook already states by-home archival). Rules out a speculative grep-and-rewrite pass.
- Docs not required: this relocates archived artifacts, changes no v1 functionality; the operator runbook already reflects by-home archival. No `v1-behaviors.md` entry.

## Task checklist

- Move `2026-05-25T23-55-09Z-v2-meta-intent-loop-rca/` and `2026-05-29T12-56-13Z-first-write-behavior/` from `v2/spec/completed/` to `v1/spec/completed/`, content unchanged.
- Confirm the three v2 specs remain under `v2/spec/completed/`.
- Grep the repo for stale references to the two old paths.

## Acceptance criteria

- [x] `v1/spec/completed/2026-05-25T23-55-09Z-v2-meta-intent-loop-rca/` and `v1/spec/completed/2026-05-29T12-56-13Z-first-write-behavior/` exist, and `git log --follow` (or the rename-detection in `git show`/`git diff` for the move commit) records each file as a content-preserving rename with zero content delta.
- [x] Neither `2026-05-25T23-55-09Z-v2-meta-intent-loop-rca/` nor `2026-05-29T12-56-13Z-first-write-behavior/` remains under `v2/spec/completed/`.
- [x] `v2/spec/completed/` still contains `2026-05-23T23-17-59Z-v2-engine-scaffold/`, `2026-06-09T13-47-28Z-v2-coding-standards/`, and `2026-06-12T00-24-39Z-phase-2-write-loop/`, unchanged.
- [x] No file in the repo references `v2/spec/completed/2026-05-25T23-55-09Z-v2-meta-intent-loop-rca` or `v2/spec/completed/2026-05-29T12-56-13Z-first-write-behavior`.

## Documentation updates

- None. Purely a backlog relocation of archived specs; the operator runbook already documents by-home archival and no durable doc references the moved paths.
