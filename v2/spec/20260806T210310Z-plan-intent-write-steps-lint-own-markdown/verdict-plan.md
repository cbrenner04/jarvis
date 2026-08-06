# Verdict: Required refinements

## 1. Fix AC 4 — contradictory fixture semantics

AC 4 currently asks for committed `MD012`/`MD038` violation fixtures while also asserting pre-finalization lint passes. Those cannot describe the same bytes. Refine AC 4 to a single coherent positive-path contract: either lint-clean golden fixtures for the rule families that caused the 2026-08-03 incidents, or a multi-iteration violate-then-fix flow where the final iteration is lint-clean. Remove “violation fixtures” language if the assertion is lint passes. Drop the ready-gate `lint:md` repair clause from this AC (or move gate observation to an integration-scoped AC/file); the named write-loop test cannot verify publication repair.

## 2. Add budget-exhaustion acceptance criterion

The intent and decision ledger require persistent staged-Markdown lint violations through `maxIterations` to settle `landing_failed` with `resumable: true`, `nextAction: "resume"`, and preserved stage bytes — not terminal `contract_miss`. No AC pins this today. Add at least one failing-test AC (plan or intent, or both if paths diverge) naming a test that fails pre-fix and passes post-fix, mirroring landing-contract budget-exhaustion precedent.

## 3. Add plan stage-preservation acceptance criterion

Decisions promise preserved stage bytes on lint reprompt; intent split already has landing-contract preservation precedent, but plan draft reprompt wiring is work-only with no AC. Add an AC that pins plan staging preservation across lint reprompt (e.g. sibling staged files or `intent.md` unchanged when only one file violates), so implementers cannot satisfy reprompt ACs while re-seeding or wiping `.jarvis-plan-stage/`.

## 4. Add intent clean-finalize acceptance criterion

Decisions require symmetric plan/intent contract; AC 2 covers plan only. Add an intent counterpart (or one AC covering both `plan.prompt.draft` and `intent.prompt.split`) asserting one agent invocation and finalize on clean staging, failing if a second lint-only invocation runs.

## 5. Decide reprompt surface explicitly

The decision ledger commits to landing-contract reprompt parity but leaves template and log-event choice ambiguous (“or equivalent”). The existing `write.landing-contract-reprompt` template text is wrong for plan staging and markdownlint misses. Refine decisions to pick one outcome: dedicated staged-markdown-lint prompt and/or log event, or a generalized shared template with documented violation-text format — not implement-time guesswork. Documentation updates must follow the chosen surface (at minimum `workflow-runner.md`; add `prompts.md` / `operator-runbook.md` lines if new prompts or resume semantics apply).

## 6. Add intent-path mutation checkpoint

Spec guidance requires mutation checkpoints for added guards. Only the plan reprompt guard is named. Add an intent-path checkpoint (or a shared-guard checkpoint scoped per path) in the test file with a stable `@mutate` anchor; note in Work that the anchor should be a unique guard line in `write-loop.ts`.

## 7. Clarify intent lint test rule choice

Intent staging runs autofix before shape/landing-contract checks; `MD012` may not survive to the new lint gate. State in Work or AC 3 that the intent violation fixture must use a rule that survives autofix (e.g. `MD038`), or that the test asserts post-autofix violation state.

## 8. Pin shared iteration budget and violation selection

Add brief decision or Work prose: landing-contract and staged-Markdown lint reprompts share `maxIterations` and the same reprompt slot on intent split (at most one reprompt per iteration; landing-contract evaluated first). Inherit landing-contract “first violation wins” and recursive `*.md` under staging root unless a deliberate divergence is documented. Pin offending-file path convention to match existing reprompt tests.

## 9. Add `v2/docs/v1-behaviors.md` to documentation updates

This changes when plan/intent writes may finalize — existing harness behavior per spec guidance. `workflow-runner.md` alone is insufficient; record the new finalize gate in `v1-behaviors.md`.

## 10. Optional but recommended: lint runner fail-closed decision

Pre-finalization lint is a gate, not advisory autofix. Add a decision that markdownlint invocation failures (missing binary, non-zero tool error) fail closed in production paths, distinct from autofix’s fail-open behavior — or accept explicit risk that a broken linter silently passes.

---

**Rationale:** The core seam (lint staged paths before finalize for plan and intent) is sound and aligned with intent. Gaps are contract completeness: several decision-ledger promises lack failing-test ACs (budget exhaustion, plan preservation, intent clean path), AC 4 is internally inconsistent, reprompt UX is under-specified relative to decisions, and spec-guidance obligations (`v1-behaviors.md`, mutation checkpoints, runtime-behavior failing tests) are not fully met. Refinements close the decision↔AC gap without changing the architectural choice. Single subspec remains appropriate — one execution-loop seam, no split required.