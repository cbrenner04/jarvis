Reviewing write-loop reprompt gating and related completion-boundary code to validate the advocate's findings before issuing the verdict.
# Adjudication verdict — mutation-checkpoint-keystone

## Required outcomes

1. **Hard-block reprompt for all non-repromptable mutation-checkpoint failures.** Implement completion must not enter `mutation_directive_reprompt` when the original `spec.criteria-ticked` miss is `Missing keystone checkpoint`, `Multiple keystone checkpoints`, `Unlinked keystone checkpoints`, `Inert headline change`, or `Hollow mutation checkpoints`. Reprompt remains limited to reprompt-eligible `Unparseable mutation checkpoints:` (`target_absent` / `target_ambiguous` in opened pinning files, no mixed blocking reasons). Today `isMutationCheckpointCriteriaTickedMiss` treats keystone policy and linker failures as mutation-checkpoint misses, then the write loop re-runs `verifyMutationCheckpoints` and may reprompt from a fresh report that omits those pre-check outcomes. That contradicts the spec: keystone authoring/policy failures and inert headline are not fixable directive typos.

2. **Add completion-boundary coverage for unlinked keystone criteria.** A ticked `Keystone checkpoint:` criterion with no linked `// @mutate` on the named pin must refuse completion with `Unlinked keystone checkpoints` messaging and must not reprompt. `checkMutationCheckpointsAtCompletion` already refuses this; the new keystone test file must prove it end-to-end.

3. **Align `v2/docs/write-behavior.md` with the shipped keystone completion boundary.** Per `v2/docs/documentation-standard.md`, operator/workflow behavior lives in `v2/docs/`. `v1-behaviors.md` already documents keystone prefixes, missing/multiple keystone refusal, inert-headline refusal, and cites `write-behavior.md`; `write-behavior.md` § `spec.criteria-ticked` still describes guard-only hollow/reprompt semantics. Update it to match: `Keystone checkpoint:` selection, guard-gated missing keystone, multiple-keystone refusal, inert-headline vs hollow distinction, unlinked-keystone refusal, and that inert headline / keystone policy failures do not reprompt.

## Rationale

- Outcome 1 closes an integration gap the subspec explicitly tasked (`repromptableMutationDirectiveBlocking` hard-block for `inertHeadline`; keystone linker failures must not conflate with guard hollow or reprompt paths). Without it, operators can see a directive reprompt instead of the keystone blocker the completion boundary already chose.
- Outcome 2 closes an acceptance gap: linker failures are routed to `keystoneUnlinked` with distinct refusal text, but no test proves that path at completion.
- Outcome 3 closes a documentation-placement gap: cross-linked operator docs must not contradict each other on keystone behavior.

## Not required before merge

- Meta-keystone enforced via `keystone on implementing subspec catches headline revert` rather than a ticked keystone on the implementing subspec (avoids self-blocking; matches adjudicated contract).
- Structural guard `// @mutate` on the inert-path pin (repo convention for external mutation tooling).
- Dedicated verifier unit rows or shared selection unit tests (verdict-plan deferred; completion-boundary tests exercise selectors end-to-end).
- `intent.md` checkbox state or scope narrowing (harness-owned; subspec and shipped docs already state guard-gated missing-keystone enforcement).
- Plan-draft hollow-pin scanning for keystones (explicitly deferred).
- Keystone `target_absent` / `target_ambiguous` reprompt in isolation (consistent with guard directive typo semantics; distinct from unlinked-keystone hard refusal).