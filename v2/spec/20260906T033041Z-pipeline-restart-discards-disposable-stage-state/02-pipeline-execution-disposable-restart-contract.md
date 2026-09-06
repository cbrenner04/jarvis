# Pipeline execution disposable restart contract

## Problem

`v2/docs/pipeline-execution.md` cross-links shared `disposableLane` gates but defers pipeline-restart caller wiring, structural disposable validation, and the full operator contract to this spec.

## Decision ledger

- `pipeline-execution.md` owns the execution-layer disposable restart contract; operator-runbook prose stays operator-facing and cross-links here for admission detail; rules out duplicating gate-order tables in both files.
- Document structural never-landed classification, `disposableLane` threading on failed-plan resume, draft-tree versus landed operator-blocker handling, and which refusals stay unconditional; rules out leaving the prior cross-link-only deferral in place.

## Task checklist

- Replace the disposable-lane deferral sentence in `v2/docs/pipeline-execution.md` § dispatch / stale-reset preflight and § Operator recovery failed-plan resume with the full restart disposal contract: never-landed classification, `disposableLane` marker, draft-tree operator-blocker discard, landed-blocker and unlanded-commits refusals, and preserved live-claim / operator-dirt gates.
- Cross-link `v2/docs/operator-runbook.md` § Pipeline resume for operator steps.

## Acceptance criteria

- [ ] `v2/docs/pipeline-execution.md` documents disposable-state boundary at restart, structural never-landed classification, `disposableLane` wiring on failed-plan resume, and landed versus draft-tree operator `## Blocker` handling.

## Documentation updates

- `v2/docs/pipeline-execution.md` — disposable-state boundary at restart; landed versus draft-tree operator `## Blocker` handling.
