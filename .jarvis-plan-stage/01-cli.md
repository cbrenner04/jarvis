# CLI

## Problem

- `jarvis pipeline start` couples reusable admission policy to CLI formatting and attached waiting.

## Decisions

- Keep argument parsing, current failure rendering, pipeline-ID output, detach branching, attached waiting, terminal JSON, and exit-code selection in the CLI adapter; rules out an operator-visible migration with the extraction.

## Task checklist

- Extract the reusable admission input, result, dependency seam, validation, context construction, and `pipeline_start` dispatch from `v2/src/commands/pipeline.ts` into a focused v2 module.
- Refactor `runPipelineStartCommand` into the CLI adapter over that API; retain its attach/detach wait path and formatting.
- Add direct admission coverage for both seed variants, named pre-admission failures, one `pipeline_start`, and zero `pipeline_wait` requests.
- Move rejection coverage to the real extracted guards and add source-mutation directives without production inversion hooks.
- Align the durable CLI boundary and v1 parity catalog.

## Acceptance criteria

- [ ] `v2/docs/write-behavior.md` documents the reusable pre-admission boundary and CLI-owned attach/wait behavior; `v2/docs/v1-behaviors.md` records CLI preservation through the reusable path.

## Documentation updates

- `v2/docs/write-behavior.md` — reusable pre-admission boundary and CLI-owned formatting/attach wait.
- `v2/docs/v1-behaviors.md` — v2 pipeline-start CLI preservation through shared admission.
