# Preserve named no-commit spec on later-phase failure

## Problem

`jarvis1 plan` with `commit: false` writes the operator-owned spec directory
(including `intent.md`) under `~/.jarvis/specs/<project>/<spec-dir>/` before
running draft/review. That directory must survive every later-phase failure so
the operator keeps the artifact whose path was already printed as
`Intent: …/intent.md`.

## Reconciliation with committed code (read before implementing)

The intent's premise — a `tmp-*` staging dir renamed to the final name, then
deleted by no-commit cleanup on later-phase failure — describes a superseded
design. Confirm against current `v1/src/commands/plan.ts`:

- No `tmp-*` staging or rename in the no-commit path. `specDirBasename` is
  computed from the ready-intent `name:` up front (`plan.ts:744`) and the dir is
  created directly under the final name (`plan.ts:810`). `_TEMP_PLAN_PREFIX`
  (`plan.ts:81`) is dead code.
- The only external-dir removal helper, `cleanupNoCommitTempSpec`
  (`plan.ts:794-801`), recomputes `<externalSpecRoot>/<specDirBasename>` and
  `rmSync`s it. Its sole call site is the pre-phase `intent.md` write-failure
  `catch` (`plan.ts:814`), which fires before the `Intent:` line is printed.
- Draft, validation, boundary, draft-error catch, interrupt, quota,
  model-config, and review failures already `return` without calling cleanup, so
  the finalized dir is left on disk today — but only incidentally, and the
  helper still targets the finalized name, so it is a latent footgun.

So the implementable deltas are narrow: make preservation explicit and tested,
scope the write-failure cleanup so it can only remove an abandoned pre-`intent.md`
dir (never a finalized, operator-visible one), and add a failure-output
breadcrumb naming the preserved dir. Do not reintroduce `tmp-*` machinery.

## Decisions

- Treat a no-commit external spec dir as operator-owned once `intent.md` is
  written and its path is printed; never delete it on phase failure (rules out
  deleting it as failed-run temp state).
- Keep automatic no-commit cleanup limited to the abandoned-on-write case: only
  remove the external dir from the `intent.md` write-failure path, before the
  `Intent:` breadcrumb is emitted (rules out removing finalized dirs on draft /
  review / validation / boundary / quota / model-config / interrupt / generic
  failure).
- On any later-phase failure (cleanup skipped), print the preserved external
  spec dir path to the operator (rules out relying only on the earlier `Intent:`
  stdout breadcrumb).
- Leave committed (`commit: true`) plan cleanup unchanged — `commit: false` only
  (rules out broadening teardown to in-repo plan worktrees/branches/specs).
- Scope: one preservation behavior in `plan.ts` plus paired tests and docs; keep
  it one reviewable change rather than splitting the breadcrumb from the
  preservation guarantee, since they share the same failure-path code and tests.

## Tasks

- Audit every `commit: false` failure return in `planCommand`
  (`v1/src/commands/plan.ts`) and confirm none removes the finalized external
  spec dir; constrain `cleanupNoCommitTempSpec` so it cannot delete a dir whose
  path was already emitted as `Intent:` (e.g. only invoke it from the write
  `catch`, before the breadcrumb).
- Emit a failure-output line reporting the preserved external spec dir path on
  each later-phase `commit: false` failure where cleanup is skipped; model the
  wording on the existing no-commit handoff (`plan.ts:1192-1197`).
- Keep the `intent.md` write-failure path removing the abandoned external dir.
- Add regression tests in `v1/test/plan-no-commit-intent-output.test.ts` (or a
  sibling) covering the acceptance criteria below.
- Apply the documentation updates below.

## Acceptance criteria

- [ ] After a `commit: false` plan run fails in the draft phase (after
      `intent.md` is written), the external spec directory and its `intent.md`
      remain on disk.
- [ ] After a `commit: false` plan run fails in a later review (or other
      post-draft) phase, the named external spec directory remains on disk.
- [ ] When the `intent.md` write fails before any phase runs, the abandoned
      external spec directory is removed (no orphaned no-commit dir left behind).
- [ ] On a `commit: false` later-phase failure where cleanup is skipped, failure
      output includes the preserved external spec directory path.
- [ ] Committed (`commit: true`) plan failure/cleanup behavior is unchanged.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `v1/docs/plan-mode.md`: state that a `commit: false` spec directory
  (and `intent.md`) is a preserved external artifact once written, including on
  later draft/review/validation/quota/model-config/interrupt failure; only an
  abandoned pre-`intent.md` dir is auto-removed. Update the `commit: false`
  cleanup/troubleshooting text (around the external-specs cleanup section) so it
  tells operators where to find a failed no-commit spec.
- Update `v2/docs/v1-behaviors.md`: add/adjust a `commit: false` bullet recording
  that later-phase failures preserve the named external spec dir, failure output
  reports its path, and only the pre-`intent.md` write-failure path removes the
  abandoned dir.
