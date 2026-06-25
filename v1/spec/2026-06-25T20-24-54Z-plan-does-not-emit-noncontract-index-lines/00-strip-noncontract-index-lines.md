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
- Non-contract = any line that is not the first H1 title, a subspec checklist
  item (`- [ ] [..](..)`), or blank. Rules out a narrow `repo:`-only strip that
  would leave other stray metadata (`status:`, prose) violating the contract.
- The strip runs in the draft flow after `validateDraftOutput` passes and
  before `injectRepoLineIntoIndex` and the draft commit/boundary check, for both
  `commit: true` and `commit: false`. Rules out running after injection (which
  would delete the legitimate injected `repo:` line) and rules out a
  commit-only fix.
- A stray agent-written `repo:` is removed before injection so the no-commit
  path writes the correct binding instead of skipping injection on the early
  `repo:`-already-present return. Rules out leaving the agent's possibly-wrong
  value in place.

## Task checklist

- [ ] Add an index-cleanup step that rewrites the drafted `index.md` to retain
  only the H1 title, subspec checklist items, and blank lines.
- [ ] Call it in the draft flow (`v1/src/modes/plan/run.ts`) after draft
  validation succeeds and before `injectRepoLineIntoIndex` / the draft commit,
  in both commit modes.
- [ ] Add tests covering: a stray `repo:` line removed; other stray metadata /
  prose removed; a clean H1+checklist index left byte-identical; no-commit
  injection writing the correct `repo:` after a stray one is stripped.
- [ ] Update docs (plan-mode.md, v2/docs/v1-behaviors.md).

## Acceptance criteria

- [ ] A drafted `index.md` containing a stray `repo:` line has that line
  removed before the `plan: draft` commit; the committed/merged index contains
  only the H1 title and the subspec checklist.
- [ ] A drafted `index.md` containing other stray metadata or prose lines
  (e.g. `status: wip`, a free-text sentence) has them removed; H1 title and
  checklist items are preserved in order.
- [ ] A drafted `index.md` already conforming to the contract (H1 + checklist,
  blank lines only) is left unchanged.
- [ ] Under `commit: false`, a drafted `index.md` with a stray agent-written
  `repo:` line ends with exactly the programmatically injected `repo:` binding
  (`injectRepoLineIntoIndex`), not the agent's value.
- [ ] `parseIndex` (`v1/src/modes/plan/pr.ts`) reads the same title and subspec
  list from the cleaned index as before (existing `parseIndex`/plan draft tests
  stay green; the cleanup only removes lines `parseIndex` already ignores).

## Documentation updates

- [ ] `v1/docs/plan-mode.md` draft-phase section documents that jarvis strips
  non-contract lines from the generated `index.md` before the `plan: draft`
  commit, leaving only the H1 title and subspec checklist.
- [ ] `v2/docs/v1-behaviors.md` records the index-cleanup behavior added to the
  draft phase.
