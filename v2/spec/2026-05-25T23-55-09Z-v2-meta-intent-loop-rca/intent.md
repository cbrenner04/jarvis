---
name: v2-meta-intent-loop-rca
---
# Root-cause investigation: v2 meta-intent loop (PR #153)

## Trigger
PR #153 ("First Write Step, End-to-End", by gpt-5.3-codex via Jarvis, branch
`2026-05-25T21-52-57Z-first-write-step-e2e`) shipped **zero code**. All 6 changed
files are Markdown: 2 docs (`v2-architecture.md`, `v2-build-order.md`), 3 subspecs,
and `index.md`. Patch mode "completed" the spec by editing the spec's own prose and
ticking every acceptance box, including the index.

## The pathology
The spec's acceptance criteria are all self-referential — *"The spec states…",
"The spec defines…"*. So patch mode satisfied them the only way possible: by typing
those sentences into the spec, then checking the box that verifies the sentence is
present. Circular. No `v2/src`. The doc edits were the same prose copied outward.

## Root cause (traced upstream, in order)
1. **Self-referential acceptance criteria** — nothing in `spec-guidance.md` or
   `prompts/plan/draft.md` forbids criteria that grade the spec's own text.
2. **The seed intent was a meta-intent** — `v2/spec/wip-intents/the-next-phase-in.md`
   opens with *"Draft the next implementation spec…"* and is written in "the spec
   should…" voice throughout. `jarvis plan` **is** the spec-drafter, so an intent
   that asks it to "draft a spec" produces a spec whose deliverable is another spec.
3. **THE SOURCE — the meta-index header.** `v2/spec/v2-meta-index.md` line 3:
   > "each phase becomes its own dated spec under `v2/spec/` when implementation
   > begins. Check a phase when its spec is complete and merged."

   This frames the unit of work as a *spec* and defines **done = spec merged**, not
   code shipped. When the user says "do next", the inline-draft pass (which does
   "inspect the repo for guidance") reads this and writes a planning-voiced intent.
   Every downstream symptom follows mechanically.

## The chain
```
meta-index header (deliverable = "a dated spec", done = "spec merged")
  -> "do next" -> inline-draft reads header -> writes meta-intent ("draft the spec")
    -> jarvis plan plans the planning -> spec whose criteria grade prose
      -> jarvis run "implements" -> types the prose, ticks boxes -> no code
```
This is the user's existing memories made concrete: `plan-refine-precision-amplifier`
and `v2-build-order-walking-skeleton`.

## Proposed fix (the source)
Reframe the meta-index header so a phase's deliverable is **merged code in `v2/src`**,
`jarvis1 plan` is just the drafting step, and done = implementation merged. Draft:
> "One item per phase. A phase's deliverable is working, merged code in `v2/src` —
> not a spec. To start one: hand its build brief — this phase line plus the matching
> section in `v2-build-order.md` — to `jarvis1 plan`, which drafts the implementation
> spec; `jarvis1 run` then implements it. Write the intent as what to *build*, never
> as 'draft a spec' (`jarvis1 plan` is the spec-drafter). Check a phase only when its
> implementation is merged."

Secondary (optional safety net): plan `draft.md`/`refine.md` rule banning
self-referential acceptance criteria — criteria must verify code/tests/docs/behavior
outside the spec tree.

## Key facts learned
- `jarvis` -> v2 CLI (`v2/src/cli.ts`); only `--version`, else prints "v2 not ready".
  No `plan` command. Plan mode is **`jarvis1`** (`v1/src/cli.ts`).
- `jarvis` project config: `plan.commit=true`, `targetDir="v2/spec"`,
  `specTimestamp=true`; agentOrder = codex/gpt-5.4, cursor, aider.
- Inline plan (`plan.ts:676`): writes one untracked file
  `v2/spec/wip-intents/<first-4-words-kebab>.md`, runs the inline-draft agent in
  `project.root` on the current branch. **No commit, no PR, no worktree.** Returns 0.
- The meta-index in the `.worktree/...first-write-step-e2e/` copy is byte-identical
  to main (old framing). Working tree is clean; no fix applied yet (the meta-index
  edit was proposed but rejected).

## Measurement plan (chosen by user, not yet run)
Validate the fix by re-running an inline intent and checking the generated wip-intent
is execution-voiced (leading indicator; full proof is eventual code). Command:
```
jarvis1 plan "the next phase of .worktree/2026-05-25T21-52-57Z-first-write-step-e2e/v2/spec/v2-meta-index.md"
```
Open decision: run baseline first (current unfixed framing) vs apply the meta-index
fix first, then run.

## Open follow-ups
- Apply the meta-index reframe (directly vs spec-first — TBD).
- Scrap PR #153 + the `first-write-step-e2e` spec dir (meta-spec, not salvageable).
- Optional plan-prompt hardening against self-referential criteria.
- Candidate memory: "v2 phase done = merged code, not merged spec; meta-index header
  was priming meta-intents; 'do next' intents must be execution-voiced build briefs."

## Refinement

- Split the eventual work into one subspec for the source reframe and one subspec for prompt hardening; they touch different durable homes and are independently reviewable.
- The source-reframe subspec should update `v2/spec/v2-meta-index.md` plus every durable workflow doc made false by the new framing.
- Durable doc homes for the source reframe are `v1/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md`; `v2/spec/v2-meta-index.md` alone is not the durable workflow record.
- Treat `v2/spec/wip-intents/*.md` as generated evidence, not the durable place to fix this behavior.
- Treat `v2/spec/2026-05-25T21-52-57Z-first-write-step-e2e/` as evidence only; do not salvage or edit the meta-spec as part of the source fix.
- If prompt hardening is taken, update `prompts/plan/inline-draft.md`, `prompts/plan/draft.md`, and `prompts/plan/refine.md` together so inline seeding, refine, and draft enforce the same anti-meta rule.
- If prompt hardening is taken, update the prompt snapshots/tests that cover those templates; prompt text is exercised under `v1/test/modes/plan/prompts.test.ts`.
- Define the anti-self-reference rule in terms of verifiable target state outside the active spec tree; banning only the phrase "the spec" is too weak.
- Baseline reproduction is already captured by PR #153 plus the current generated wip intent; the first validation run should happen after the source reframe, not before.
- Keep the validation step as evidence for the fix, not as the only acceptance gate; the real change is the durable framing and prompt contract.
- Deferred to first consumer: whether anti-meta enforcement stays prompt-only or also gains validator code — pin when the hardening subspec is drafted.

## Refine skip

No net-new refinement; repo scan only confirmed the existing ledger.
