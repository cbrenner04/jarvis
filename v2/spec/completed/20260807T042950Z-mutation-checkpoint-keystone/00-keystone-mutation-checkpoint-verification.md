# Keystone mutation checkpoint verification

Guard mutation checkpoints prove inverting a guard turns a pinning test red; they cannot catch a headline behavior change that is inert — reverting the headline leaves new regressions green. Operator runbook § Gate trust documents manual headline-revert verification today. This subspec adds `Keystone checkpoint:` criteria whose `// @mutate` directive reverts the subspec's headline to baseline semantics; a surviving keystone at completion means the shipped change is inert and must be refused with messaging distinct from hollow guard checkpoints.

## Decisions

- `Keystone checkpoint:` is a dedicated criterion prefix required for keystone selection; directive-shaped `@mutate` in the block links the pinning test only — not an alternate selection path like guard `@mutate`-only blocks — rules out guard-style selection accidentally treating a headline revert as a guard hollow.
- `selectMutationCheckpointCriteria` excludes any block containing `Keystone checkpoint:`; add `selectKeystoneCheckpointCriteria` for keystone-only selection — rules out one selector serving both roles.
- Keystone verification reuses `verifyMutationCheckpoints` apply/run/restore machinery; keystone selection and inert-refusal policy land in a verifier branch keyed on keystone criteria — rules out a parallel verifier.
- `verifyMutationCheckpoints` runs keystone selection when guard count is zero; early-return only when both guard and keystone selectors are empty — rules out keystone-only fixtures being skipped.
- Keystone scoped-suite green after apply never populates `hollow`; it populates `inertHeadline` — single verifier outcome, not post-hoc reroute — rules out operators treating inert headline as a proof-form guard hollow.
- Keystone scoped-suite red after apply populates `caught` (same bucket as guard caught pins).
- Keystone linker failures (missing directive, mislinked pin title, unparseable target) surface in keystone-flavored diagnostics (`unparseable` or a keystone-specific report bucket), not `hollow` with guard-oriented detail — rules out conflating authoring mistakes with inert headline or hollow guards.
- Completion refusal uses a dedicated prefix distinct from `Hollow mutation checkpoints (` — e.g. `Inert headline change (` — rules out conflating inert headline with hollow guard diagnostics.
- Keystones are opt-in: a subspec with guard mutation-checkpoint criteria and no `Keystone checkpoint:` criterion completes normally. A keystone is verified only when the subspec declares one — requiring a keystone on every guard-checkpoint subspec would refuse all such specs (plan-draft does not author keystones today), bricking the pipeline. Plan-draft keystone authoring + a require gate can land later as a separate change.
- Exactly one ticked `Keystone checkpoint:` criterion per runtime-behavior subspec at completion; >1 ticked keystone criteria refuses with blocker text distinct from hollow and inert-survival messaging — rules out ambiguous headline-revert targets.
- Full-diff revert is not the keystone shape: new tests import new exports, so reverting everything yields compile errors — rules out whole-subspec revert directives.
- Plan draft authors the keystone criterion and pinning-test `// @mutate` when drafting runtime-behavior subspecs; this subspec's meta-keystone proves the headline change matters — reverting the inert-headline refusal turns its pin red (`caught`), not green — rules out the implement agent inventing or omitting the keystone silently.
- Inert-path proof (headline revert stays green ⇒ `inertHeadline` refusal) lives in an embedded fixture subspec inside `mutation-checkpoint-keystone.test.ts`, not as a completion-blocking obligation on this subspec's own keystone pin — rules out a self-blocking implementing subspec.
- Deferred: refusing runtime-behavior subspecs with headline production changes but no guard checkpoints and no keystone; plan-draft validator for headline-only detection — pin when enforcement scope expands beyond the guard+no-keystone case pinned here.
- Out of scope: intent-split prompt changes; phrase-only mutation-checkpoint selection path; plan-debate premise-falsification automation (serial sibling `plan-review-premise-falsification`).

## Tasks

### Shared selection

- Add `KEYSTONE_CRITERION_MARKER` (`Keystone checkpoint:`) and `selectKeystoneCheckpointCriteria` to `shared/mutation-checkpoint-criteria.ts`: `requireChecked`, full bullet blocks, human-only skip, `Keystone checkpoint:` prefix required; `@mutate` in block is for directive linking only, not selection without the prefix.
- Narrow `selectMutationCheckpointCriteria` to exclude blocks containing `KEYSTONE_CRITERION_MARKER`.

### Verifier

- Extend `MutationCheckpointReport` with `inertHeadline: InertHeadlineCheckpoint[]` (parallel shape to `HollowCheckpoint`).
- In `verifyMutationCheckpoints`, remove guard-only early-return; run guard criteria when present, then keystone criteria when present; return empty report only when both selectors are empty.
- Run keystone criteria through the same `resolveLinkedDirectives` / `applyAndClassify` path; keystone scoped-suite green after apply populates `inertHeadline` only (never `hollow`); red populates `caught`.
- Route keystone linker failures to keystone-flavored diagnostics (`unparseable` or keystone-specific bucket), not `hollow` with guard-oriented detail.
- Add `describeInertHeadline` with detail text distinct from hollow (`scoped suite stayed green under headline revert` or equivalent — not `scoped suite stayed green under this mutation` alone if that would collide).
- Export keystone selection helpers for tests.

