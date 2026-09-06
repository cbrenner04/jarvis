---
name: plan-contract-classifies-the-rules-out-clause
---

# The plan-contract surface classifier reads a Decisions bullet's mandated `rules out` clause as a second surface

## Problem

Spec guidance requires every `## Decisions` bullet to end with a `rules out <the alternative>` clause. `classifyModuleBoundaryText` classifies the **whole bullet**, including that clause — so a decision about one surface that rules out an alternative on another surface is condemned as multi-surface, and the plan blocks `contract_miss` (non-resumable, `nextAction: inspect_spec`).

This makes the gate structurally hostile to the format it mandates: naming the alternative you are *not* taking is exactly what the clause is for, and the alternative usually lives on the surface the decision is moving away from.

## Evidence (2026-09-06, run `ed1b6471`)

Standalone `plan` on `daemon-linked-run-row-resume-admission` blocked on subspec 01:

> Plan subspec `01-owning-write-row-completion-commit-failed-admission.md` has a multi-surface `## Decisions` bullet: `Daemon resume admits owning write-row completion_commit_failed through resumeFinalizationOnly → resumeReviewMutationFinalization (publication-tail replay), checked ahead of resumeContextForTerminalRecord/spawnWriteLoop; rules out write-loop re-entry for a failure that already finished the write/shrink agent pass.`

Classified directly against `shared/module-boundary-surfaces.ts`:

```text
full bullet                                                      -> [ "daemon", "execution-loop" ]
"Daemon resume admits owning write-row completion_commit_failed" -> [ "daemon" ]
"resumeFinalizationOnly"                                         -> []
"resumeReviewMutationFinalization"                               -> []
"resumeContextForTerminalRecord"                                 -> []
"spawnWriteLoop"                                                 -> []
"rules out write-loop re-entry"                                  -> [ "execution-loop" ]
"write/shrink agent pass"                                        -> []
```

The decision text alone is single-surface `daemon`. **`execution-loop` comes only from the `rules out` clause** — the bullet is condemned for correctly naming what it rejects. Note also that none of the actual daemon symbol names match anything; classification rides entirely on English prose.

The draft was otherwise sound (three atomic subspecs, correct prerequisites, ACs naming tests that exist at the cited lines) and was hand-landed as [#3524](https://github.com/cbrenner04/jarvis/pull/3524). This is the second consecutive session the plan lane tripped the contract-miss gate, so the circuit-breaker fired.

Distinct from #3383, which is the same classifier over-matching on a bare common word (`cli` ← "flag") in the *decision* half. Both are false positives from the same function; this one is structural rather than lexical, and every well-formed bullet is exposed to it.

## Decisions

- Surface classification of a `## Decisions` bullet applies to the decision clause only; the `rules out …` justification clause is excluded from the multi-surface determination; rules out the mandated format condemning itself.
- Clause splitting keys on the `rules out` marker the format already requires, not on sentence punctuation; a bullet with no such clause classifies as today; rules out a heuristic that silently changes classification for bullets not using the format.
- The `contract_miss` message quotes the classified substring and names the surface each match came from, not just the whole bullet and a surface list; rules out an operator having to re-derive classification by hand to see which words condemned the bullet (this session's diagnosis took a manual `classifyModuleBoundaryText` call).
- A plan-contract miss on a draft that is otherwise complete reprompts before blocking, consistent with [[plan-draft-contract-miss-reprompts-before-blocking]]; rules out a non-resumable block on a correctable prose nit.

## Acceptance criteria

- [ ] A test proves a Decisions bullet whose decision clause is single-surface and whose `rules out` clause names a different surface classifies as single-surface and passes the plan contract; it fails against the current whole-bullet classification (fixture: the run `ed1b6471` bullet above).
- [ ] A test proves a bullet whose **decision clause** is genuinely multi-surface still fails the contract; it fails against a fix that simply stops classifying bullets.
- [ ] A test proves a bullet with no `rules out` clause classifies exactly as it does today.
- [ ] A test proves the `contract_miss` message names the offending substring and the surface each match derived from.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — that the `rules out` clause is exempt from surface classification.
- `v2/docs/operator-runbook.md` — reading a plan `contract_miss` message; retire the manual `classifyModuleBoundaryText` diagnosis step.
- `v2/docs/v1-behaviors.md` — record decision-clause-only classification.
