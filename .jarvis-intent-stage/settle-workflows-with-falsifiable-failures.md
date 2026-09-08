---
name: settle-workflows-with-falsifiable-failures
---

# Settle workflows with falsifiable failures

## Prerequisites

- Durable run rows and terminal pipeline-stage `failureDetail` round-trip one shared operator failure record with expectation, observation, optional near miss, reissue retryability, and path origin.

## Module-boundary surface

- Execution loop: workflow checks and terminal settlement producers.

## Problem

Intent, plan, and implement settlement paths emit verdicts without the compared facts, collapse absent and malformed authored input, and can advertise recovery that merely repeats a fixed point.

## Behavior

- Existing intent, plan, and implement failure settlements populate the shared record with checkable evidence and honest reissue semantics; authored-document checks include a near miss when a candidate exists but does not match.

## Decision ledger

- Populate expectation and observation where each existing check settles; rules out a later composer reverse-engineering facts from verdict text.
- For authored-document checks, record the closest candidate only when one exists and state no candidate in the observation otherwise; rules out one absent verdict prescribing opposite repairs.
- Derive retryability from whether reissue can change inputs or conditions at that settlement; rules out equating terminal status with a useful retry.
- Mark non-autofixable built-in autofix re-entry as a fixed point and load-sensitive base probes as changeable; rules out `resume` loops and terminal treatment of machine-load flakes.
- Attach path origin at the producer that resolves the path; rules out presentation code treating Jarvis source as operator code.
- Adopt the shared record at existing settlement call sites without rewriting unrelated checks; rules out a repo-wide message audit in this behavior.

## Acceptance criteria

- [ ] Workflow-runner regressions prove representative intent, plan, and implement failures each settle a populated shared failure record; they fail against the pre-fix verdict-only paths.
- [ ] `v2/src/execution/publication-landing.test.ts` proves an unlinked numbered subspec reports an unmatched near-miss index line distinctly from an index with no candidate line; it fails against the pre-fix single `unlinked_numbered_subspec` message.
- [ ] `v2/src/execution/write-loop.test.ts` proves re-entering built-in autofix over unchanged non-autofixable findings settles non-retryable, while a load-sensitive base-ref reproduction probe settles retryable; it fails against the pre-fix inverse projections.
- [ ] An execution regression proves Jarvis-owned and operator-repository failing paths carry distinct origins before rendering; it fails against the pre-fix plain strings.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — operator-facing failures state expectation and observation rather than a bare verdict, with near-miss and path-origin rules.
- `v2/docs/workflow-runner.md` — intent, plan, and implement settlement producer contract.
- `v2/docs/write-behavior.md` — fixed-point versus changeable ready-gate settlement semantics.
- `v2/docs/v1-behaviors.md` — record the changed v2 settlement evidence and retryability behavior.
