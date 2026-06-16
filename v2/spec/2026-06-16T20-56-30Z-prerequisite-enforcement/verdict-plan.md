I'll ground my verdict in the actual codebase before adjudicating, since the central disputes turn on specific plumbing: how the blocker channel works, what surfaces on stderr, and which tree the draft agent reads.Now let me verify the harness blocker-to-exit-code path and the stderr surfacing, plus which cwd the agent runs in.The plumbing claims are confirmed. The draft agent runs in the target-repo checkout (worktree off it, or `project.root`); the blocker channel is `intent.md`-pinned in the prompt already (`draft.md:39,44`); blocker body surfaces on stderr (`plan.ts:1078-1081`); and `hasGenuineBlocker` reads only `intent.md`. I have enough grounding to adjudicate.

# Verdict — Required refinements for `2026-06-16T20-56-30Z-prerequisite-enforcement`

The spec's core design is sound: a fail-closed legibility gate the draft agent runs first, repo-as-signal, one agent, reusing the existing `## Blocker` channel. Faithful to the intent and correctly grounded in the real plumbing. The following refinements are required before this spec is ready. They are gaps between what the acceptance criteria *promise* and what the spec actually *verifies*, plus a few precision and reachability fixes. None expand scope.

## Required refinements

1. **Verify the "stderr names each unconfirmed behavior" promise, not just plumbing.**
   AC #1 promises stderr names each unconfirmed behavior, but the harness only surfaces whatever text the agent wrote into the blocker body — naming is an LLM-output property. The behavioral test uses a fake agent the author makes write the names, so it proves the blocker→stderr plumbing, not that the *real prompt* elicits named behaviors. The spec must add a static assertion against the built draft prompt that the gate instruction explicitly directs the agent to **name each unconfirmed behavior in the blocker body** (parallel to the existing fail-closed-wording assertion). This is the verifiable proxy for the unverifiable model output, and harness specs treat prompt text as the contract.

2. **Pin the gate's blocker output to `intent.md` in the acceptance/wording.**
   The harness detects a draft blocker *only* from an appended `## Blocker` in `intent.md`; a blocker written to a subspec or bare stderr falls through to the generic "no subspecs created" error and loses the named behaviors. The live prompt already pins `intent.md` as the blocker target, and the spec builds on that channel — but the spec's own AC says only "append `## Blocker`." Tighten the gate wording so the blocker is explicitly appended **to `intent.md`**, removing the ambiguity that an implementer could route it elsewhere.

3. **Rewrite AC #4 to assert only observable outcomes.**
   "The prerequisite judgment is the draft agent's first action" is not externally observable — the draft agent is a single invocation, so nothing outside the prompt can witness ordering. Keep the observable, intent-mandated property ("a failed gate writes no spec files and runs no review pass, so it wastes no draft/review work") and reframe the "first action / before any spec content" claim as a **prompt-text property** (checked via the prompt-text assertion family), not a runtime-observable one.

4. **Fix the "empty or absent `## Prerequisites`" case to its reachable form.**
   A literally absent `## Prerequisites` section is rejected upstream (the consumed ready-intent is required to carry the section), so it cannot reach the gate. The reachable case is "section present, no behaviors listed." AC #3 and the test bullet must describe the **empty section (no behaviors listed)** case and drop "absent" (or explicitly attribute absence to upstream validation), so the test target is actually reachable.

5. **State which tree the agent reads.**
   The spec says the agent judges prerequisites against "existing repo files" but never says *which* checkout. The draft agent runs in the target-repo checkout it already operates in (a worktree off the base branch in commit mode, or the project root in no-commit mode). Add a one-line clarification that "existing files" means that target-repo checkout — not the jarvis harness repo — so the doc updates and prompt instruction are unambiguous. No new behavioral decision is owed; this is the same context source the draft agent already reads, and merge-first discipline already governs what counts as "in the repo."

6. **Call out that the rendered-snapshot fixture is renamed, not edited.**
   The fixture filename embeds the prompt revision (`plan.prompt.draft@r7...`). On a revision bump the old fixture must be **renamed** to the new revision, not edited in place, or a stale fixture lingers beside the new one. The task list covers the assertion sites but must note the fixture rename so an implementer doesn't leave a mismatched artifact.

7. **Terseness pass on `## Decision`.**
   The `## Decision` section re-narrates the fail-closed / one-agent / repo-as-signal set already carried by the intent and acceptance criteria, and the "Gate behavior the prompt instructs" list partly duplicates the Tasks. Repo rules require the ledger to *be* the record with no surrounding narrative justification. Tighten `## Decision` into atomic ledger entries (each already names the wrong alternative it rules out) and cut the restated prose and the duplicated gate-behavior list.

## Explicitly not required (do not add)

- **No per-behavior "uncertain vs. absent" reporting.** The intent's fail-closed decision deliberately collapses "cannot confirm" into "absent"; there is no "uncertain" state by design. Adding confidence granularity invents precision no current consumer needs and the intent explicitly ruled out. Naming each unconfirmed behavior (refinement 1) is the only obligation here.
- **No prerequisite-specific exit code or separate stderr path.** The intent mandates reusing the existing blocker channel. Operator distinguishability ("missing prerequisite X" vs. a generic blocker) comes from the **named blocker body** (refinement 1), not a new exit code or path. The no-new-path decision is correct as written; do not change it.
- **No completion record, behavior ledger, `v1-behaviors.md` completion entry, or preflight/checker agent.** These remain out of scope per the intent and the spec correctly excludes them.