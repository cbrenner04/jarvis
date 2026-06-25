# Strip non-contract lines from the drafted `index.md`

## Problem

The plan draft actuator sometimes emits a stray `repo:` line into the
generated `index.md` (observed: `repo: https://github.com/cbrenner04/jarvis`,
`repo: cbrenner04/jarvis`). The index contract is an H1 title plus the subspec
checklist only. The stray line rides into the merged spec and later breaks
`jarvis run` resolution (the run-side tolerance for an already-merged line is a
separate, already-shipped behavior; this spec keeps the line out of the merged
spec in the first place).

The legitimate no-commit `repo:` binding is injected programmatically by
`injectRepoLineIntoIndex` *after* draft validation — the agent never needs to
write it, so a `repo:` line present in agent output is always stray regardless
of `modes.plan.commit`.

## Decisions

- Strip stray lines, do not reject the draft. Rules out failing the whole plan
  run on a recoverable formatting slip; the draft proceeds with a canonical
  index.
- Retain = lines the index contract allows: the title H1, subspec checklist
  items, and blanks. The retention matcher is at least as permissive as
  `parseIndex`'s grammar (reuse it) — tolerating leading whitespace and checked
  `[x]`/`[X]` items, not just the literal `- [ ] [..](..)`. Rules out a matcher
  narrower than `parseIndex` that would strip a line the run side still reads,
  breaking the parse-parity criterion; and rules out a narrow `repo:`-only strip
  that would leave other stray metadata (`status:`, prose).
- The strip runs after `validateDraftOutput` succeeds and before the draft
  boundary check — which is itself upstream of both the no-commit
  `injectRepoLineIntoIndex` and the draft commit. This single mode-independent
  anchor holds for both `commit: true` and `commit: false`. Rules out targeting
  `injectRepoLineIntoIndex` directly: that name is ambiguous (an inert pre-draft
  call that early-returns plus the real post-draft injection, both guarded by
  `commit === false`), so it is not an anchor on the `commit: true` path; and
  rules out running after injection, which would delete the legitimate injected
  `repo:` line.
- The strip no-ops when `index.md` is absent. Rules out crashing on the path
  where `validateDraftOutput` returns valid with a blocker before `index.md`
  exists.
- A stray agent-written `repo:` is removed before injection so the no-commit
  path writes the correct binding instead of skipping injection on the early
  `repo:`-already-present return. Rules out leaving the agent's possibly-wrong
  value in place.
- The strip is a standalone step, not folded into `validateDraftOutput`.
  Validation also runs on the blocker path and is otherwise read-only; keeping
  the file mutation out of the validator is the reason. Rules out a validator
  that mutates on some paths and not others.
- Emit a one-line stderr notice when the strip removes ≥1 line. Rules out a
  silent strip that hides a misbehaving prompt with no operator trail, matching
  the surrounding draft flow's stderr warnings.

## Task checklist

- [ ] Add a standalone index-cleanup step that retains only the title H1,
  subspec checklist items (matched via `parseIndex`'s grammar), and blank
  lines; no-ops when `index.md` is absent; skips the write when the cleaned
  content equals what was read; and emits a one-line stderr notice when it
  removes ≥1 line.
- [ ] Call it in the draft flow (`v1/src/modes/plan/run.ts`) after
  `validateDraftOutput` succeeds and before the draft boundary check, in both
  commit modes.
- [ ] Add tests covering: a stray `repo:` line removed; other stray metadata /
  prose removed; a clean H1+checklist index left unchanged (including one with
  no trailing newline); absent `index.md` no-ops; no-commit injection writing
  the correct `repo:` after a stray one is stripped.
- [ ] Update docs (plan-mode.md, v2/docs/v1-behaviors.md).

## Acceptance criteria

- [x] A drafted `index.md` containing a stray `repo:` line has that line
  removed before the `plan: draft` commit; the committed/merged index contains
  only the H1 title and the subspec checklist.
- [x] A drafted `index.md` containing other stray metadata or prose lines
  (e.g. `status: wip`, a free-text sentence) has them removed; H1 title and
  checklist items are preserved in order.
- [x] A drafted `index.md` already conforming to the contract (H1 + checklist,
  blank lines only) is left semantically unchanged — including one with no
  trailing newline (the cleanup does not rewrite it when content is unchanged).
- [x] When no `index.md` is present at the strip point, the draft flow proceeds
  without error (the cleanup no-ops).
- [x] Under `commit: false`, a drafted `index.md` with a stray agent-written
  `repo:` line ends with exactly the programmatically injected `repo:` binding
  (`injectRepoLineIntoIndex`), not the agent's value.
- [x] `parseIndex` (`v1/src/modes/plan/pr.ts`) reads the same title and subspec
  list from the cleaned index as before (existing `parseIndex`/plan draft tests
  stay green; the cleanup only removes lines `parseIndex` already ignores).

## Documentation updates

- [x] `v1/docs/plan-mode.md` draft-phase section documents that jarvis strips
  non-contract lines from the generated `index.md` before the `plan: draft`
  commit, leaving only the H1 title and subspec checklist.
- [x] `v2/docs/v1-behaviors.md` records the index-cleanup behavior added to the
  draft phase.
