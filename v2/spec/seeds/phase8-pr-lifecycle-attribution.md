# Phase 8 — PR lifecycle + attribution on the v2 runner

v2 build-order Phase 8 (`v2/docs/v2-build-order.md` §"Phase 8"): port v1's PR
mechanics onto the v2 runner — worktree → branch → draft PR → ready, with the
per-commit `Jarvis-Agent` attribution footer. This is the output side of a v2
run.

## Problem

Today the v2 runner stops at worktree creation. A completed v2 run writes files
into an external worktree (`~/.jarvis/worktrees/<project>/<branch>/`) and updates
the SQLite state store, but does **no** git commit, no push, no draft PR, no
attribution, and no draft→ready flip. `commitCompletionBoundary`
(`v2/src/persistence/state-store.ts`, called from
`v2/src/execution/write-loop.ts`) is a SQLite checkpoint only — despite its name
it performs no git commit. There is no `Jarvis-Agent` trailer, no `gh` mediation,
and no PR helper anywhere in `v2/src` or `shared/`.

v1 already has all of this; `v2/docs/v1-behaviors.md` catalogs the target
behaviors for parity (§"Branches and commits", §"PR and GitHub CLI mediation",
§"Attribution and PR footer behavior"). Phase 8 ports those onto the v2 runner,
respecting the v2 external-worktree layout (not v1's in-repo `.worktree/`).

## Direction

Port, don't reinvent. Mirror v1's shapes and reuse `shared/` primitives where
they already exist (`shared/git.ts`, `shared/subprocess.ts`'s injectable
`SubprocessRunner`). Attach the git/PR side effects in the write-loop/runner
boundary layer around `commitCompletionBoundary` — **outside** the SQLite
transaction and **outside** the orchestration store API. Keep the core execution
function host-agnostic; `gh`/`git` side effects live in the runner layer, driven
by injectable subprocess runners so they stay testable (real-process tests go in
`*.sandbox-unrunnable.test.ts`).

This is one coherent capability with three dependency-ordered, independently
testable behaviors — each ≈ one PR:

1. **Harness commit at the completion boundary.** When a run reaches a terminal
   boundary with a dirty worktree, the harness stages and commits the worktree
   changes with a commit message carrying a `Jarvis-Agent: <label>` trailer
   (port `v1/src/commit-trailer.ts appendAgentTrailer`; label from the binding's
   agent). A clean worktree is a no-op (port the sense of v1's
   `worktreeCompletionBlocker` clean-tree gate). This behavior is the source of
   the `commit_sha` that telemetry slice F3 later stamps.
2. **Publish branch + open draft PR.** A completed run pushes the branch
   (first push `-u`, later plain; transient-retry) and opens or refreshes an
   **idempotent** draft PR scoped to the current branch's open PR only (port
   `pushCurrent`, `ensureDraftPr`/`checkPrExists`/`createDraftPr`, and the
   minimal `gh` mediation from `v1/src/gh.ts` — `assertGhReady`, transient
   retry). Base branch resolution reuses v2's existing `baseRef`.
3. **Attribution footer + draft→ready flip.** The draft PR body carries the
   attribution footer rendered from `Jarvis-Agent` trailers on the branch's
   commits (port `readBranchCommits`/`renderAttribution`/
   `renderAttributionSummary`), and a completed run runs the ready gate and flips
   the PR draft→ready (`gh pr ready`, with the "already ready"/"not a draft"
   success guard). Narrative-marker preservation may be minimal for v2's seed.

## Decisions

- Side effects attach in the runner/write-loop boundary layer, not in
  `state-store.ts` and not inside the `commitCompletionBoundary` DB transaction.
- Reuse `shared/git.ts` (`branchExistsLocal`, `branchExistsOnOrigin`,
  `getCurrentBranch`, `isWorktreeDirty`) and `shared/subprocess.ts` runners;
  port net-new git/gh helpers into `shared/` when both a v2 caller and testability
  argue for it, else keep them in `v2/src`.
- v2 external-worktree layout is authoritative; do not carry v1's in-repo
  `.worktree/`, `info/exclude` lock-exclusion, or symlink-promotion assumptions.
- Commit message shape mirrors v1 enough that attribution rendering works
  (a `Spec:`-style first body line is what v1's renderer filters on; the v2
  equivalent should let `renderAttribution` pick commits up).
- Behaviors are sequenced: behavior 2 depends on behavior 1 committed on `main`;
  behavior 3 depends on behavior 2. Plan/run them in order.

## Out of scope

- The natural-language prompt router (Phase 9).
- TUI "PR status per run" surface (build-order flags it as a Phase 8 TUI note but
  it can trail; author separately if desired).
- F3 `work_boundary_recorded` telemetry — separate seed, gated on behavior 1.

## Documentation updates

- `v2/docs/v1-behaviors.md`: note which v1 PR behaviors are now ported to v2 (or
  cross-reference a new v2 PR-lifecycle doc).
- Add/extend a v2 doc (e.g. `v2/docs/write-behavior.md` or a new
  `v2/docs/pr-lifecycle.md`) describing the v2 run's output side: commit →
  push → draft PR → attribution → ready, and the external-worktree layout.
