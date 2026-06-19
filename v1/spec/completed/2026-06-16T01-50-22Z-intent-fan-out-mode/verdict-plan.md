# Verdict — Refinements Required

The draft is sound in its core decisions (one-PR-per-spec lever, plan-prompt coherence on the ~1000-line figure kept in `spec-guidance.md` only, behavior-based split unit, declared/unenforced `Prerequisites`). These survive untouched. The following must be resolved.

## Blocking

**1. Define what "reuse the existing machinery" means, and whether refine runs at all.**
Subspec 00 introduces a *new* splitter prompt as the draft step, so 01's claim to "reuse the existing plan intent-draft and refine machinery and not extract or refactor it" cannot mean prompt-level reuse — the existing intent-draft prompt is single-intent and does not perform an N-way split. The spec must state explicitly that 01 reuses the *turn/runner plumbing* (agent invocation, quota fallback, worktree/commit/PR scaffolding), not the intent-draft prompt text. Separately, the existing refine prompt keys its preservation contract on a single-intent seed-wrapper layout that freshly split `ready-intents/` files will not have; running it as-is is a no-op, an error, or requires synthesizing N single-intent dirs. The spec must resolve whether refine runs on split outputs, against what layout — or whether it does not run in the per-intent path. This is the load-bearing decision: it determines "wire two existing steps" vs. "author new prompt behavior," and the current ACs are not satisfiable as written. *(Rationale: the intent's whole rationale is cheap up-front reuse; an unresolvable reuse claim defeats it. Also ties to the recorded lesson that refine over-amplifies precision on consumer-less specs — behavior-level intents are exactly that, so refine at intent altitude must be justified or dropped, not assumed.)*

**2. Pin the `Prerequisites` entry shape.**
The justification for landing `Prerequisites` now is that seed 03's enforcement becomes "purely additive." The semantic contract (behaviors not intent names, true deps, declared/operator-honored) is pinned, but no AC pins entry *granularity*. If 03 must define entry shape to enforce against it, this seed is not additive. Pin a stable shape (e.g. one behavior per line/bullet) so 03 adds only a check. The behavior→intent matching rule may remain deferred to 03 as enforcement-side.

## Required clarifications

**3. State where `ready-intents/` resolves and what repo the intent PR targets.**
`jarvis intent` is a general top-level mode, but the spec defines output only as "sibling of `wip-intents/`," which presupposes that dir exists. The mode inherits none of `spec-guidance.md`'s resolution machinery (targetDir, project root, no-commit storage) explicitly. State the output-dir resolution (e.g. reuse `plan.targetDir`) and the PR target. These are semantic decisions, not the naming detail 01 currently defers to first consumer.

**4. Reword 00's first acceptance criterion to grade prompt text, not runtime.**
00's first AC claims the prompt "drafts an N-way split" — a runtime behavior unverifiable with 00 alone (00 itself notes the invoking command lands in 01). Regrade it as the prompt *instructing* an N-way split (text-level), consistent with 00's other ACs; move any runtime observation to 01. *(Rationale: subspec atomicity — each subspec must be independently testable.)*

**5. Specify emitted-intent filename derivation and collision handling.**
How the N filenames are derived, and what happens on re-running a seed or fanning two seeds into one `ready-intents/`, is unstated. Note: emitted-intent dependency is carried by `Prerequisites`, not by numeric filename ordering — do not add ordering prefixes to emitted intents (the "01→02→03" ordering applies only to the three seed files, not the fan-out output).

**6. Address the N=1 degenerate case.** One line: whether a single-behavior judgment is valid, an error, or skips fan-out.

**7. Handle splitter exhaustion / unparseable output.** Since "reuse" is asserted, add one AC covering splitter quota exhaustion or invalid output, so the reuse claim is honest about failure paths.

**8. State the raw-seed lifecycle.** One line on whether the `wip-intents/` seed is consumed, moved, or left in place after fan-out.

## Not upheld

- Splitting `v1-behaviors.md` into 01 only is correct: 00 adds net-new conventions (sizing rule, `ready-intents/`), not a change to existing documented behavior; the mode-behavior record belongs in 01.