### Completion boundary

- Add `buildInertHeadlineReason` in `v2/src/execution/write.ts`; refuse `done` / `no-work` when `report.inertHeadline.length > 0`.
- Extend `isMutationCheckpointCriteriaTickedMiss` and write-loop settlement to treat inert-headline refusal like hollow/unparseable mutation-checkpoint misses.
- Extend `repromptableMutationDirectiveBlocking` to hard-block completion when `report.inertHeadline.length > 0` (no reprompt path — inert headline is not a fixable directive typo).
- Before guard/keystone verification, refuse when ticked guard mutation-checkpoint criteria exist and ticked keystone criteria count is zero; refuse when ticked keystone criteria count exceeds one. Named blocker distinct from hollow and inert-survival text.

### Tests

- Add `v2/src/execution/mutation-checkpoint-keystone.test.ts` driving the implement completion boundary (same harness patterns as `write.test.ts` mutation-checkpoint cases):
  - `refuses completion when keystone mutation survives` — embedded fixture subspec whose keystone directive leaves scoped suite green ⇒ `contract_miss` with inert-headline blocker text that does not contain `Hollow mutation checkpoints`; fails pre-fix.
  - `allows completion when keystone mutation turns its pin red` — keystone-only fixture; keystone caught ⇒ completion proceeds past mutation-checkpoint gate; fails pre-fix.
  - `completes when guard checkpoints exist without a keystone criterion (keystones are opt-in)` — ticked `Mutation checkpoint:` without ticked `Keystone checkpoint:` ⇒ completes; keystones are not required.
  - `refuses when more than one ticked keystone criterion` — >1 ticked `Keystone checkpoint:` ⇒ refused with blocker text distinct from hollow and inert-survival messaging; fails pre-fix.
- Guard pin on `refuses completion when keystone mutation survives`: `// @mutate` removing the inert-headline refusal turns that test RED.
- Meta-keystone on this subspec: `Keystone checkpoint:` reverting the inert-headline refusal turns its named pin red (`caught`) at completion verification — not green survival.

### Docs

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — keystone checkpoints alongside guard checkpoints: `Keystone checkpoint:` prefix for selection, headline-revert directive shape, one per subspec; keystones are opt-in (verified when present, not required on every guard-checkpoint subspec).
- `v2/docs/operator-runbook.md` § Gate trust — surviving keystone means inert headline change; distinguish from hollow guard checkpoints and from premise-smell hollow (second hollow on a different guard); delete or demote the manual headline-revert bullet so keystone automation is the single operator path (no duplicate guidance).
- `v2/docs/v1-behaviors.md` — implement completion refuses inert headline changes when a `Keystone checkpoint:` directive survives its mutation, and refuses >1 ticked keystone criteria; keystones are opt-in (a guard-checkpoint subspec without one still completes).

## Acceptance criteria

- [x] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `refuses completion when keystone mutation survives` drives completion over an embedded fixture subspec whose keystone directive survives its mutation and asserts a named inert-headline blocker distinct from hollow guard checkpoint text; fails against the pre-fix completion boundary.
- [x] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `allows completion when keystone mutation turns its pin red`, `completes when guard checkpoints exist without a keystone criterion (keystones are opt-in)`, and `refuses when more than one ticked keystone criterion` prove caught keystone completes normally, guard-without-keystone completes (keystones opt-in), and >1 ticked keystone criteria are refused with messaging distinct from hollow and inert-survival blockers.
- [x] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — `refuses completion when keystone mutation survives`; Mutation checkpoint: its pinning test carries `// @mutate` removing the inert-headline refusal; reverting that refusal turns the named pin red.
- [x] `v2/src/execution/mutation-checkpoint-keystone.test.ts` — Keystone checkpoint on this subspec: reverting the inert-headline refusal turns its named pin red (`caught`), proving the headline change matters; not green survival on that pin.
- [x] `bun run typecheck`, `bun run check`, `bun run test:shared`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — keystone checkpoints alongside guard checkpoints for headline behavior changes; `Keystone checkpoint:` prefix; keystones are opt-in (verified when present, not required).
- `v2/docs/operator-runbook.md` § Gate trust — a surviving keystone means an inert headline change; distinguish from hollow guard checkpoints and from premise-smell hollow (second hollow on a different guard); manual headline-revert bullet deleted or demoted so keystone automation is the single path.
- `v2/docs/v1-behaviors.md` — implement completion refuses inert headline changes when a `Keystone checkpoint:` directive survives its mutation, and refuses >1 ticked keystone criteria; keystones are opt-in (a guard-checkpoint subspec without one still completes).
