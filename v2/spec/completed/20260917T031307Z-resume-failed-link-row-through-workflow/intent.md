---
name: resume-failed-link-row-through-workflow
---

# `run resume` on a failed `<step>~link-N` row resumes through the workflow, not the bare write loop

Unsplit rationale: the fix is one routing decision in daemon resume handling; roll-up, incidents, and publication follow from the workflow successors it restores.

## Primary implementation surface

- `v2/src/daemon/daemon-run-lifecycle-handlers.ts` — resume admission/routing for linked write steps.

## Problem

`run resume` routes only `paused` link rows through linked resume (`daemon-run-lifecycle-handlers.ts`, `run.status === "paused" && matchesLinkedSiblingStepId`). A resumable `failed` link row (e.g. `gate_invocation_refused`, whose documented recovery is `run resume`) falls to the bare write loop, which completes remaining subspecs and publishes itself — skipping linked finalization, `implement~shrink`, and `implement-review`. With no successor rows the roll-up reads `killed`, so `run wait`, stage settlement, and incident derivation all misreport. Evidence: `f2e8783a` → #3916, `854d55f2` → #3787, `d707f38b` → #3588.

## Decisions

- A resumable non-paused `<step>~link-N` row resumes through the same linked/workflow path as a paused one; remaining links, shrink, and review run, and publication stays at the workflow tail.
- If linked resume context cannot be reconstructed, `run resume` refuses with a named reason and recovery; no fallback to the bare write loop.
- Bare write-loop resume remains only for rows with no workflow snapshot (`run start`).

## Acceptance criteria

- [ ] A test proves `run resume` on a `failed` `gate_invocation_refused` `implement~link-0` row continues through linked finalization, `implement~shrink`, and `implement-review`, with publication once at the tail; it fails against the pre-fix bare write-loop resume.
- [ ] A test proves the resumed invocation's roll-up reads `completed` (not `killed`) and derives a terminal incident.
- [ ] A test proves a link row whose workflow resume context cannot be reconstructed is refused with a named reason, not run through `spawnWriteLoop`.

## Documentation updates

- `v2/docs/operator-runbook.md` — `gate_invocation_refused` recovery and link-row resume semantics.

## Prerequisites
