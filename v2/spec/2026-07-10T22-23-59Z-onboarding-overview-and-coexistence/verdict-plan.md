## Verdict — refine before landing

The draft is sound in structure and home (`v2/docs/onboarding.md`, glob scoping, link-first vocabulary all concur). Five findings are upheld; two block. Refine as follows.

### Blocking

1. **The "first-run walkthrough" link target is undefined and unreachable on `main`.**
   The intent lists the first-run walkthrough as a destination distinct from install, but no walkthrough doc exists in `v2/docs/` on `main` — it lives only on an unmerged branch. `markdownlint-cli2` does not check dead relative links (MD051 off), so AC 7 (`lint:md` passes) gives false assurance while the page ships a silent dead link. The spec must resolve this, not defer it — the consumer is the reader and the link is load-bearing. Either (a) name the exact target path and record a merge-ordering decision that gates this spec on that doc existing, or (b) point the walkthrough reference at a destination that exists on `main` today (e.g. the README Quickstart) and defer the `v2/docs/` walkthrough link to when that doc lands. Add the walkthrough dependency to Prerequisites either way.

2. **AC 5 collapses "first-run walkthrough" into the README Quickstart.**
   Its parenthetical lets an implementer satisfy the walkthrough requirement with only a README Quickstart link and never link a distinct walkthrough — contradicting the intent's separate destinations. Reconcile with #1: pick one definition of "walkthrough," and make Decisions and AC 5 name the same target consistently.

### Correctness / completeness

3. **"When to reach for each" has no stated content and risks invented precision.**
   AC 2 mandates the page say when to use each binary, but neither Decisions nor ACs supply the answer, and v2 currently answers only `v2 not ready`/`--version`. Leaving this blank invites a fabricated daily-use case for capability that doesn't exist. The honest answer is essentially determined ("today: always `jarvis1`; `jarvis` is opt-in, in-progress, nothing to adopt yet") — the spec should state it in a decision rather than leave the implementer to guess. (Per the deferral principle: don't invent precision, but here the answer is fixed, so pin it.)

4. **Adding `v2/docs/onboarding.md` to the globs makes existing README linting prose stale.**
   The README "Markdown linting" section enumerates linted surfaces (`v1/spec/`, `v1/docs/`, `reports/`, root docs) and omits `v2/docs`. The glob change makes that sentence inaccurate. Add this paragraph to Documentation updates so the repo stays internally consistent about `lint:md` coverage.

### Minor

5. **Orientation-vs-README ownership.** The onboarding page legitimately restates the one-line framing ("drives a coding-agent CLI; does not implement an agent") that also opens the README — normal front-door redundancy, not the drift the link-first decision targets (that decision governs vocabulary definitions, which the spec correctly links out). No redesign needed. Add one decision naming which prose is canonical so a future editor knows the onboarding page owns the orientation framing.

Not upheld / cosmetic: Task-checklist–vs-AC redundancy is a known deferred format matter, not a defect — no action required.