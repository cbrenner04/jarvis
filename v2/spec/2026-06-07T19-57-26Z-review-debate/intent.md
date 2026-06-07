---
name: review-debate
---

# Intent: structure review as adversary → defense → judge → executor

Restructure review (the unified mode behind plan + patch) from N identical
critique passes into a debate. Four roles — three **read-only** reviewers, then a
separate **executor** that writes:

1. **Adversary** (read-only) — reviews the subject hard, writes a findings artifact.
2. **Defender** (read-only) — reads findings, writes a rebuttal artifact.
3. **Judge** (read-only) — reads both, reconciles, emits a **verdict**: the
   upheld findings written as a standalone instruction for the executor. Work to
   apply, not a mutation.
4. **Executor** (writes) — the *only* writer. Runs the verdict as its task.
   Per mode: patch → the patch loop; plan → the refine loop.

## Why debate, not N passes

- **Adversary/defender is the value, not just the judge-as-filter.** Genuine
  opposing roles surface and stress-test findings that N independent critique
  passes don't — each independent pass re-derives from scratch and tends to
  invent precision. The judge then reconciles *in-band*, which is more honest
  than the harness adjudicating materiality (see
  [[plan-refine-precision-amplifier]] — cure manufactured findings with prompt
  permission to find nothing, not control flow).
- **No self-vindication.** A judge that writes its own fix grades its own
  homework. Splitting judge from executor lets the executor's output re-enter the
  debate (recursion for free).
- **Role/model split.** Reviewers are *reviewing*-class work; the executor is
  *executing*-class. One role would force one model to do both — the conflation
  [[separate-models-from-agents]] exists to avoid.
- **No hand-edits by review.** Review emits work; the executor applies it. Same
  rule the repo already follows (specs run through jarvis, not implemented by
  hand) — applied recursively.

## Shape

Debate is a **review-mode capability**, not patch-specific. The split:

- **Shared (review engine):** the role sequence adversary → defender → judge →
  verdict. All three reviewers are read-only; each pass injects the prior role's
  artifact as prompt context via the existing `adapterForPass` seam. No new engine.
- **Per mode (adapter/caller):** role prompts (review a diff vs. a spec draft),
  the write boundary (already inverted: patch must not touch the spec, plan may
  only touch it), and the **verdict executor**.

The verdict is the seam between review and the executor:

- **Verdict = the executor's task.** The judge writes the instruction the
  executor runs directly — not findings the harness translates. It replaces the
  loop's usual "pick the most important unchecked item" for that invocation.
- **Outcome altitude, not diff altitude.** The judge says *what must be true and
  why* ("`parseConfig` silently returns `{}` on malformed JSON; it must surface
  the error and abort"), never *how* ("wrap line 42 in try/catch"). If the judge
  writes the diff it's executing-class work in a reviewing role — back to
  self-vindication; the split only pays off when the executor independently
  decides how, and that diff re-enters the next debate. Enforced by prompt, not a
  gate (you can't mechanically stop a judge from over-specifying — instruct and
  trust).
- **Self-contained.** The executor is a fresh agent with no debate memory; the
  verdict must restate the upheld findings and required outcomes, never "see the
  adversary artifact."
- **Per-cycle.** The verdict drives one executor run, then the next cycle's
  adversary reviews the changed subject fresh. It does not carry forward.

Other shape decisions:

- The verdict artifact is both the committed debate trail and the executor's
  input — no separate sentinel. Commit each role (`review: adversary` /
  `defense` / `judge` / `executor`); empty verdict → no executor run, no commit
  (existing no-change skip).
- Cycle count is just the existing review pass setting. No special bounds.

## Sequencing (subspecs)

1. **Review** — add the debate role-shape to the review mode: read-only
   adversary/defender/judge passes, verdict artifact, and the injected-executor
   seam. Mode-agnostic.
2. **Patch** — wire the patch loop as the verdict executor + patch role prompts.
   Easiest first: the executor (patch loop) already exists.
3. **Plan** — wire the refine loop as the verdict executor + plan role prompts.
   Plan review writes inline today, so this introduces the verdict → refine seam
   that doesn't yet exist.

## Documentation updates

- v1 change only. Document the new review behavior (debate roles, verdict-as-task)
  in `v2/docs/v1-behaviors.md` so the eventual v2 review port inherits it.

## Philosophy (locked)

Less is more — trust the agents.

- **No materiality gate, no convergence/stop-on-empty logic.** Nothing to find →
  the roles say so, the verdict is empty, no executor runs. The harness does not
  adjudicate whether a finding is "real" — that's the judge's job, in-band.

## Open

- Distinct agents per role vs. one agent in different role-prompts (genuine
  adversarialism vs. quota/fallback cost). At minimum the executor should differ
  in *model class* (executing) from the reviewing roles.
- Where debate artifacts live so they don't pollute the subject (a review-scratch
  path committed on the branch?) — patch's branch is the PR branch, so trail
  files would ship in the PR unless scoped.
- The verdict → task seam in the patch loop: feeding an injected task in place of
  spec-checklist selection is a change to the loop's input contract (patch
  subspec's central job).

## Out of scope

- Any convergence/materiality detection in the harness.

## Refine skip

No net-new load-bearing decision to add. The seed already carries the full
ledger, philosophy lock, and sequencing. The three `## Open` items each belong
to a first consumer — artifact location and the verdict→task input-contract seam
are the patch subspec's calls; per-role agent distinctness defaults to reusing
the existing pass/fallback selection. Resolving them in this non-interactive pass
would fabricate the human's or drafter's decision, not capture one.
