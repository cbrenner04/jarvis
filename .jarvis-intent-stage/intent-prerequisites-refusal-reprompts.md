---
name: intent-prerequisites-refusal-reprompts
---

# Prose Prerequisites refusal triggers the in-loop landing reprompt

Surface: execution write loop landing-contract handling (`v2/src/execution/write-loop.ts`).

## Problem

A Prerequisites-format refusal settled the intent review row `landing_failed` immediately; `run resume` replayed the same refusal and the pipeline went terminal `failed` instead of reprompting the agent to fix the file.

## Decisions

- The prose-Prerequisites refusal is classified as a landing-contract violation and fed to the existing in-loop landing reprompt (`landing_contract_reprompt`), settling `landing_failed` only on reprompt-budget exhaustion.

## Acceptance criteria

- [ ] A test proves a staged ready-intent with a prose (non-`none`) Prerequisites body emits `landing_contract_reprompt` carrying the refusal instead of settling `landing_failed` on first failure; it fails against the pre-fix code.

## Documentation updates

- `v2/docs/write-behavior.md` (or the doc owning landing-contract reprompts) — list the Prerequisites-format refusal among reprompted violations.

## Prerequisites

- Intent landing drops an empty or `none` Prerequisites section and still refuses other prose bodies.
