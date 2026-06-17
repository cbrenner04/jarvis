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
design. Line refs below are advisory anchors against current
`v1/src/commands/plan.ts`; confirm before editing:

- No `tmp-*` staging or rename in the no-commit path. `specDirBasename` is
  computed from the ready-intent `name:` up front (~`plan.ts:744`) and the dir is
  created directly under the final name (~`plan.ts:810`). `_TEMP_PLAN_PREFIX`
  (~`plan.ts:81`) is dead code.
- The only external-dir removal helper, `cleanupNoCommitTempSpec`
  (~`plan.ts:794-801`), recomputes `<externalSpecRoot>/<specDirBasename>` and
  `rmSync`s it. Its sole call site is the pre-phase `intent.md` write-failure
  `catch` (~`plan.ts:814`), which fires before the `Intent:` line is printed
  (~`plan.ts:823`).
- Every later-phase `commit: false` failure already `return`s without calling
  the helper, so the finalized dir survives on disk today — but only
  incidentally. The helper name and target (the finalized basename) make it a
  latent footgun if a future edit reuses it.

So the implementable deltas are narrow: make preservation explicit and tested,
rename and re-scope the write-failure cleanup so it reads as "remove the
abandoned pre-`intent.md` dir" (never a finalized, operator-visible one), drop
the dead `tmp-` constant, and add a failure-output breadcrumb naming the
preserved dir. Do not reintroduce `tmp-*` machinery.

## `commit: false` failure-return set (breadcrumb scope)

These are every `commit: false` exit after `intent.md` is written and the
`Intent:` line is printed; all preserve the external dir and all must emit the
preserved-dir breadcrumb:

- draft generic error (exit 1)
- draft quota (exit 2)
- draft model-config (exit 3)
- draft validation / subspec-count failure (exit 1)
- draft-phase catch (exit 1)
- boundary violation — appends a `## Blocker` to `intent.md`, then exits 1
- draft blocker (exit 1)
- review generic error / blocker (review exit code)
- review quota (exit 2)
- review model-config (exit 3)
- post-draft / review interrupt (exit 130)

Quota (2) and interrupt (130) are in scope: the intent lists both among the
preserved-on-failure paths, so they get the breadcrumb too. The only excluded
path is the pre-`intent.md` write-failure (exit 1), which prints no `Intent:`
line and instead removes the abandoned dir.

## Decisions

- Treat a no-commit external spec dir as operator-owned once `intent.md` is
  written and its path is printed; never delete it on phase failure (rules out
  deleting it as failed-run temp state).
- Harden the lone cleanup helper by intent, not just by call-site discipline:
  rename `cleanupNoCommitTempSpec` to name the abandoned pre-`intent.md` case it
  serves (e.g. `removeAbandonedPreIntentSpecDir`) and delete the dead
  `_TEMP_PLAN_PREFIX` constant in the same change (rules out leaving a
  finalized-name-targeting `rmSync` helper that a later edit reuses against an
  operator-visible dir, and rules out flagging dead code the spec then leaves in
  place).
- Keep automatic no-commit cleanup limited to the abandoned-on-write case: only
  the `intent.md` write-failure path removes the external dir, before the
  `Intent:` breadcrumb is emitted (rules out removing finalized dirs on draft /
  review / validation / boundary / quota / model-config / interrupt / generic
  failure).
- On every later-phase failure (cleanup skipped), print the preserved external
  spec dir path next to the error. The early `Intent:` line names a file and
  scrolls off behind agent transcript output before the failure prints; the new
  line is emitted adjacent to the error and names the *directory* the operator
  must inspect (rules out dropping it as redundant with the earlier `Intent:`
  stdout breadcrumb).
- Leave committed (`commit: true`) plan cleanup unchanged — `commit: false` only
  (rules out broadening teardown to in-repo plan worktrees/branches/specs).
- Scope: one preservation behavior in `plan.ts` plus paired tests and docs; keep
  it one reviewable change rather than splitting the breadcrumb from the
  preservation guarantee, since they share the same failure-path code and tests.

## Tasks

- Rename `cleanupNoCommitTempSpec` to name the abandoned pre-`intent.md` case
  (e.g. `removeAbandonedPreIntentSpecDir`), keep its sole call site in the
  `intent.md` write-failure `catch` (before the `Intent:` line), and delete the
  dead `_TEMP_PLAN_PREFIX` constant.
- Emit a failure-output line reporting the preserved external spec dir path at
  every `commit: false` exit in the failure-return set above; model the wording
  on the existing no-commit handoff (~`plan.ts:1192-1197`). The boundary path
  still appends its `## Blocker` to `intent.md` first, then emits the line.
- Keep the `intent.md` write-failure path removing the abandoned external dir
  (renamed helper, unchanged behavior).
- Add regression tests in `v1/test/plan-no-commit-intent-output.test.ts` (or a
  sibling) covering the acceptance criteria below. Reuse the existing
  bad-agent seam (`agentOrder` with a nonexistent model + `skipGhCheck: true`)
  for the draft-failure cases. For the pre-`intent.md` write-failure case, force
  the file write to throw without failing the `mkdirSync`: pre-create a
  directory at the `intent.md` path so `writeFileSync` throws `EISDIR` while the
  spec-dir creation succeeds.
- Apply the documentation updates below.

## Acceptance criteria

Labels: `(guard)` pins existing-but-incidental behavior with a new test;
`(delta)` requires a code change. Both kinds are required.

- [ ] (guard) After a `commit: false` plan run fails in the draft phase (after
      `intent.md` is written), the external spec directory and its `intent.md`
      remain on disk.
- [ ] (guard) After a `commit: false` plan run fails in the review phase, the
      named external spec directory and its `intent.md` remain on disk.
- [ ] (guard) After a `commit: false` boundary violation, the named external
      spec directory remains on disk and its `intent.md` carries the appended
      `## Blocker`.
- [ ] (delta) When the `intent.md` write fails before any phase runs, the
      abandoned external spec directory is removed (no orphaned no-commit dir
      left behind).
- [ ] (delta) At every `commit: false` failure in the failure-return set above
      (draft and review generic/quota/model-config, validation, boundary,
      blocker, and interrupt), failure output includes the preserved external
      spec directory path.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

Scope note (not a tickable criterion): committed (`commit: true`) plan
failure/cleanup behavior is untouched — the change is gated on `commit === false`
and the committed `cleanupCommittedTempPlanState` call site is not modified. No
committed-mode cleanup test exists to anchor a positive assertion, so this stays
a scope boundary, not a criterion.

## Documentation updates

Extend existing prose with the failure-path additions only; do not restate
content already present.

- `v1/docs/plan-mode.md`, the `commit: false` external-specs cleanup section
  (~lines 413-424): it currently frames only successful runs ("not
  automatically cleaned up", re-runnable). Add the failure case — a
  `commit: false` spec directory and `intent.md` are preserved on later draft /
  review / validation / quota / model-config / boundary / interrupt failure, the
  failure output prints the preserved directory path, and only the abandoned
  pre-`intent.md` write-failure dir is auto-removed — so operators know where to
  find a failed no-commit spec.
- `v2/docs/v1-behaviors.md`: extend the existing `commit: false` entries (line 75
  already records the `Intent:` print and operator-retention-on-failure; line 76
  already records no-commit boundary behavior). Add one bullet recording that
  later-phase failures preserve the named external spec dir, failure output
  reports its path, and only the pre-`intent.md` write-failure path removes the
  abandoned dir. Do not duplicate lines 75-76.
