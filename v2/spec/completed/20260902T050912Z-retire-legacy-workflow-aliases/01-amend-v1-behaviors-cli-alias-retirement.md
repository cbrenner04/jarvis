# Amend v1-behaviors CLI alias retirement

## Problem

`v2/docs/v1-behaviors.md` still records legacy reviewed alias strings as accepted CLI workflow names and as dispatchable despite help-tree absence. Subspec 00 retires that admission path; the parity catalog must record the new CLI boundary without rewriting operator-facing alias prose deferred to `align-docs-after-write-retirement`.

## Decision ledger

- Amend only CLI-admission and help-dispatch prose in `v2/docs/v1-behaviors.md`; rules out repo-wide operator-doc alias cleanup in this spec.
- Preserve internal preset-name mentions where they describe pipeline or execution preset resolution, not CLI admission; rules out stripping `workflow-presets.ts` preset vocabulary from execution sections.

## Task checklist

- Update `### v2 workflow CLI names` so legacy reviewed alias strings are rejected at CLI admission and canonical `intent` / `plan` / `implement` with review flags remain the operator path.
- Update the help-tree bullet that claims legacy aliases remain dispatchable.
- Update the `jarvis run workflow <name>` admission bullet so unknown names match `WORKFLOW_USAGE` and retired alias strings are not registered CLI names.
- Run `bun run lint:md` on the edited file.

## Acceptance criteria

- [x] `v2/docs/v1-behaviors.md` records that `run workflow intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` are rejected at CLI admission and no longer lists them as accepted CLI workflow names; the pre-fix overview and admission bullets at `v2/docs/v1-behaviors.md` still claim alias acceptance reachable on main.
- [x] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — minimal CLI-admission retirement note; operator-doc alias prose deferred to `align-docs-after-write-retirement`.
