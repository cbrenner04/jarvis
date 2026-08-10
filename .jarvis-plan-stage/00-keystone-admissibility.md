# Keystone admissibility at plan draft

## Problem

A drafted keystone criterion written as prose ("Keystone checkpoint: inverting the undated-row ordering guard makes the scoped test fail") names no pinning file and no enclosing test title, so no `// @mutate` directive the implement authors can ever link to it. Plan draft admits such a draft today; the cost lands later on the implement.

## Behavior

Plan-draft normalization refuses a staged tree containing a keystone criterion that carries neither a literal `// @mutate` directive nor a pin reference (backticked pinning-test file plus enclosing test title), with a message naming the offending subspec file and criterion. Admissibility is judged from criterion text alone.

## Decisions

- The gate runs inside `normalizePlanDraftSpecDir`, before the multi-boundary early return — rules out a separate validator in `v2/src/execution/write.ts`, which would need its own reason plumbing to reach `contract_miss`.
- Candidate criteria are assembled bullet blocks containing `Keystone checkpoint:` outside backticks — rules out a bare-substring match, which would refuse the guidance-sanctioned descriptive mention of `` `Keystone checkpoint:` ``.
- A candidate is admissible when its block matches the canonical keystone suffix (`selectKeystoneCheckpointCriteria`) or contains a literal `// @mutate` directive — rules out re-implementing pin parsing inside the gate.
- Admissibility never resolves the named file or test title on disk — rules out repeating the #2706 enclosing-test gate, reverted for false-positiving new tests at plan time.
- Checkbox state is ignored — drafts author criteria unticked, so a ticked-only gate would never fire at draft.
- Detection lives in `shared/mutation-checkpoint-criteria.ts` next to keystone selection; `shared/module-boundary-surfaces.ts` only calls it and throws.

## Acceptance criteria

- [ ] A prose-only keystone criterion in a staged subspec makes `normalizePlanDraftSpecDir` throw, and the thrown message names the offending subspec file and criterion text; both new tests fail against the pre-fix code, which normalizes the tree silently.
- [ ] A keystone criterion carrying the canonical suffix (backticked pinning-test file, em dash, backticked test title, `Keystone checkpoint:`) is admitted, and so is one carrying a literal `// @mutate` directive.
- [ ] A criterion whose only keystone reference is the backticked token `` `Keystone checkpoint:` `` inside prose is admitted.
- [ ] A keystone criterion naming a pinning-test file and test title that do not exist on disk is admitted, proving admissibility reads criterion text only.
- [ ] `shared/module-boundary-surfaces.test.ts` — `the keystone refusal names the offending subspec file and criterion`; Mutation checkpoint: making the admissibility check treat every candidate as admissible must turn that test red.
- [ ] `shared/module-boundary-surfaces.test.ts` — `a backticked keystone mention is admitted`; Mutation checkpoint: dropping the outside-backticks restriction from candidate selection must turn that test red, proving the refusal stays suppressed for descriptive mentions.
- [ ] `shared/module-boundary-surfaces.test.ts` — `a prose-only keystone criterion refuses the staged draft`; Keystone checkpoint: reverting the gate call in `normalizePlanDraftSpecDir` to a no-op restores baseline admission and turns that test red.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan-draft admission refuses unsatisfiable keystone criteria; what makes one satisfiable.
- `v1/docs/spec-guidance.md` — keystone criteria must name a pin or carry a directive; prose-only checkpoints are refused at draft.
- `v2/docs/v1-behaviors.md` — record the changed plan-draft admission behavior.
