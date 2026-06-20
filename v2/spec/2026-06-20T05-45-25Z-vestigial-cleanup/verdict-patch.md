Confirmed. Issuing verdict.

## Adjudication Verdict

The spec is sound and most of the work is complete, but one explicitly-scoped cleanup item was skipped, leaving exactly the class of vestige this spec exists to eliminate.

### Required outcomes

**1. Finish removing the constant-true `isIndexSpec` (gating).**
In `v1/src/modes/patch/run.ts`, `isIndexSpec` is provably `true` by the time `runIteration` runs — preflight either starts from `basename(specPath) === "index.md"` or sets it `true` on its only non-exit branch before returning. Three of the four dead `isIndexSpec` branches were stripped, but the guard at line 1453 (`if (isFixupIteration && isIndexSpec)`) still tests it. Subspec 00's Problem section names this `isFixupIteration && isIndexSpec` guard as one of the four dead branches, and task-checklist item #2 requires dropping the now-constant-true references and removing the preflight field if nothing reads it. Required end state:

- The fixup-blocker guard no longer branches on `isIndexSpec` (the condition reduces to the fixup check alone).
- Because line 1453 is the *only* reader of the `preflight.isIndexSpec` field, its field declaration (~209), its construction (~557), and its destructure (~902) must also go — item #2's "drop the field only if no remaining code reads it" now fires.
- Preserve the local preflight-prompt logic (~515–533) that drives the `[s]`/`[e]` non-index prompt; that is the separate, in-scope behavior backing AC#2 and is unrelated to the field.

Rationale: AC#1 ("no code path in `runIteration` branches on `!isIndexSpec`") passes on a literal reading because 1453 is a positive guard, but the spec's stated goal is to remove the dead `isIndexSpec` machinery wholesale. Leaving the field alive solely to feed one constant-true clause is the exact green-AC/goal-missed gap the cleanup targets.

**2. Strip newly-introduced trailing whitespace in the doc rewrite (minor).**
The reworked prose in `v1/docs/worktrees-and-commits.md` (the rewritten plan-worktree and phase-commit lines) introduced trailing whitespace. No markdown lint gate runs, so `ready` won't catch it, but it is fresh hygiene noise in a cleanup PR. Remove it from the lines this branch added; leave pre-existing whitespace elsewhere untouched.

### Not required

- The orphaned `buildPrompt` non-index inlining branch and its live, misleadingly-named test (`prompt.test.ts`) are **correctly deferred** by subspec 00's out-of-scope note ("to first consumer"). The branch and test still exercise live code; removing them now would break the atomicity the deferral protects. No action.