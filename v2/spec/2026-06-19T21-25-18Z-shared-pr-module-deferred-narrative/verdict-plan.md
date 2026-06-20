# Verdict — refinements required

The spec is sound in structure and decision discipline, but several call paths it claims to cover are not actually traced, leaving headline acceptance criteria unsatisfiable as written. Refine the following.

## Required (load-bearing)

1. **Route initial draft-body creation through the template/agent selector.**
   The first subspec completion creates the draft PR via a body generator that today unconditionally invokes the narrative agent. Spec 00 only describes the *rewrite* path, never the draft-*creation* path, and spec 01 keeps draft creation on first completion. As written, any run produces its first body via the agent even under `prNarrative: template` — so the headline criterion ("narrative produced deterministically with no narrative-agent invocation") is false across a whole run. Spec 00 must make draft-body creation honor `prNarrative`, and the ACs must be phrased per-run: under `template`, the narrative agent is never invoked for PR body content anywhere in the run (creation or rewrite). This is within the spec's stated intent, not a scope expansion.

2. **Name the agent source for the deferred rewrite under `agent` mode.**
   The completion-pipeline site where the rewrite now lives does not carry the loop-local agent handle the old per-subspec rewrite used. Under `template` the rewrite needs no agent, but under `prNarrative: agent` the spec must state which agent the completion-time rewrite uses (the same source shrink/review already thread). Add this as a decision so the implementer doesn't guess.

3. **Pin "once per terminal-green completion" and state terminal-red behavior.**
   The completion routine is re-entered on fix-up loop-backs, stuck-red stops, and review-failure returns. The spec's "after the green gate, before shrink/review" placement does yield once-per-terminal-green (loop-backs return earlier), but the spec never says the placement *guarantees* idempotency, and it is silent on terminal-red stops. Tighten the AC to "rewritten exactly once per terminal-green completion," and state that a terminal red/stuck-red stop leaves the body at whatever draft creation set.

4. **Promote the commit-subject data source to an explicit decision/seam.**
   Template content depends on branch commit subjects — a new git dependency the body builder does not have today. This is not "line formatting" and must not hide under the formatting deferral, because the determinism AC and the "regenerated reflecting new commits" AC both hinge on it. The spec must name the commit range and ordering (e.g. `base..HEAD`, git-log order) and an injectable seam so those criteria are testable.

5. **Specify plan-mode template regeneration gating.**
   Plan's body regeneration currently gates on the presence of intent content; template mode has no intent input, so under the existing gate plan-template would never regenerate. Spec 00 must state that plan's regeneration under `template` does not depend on intent content.

## Required (recording/wording)

6. **Reconcile the unmerged `pr-description-prompt.ts` files against the intent's literal scope.** The intent lists both prompt files as merge targets; the spec keeps them mode-local (different inputs/step IDs). Add a decision explicitly stating the two prompt files are *not* merged because their declarations differ, and only the generation/extraction/assembly core is shared — closing the loop against the intent line.

7. **State where the `template` default is applied** (load-time materialization vs read-site default) and that existing configs lacking the key keep working unchanged.

8. **Add draft-creation to the `v1-behaviors.md` documentation updates.** Once refinement 1 lands, draft-creation behavior changes, and per repo rules any change to existing v1 behavior must be recorded in that catalog. The current doc bullets cover narrative defaults and rewrite cadence but not draft creation.

## Not upheld

- The dedup acceptance criterion ("both route through the shared module") is adequate: this is harness work where code organization is part of the contract, and naming internal structure is permitted for harness subspecs.
- Plan mode still issuing multiple `gh pr edit` refreshes is correctly out of scope; under the new `template` default those become agent-free, which addresses the intent's cost concern. One confirming line in spec 01 ("plan's multiple refreshes remain, now agent-free under `template`") would preempt the question but is optional.

## Rationale

The intent defines `template` as "no agent on every run" and the headline acceptance signals assert no agent invocation under the default. Items 1 and 5 are the difference between satisfiable and unsatisfiable criteria; item 2 is required for `agent` mode to function at the moved call site; items 3 and 4 make the determinism and idempotency criteria actually testable. The remainder are required recordings under the repo's "any existing-behavior change updates `v1-behaviors.md`" rule and the principle that load-bearing data sources (commit subjects, default application) belong in the decision ledger rather than under a deferral.