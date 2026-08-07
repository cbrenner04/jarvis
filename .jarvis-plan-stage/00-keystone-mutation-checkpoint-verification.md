# Keystone mutation checkpoint verification

Guard mutation checkpoints prove inverting a guard turns a pinning test red; they cannot catch a headline behavior change that is inert — reverting the headline leaves new regressions green. Operator runbook § Gate trust documents manual headline-revert verification today. This subspec adds `Keystone checkpoint:` criteria whose `// @mutate` directive reverts the subspec's headline to baseline semantics; a surviving keystone at completion means the shipped change is inert and must be refused with messaging distinct from hollow guard checkpoints.

## Decisions

- `Keystone checkpoint:` is a dedicated criterion prefix; guard selection stays on `Mutation checkpoint:` or directive-shaped `@mutate` only — rules out guard-pin selection treating a headline revert as a guard hollow.
- `selectMutationCheckpointCriteria` excludes any block containing `Keystone checkpoint:`; add `selectKeystoneCheckpointCriteria` for keystone-only selection — rules out one selector serving both roles.
- Keystone verification reuses `verifyMutationCheckpoints` apply/run/restore machinery; keystone selection and inert-refusal policy land in a verifier branch keyed on keystone criteria — rules out a parallel verifier.
- Keystone semantics invert the refusal surface only: scoped suite green after apply ⇒ `inertHeadline` entry (not `hollow`); scoped suite red ⇒ `caught` — rules out operators treating inert headline as a proof-form guard hollow.
- Completion refusal uses a dedicated prefix distinct from `Hollow mutation checkpoints (` — e.g. `Inert headline change (` — rules out conflating inert headline with hollow guard diagnostics.
- Missing keystone: when a subspec has ≥1 ticked guard mutation-checkpoint criterion and zero ticked `Keystone checkpoint:` criteria, completion refuses — rules out guard-only coverage of headline changes.
- Exactly one ticked `Keystone checkpoint:` criterion per runtime-behavior subspec at completion; >1 ticked keystone criteria refuses — rules out ambiguous headline-revert targets.
- Full-diff revert is not the keystone shape: new tests import new exports, so reverting everything yields compile errors — rules out whole-subspec revert directives.
- Plan draft authors the keystone criterion and pinning-test `// @mutate` when drafting runtime-behavior subspecs; this subspec carries its own keystone reverting the inert-headline refusal — rules out the implement agent inventing or omitting the keystone silently.
- Deferred to first consumer: refusing runtime-behavior subspecs with headline production changes but no guard checkpoints and no keystone — pin when enforcement scope expands beyond the guard+no-keystone case pinned here.
- Out of scope: intent-split prompt changes; phrase-only mutation-checkpoint selection path; plan-debate premise-falsification automation (serial sibling `plan-review-premise-falsification`).

## Tasks

### Shared selection

- Add `KEYSTONE_CRITERION_MARKER` (`Keystone checkpoint:`) and `selectKeystoneCheckpointCriteria` to `shared/mutation-checkpoint-criteria.ts`, mirroring guard selection (`requireChecked`, full bullet blocks, human-only skip, directive-shaped `@mutate` in block).
- Narrow `selectMutationCheckpointCriteria` to exclude blocks containing `KEYSTONE_CRITERION_MARKER`.

### Verifier

- Extend `MutationCheckpointReport` with `inertHeadline: InertHeadlineCheckpoint[]` (parallel shape to `HollowCheckpoint`).
- In `verifyMutationCheckpoints`, after guard criteria, run keystone criteria through the same `resolveLinkedDirectives` / `applyAndClassify` path; route green-under-mutation results to `inertHeadline` instead of `hollow`.
- Add `describeInertHeadline` with detail text distinct from hollow (`scoped suite stayed green under headline revert` or equivalent — not `scoped suite stayed green under this mutation` alone if that would collide).
- Export keystone selection helpers for tests.

### Completion boundary

- Add `buildInertHeadlineReason` in `v2/src/execution/write.ts`; refuse `done` / `no-work` when `report.inertHeadline.length > 0`.
- Extend `isMutationCheckpointCriteriaTickedMiss` (and write-loop settlement) to treat inert-headline refusal like hollow/unparseable mutation-checkpoint misses.
- Before guard/keystone verification, refuse when ticked guard mutation-checkpoint criteria exist and ticked keystone criteria count is zero; refuse when ticked keystone criteria count exceeds one. Named blocker distinct from hollow and inert-survival text.

### Tests

- Add `v2/src/execution/mutation-checkpoint-keystone.test.ts` driving the implement completion boundary (same harness patterns as `write.test.ts` mutation-checkpoint cases):
  - `refuses completion when keystone mutation survives` — keystone directive leaves scoped suite green ⇒ `contract_miss` with inert-headline blocker text that does not contain `Hollow mutation checkpoints`; fails pre-fix.
  - `allows completion when keystone mutation turns its pin red` — keystone caught ⇒ completion proceeds past mutation-checkpoint gate.
  - `refuses when guard checkpoints exist but no keystone criterion` — ticked `Mutation checkpoint:` without ticked `Keystone checkpoint:` ⇒ refused; fails pre-fix.
- Guard pin on `refuses completion when keystone mutation survives`: `// @mutate` removing the inert-headline refusal turns that test RED.

### Docs

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — keystone checkpoints alongside guard checkpoints: `Keystone checkpoint:` prefix, headline-revert directive shape, one per runtime-behavior subspec, plan-draft authoring obligation.
- `v2/docs/operator-runbook.md` § Gate trust — surviving keystone means inert headline change; distinguish from hollow guard checkpoints and from premise-smell hollow (second hollow on a different guard); reference replacing the manual revert bullet when keystone ships.
- `v2/docs/v1-behaviors.md` — implement completion refuses inert headline changes when a `Keystone checkpoint:` directive survives its mutation; missing keystone when guard checkpoints exist is refused.

## Acceptance criteria

- [ ] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `refuses completion when keystone mutation survives` drives completion over a subspec whose keystone directive survives its mutation and asserts a named inert-headline blocker distinct from hollow guard checkpoint text; fails against the pre-fix completion boundary.
- [ ] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `allows completion when keystone mutation turns its pin red` and `refuses when guard checkpoints exist but no keystone criterion` prove a caught keystone completes normally and a subspec with guard checkpoints but no `Keystone checkpoint:` criterion is refused rather than silently passing; fail pre-fix.
- [ ] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `refuses completion when keystone mutation survives`; Mutation checkpoint: its pinning test carries `// @mutate` removing the inert-headline refusal; reverting that refusal turns the named pin red.
- [ ] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `headline revert stays green after keystone apply`; Keystone checkpoint: reverting the inert-headline refusal to baseline semantics leaves the scoped suite green on the headline revert (this subspec's keystone pin).
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — keystone checkpoints alongside guard checkpoints for headline behavior changes.
- `v2/docs/operator-runbook.md` § Gate trust — a surviving keystone means an inert headline change; distinguish from hollow guard checkpoints and from premise-smell hollow (second hollow on a different guard).
- `v2/docs/v1-behaviors.md` — implement completion refuses inert headline changes when a `Keystone checkpoint:` directive survives its mutation; missing keystone when guard checkpoints exist is refused.
