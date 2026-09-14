---
name: resuming-a-failed-link-row-runs-the-whole-workflow
---

# `run resume` on a failed `implement~link-N` row publishes with no shrink and no review

## Problem

`jarvis run resume` routes only `paused` linked-implement rows through the linked/workflow resume path (`v2/src/daemon/daemon-run-lifecycle-handlers.ts:407`). A resumable `failed` link row (e.g. `gate_invocation_refused`, whose documented recovery *is* `run resume`) falls through to the bare write-loop resume (`:416-457`, `spawnWriteLoop` at `:1218`). That loop runs against the index, completes the remaining subspecs, and publishes the PR itself — skipping linked finalization, `implement~shrink`, and `implement-review`. The invocation then has no successor rows, so its roll-up reads `killed` (`workflow-run-status-rollup.ts:88-89`): `run wait` misreports, stage settlement misreads, and no operator incident is derived. A lane recovered by the documented command ships unreviewed and looks dead.

## Evidence (2026-09-14)

Run `f2e8783a` (`20260914T211904Z-specs-home-path-builder`): three `gate_invocation_refused` (`slot_contention`) settlements, each recovered with `jarvis run resume`; the fourth dispatch completed both subspecs and published [#3916](https://github.com/cbrenner04/jarvis/pull/3916) (logs.jsonl seq 23) with no `~shrink` or `implement-review` row, and no completion notification. The store holds two earlier rows of the same shape: `854d55f2` → [#3787](https://github.com/cbrenner04/jarvis/pull/3787), `d707f38b` → [#3588](https://github.com/cbrenner04/jarvis/pull/3588).

## Decisions

- A resumable non-paused `<step>~link-N` row resumes through the same linked/workflow path as a paused one, so the workflow's remaining links, shrink, and review run and publication stays at the workflow tail.
- If that reconstruction is unavailable, `run resume` refuses naming the recovery, rather than falling back to the bare write loop.
- The bare write-loop resume remains only for rows with no workflow snapshot (`run start`).

## Acceptance criteria

- [ ] A test proves `run resume` on a `failed` `gate_invocation_refused` `implement~link-0` row continues through linked finalization, `implement~shrink`, and `implement-review`, and publication happens once at the tail; it fails against the pre-fix bare write-loop resume.
- [ ] A test proves the resumed invocation's roll-up reads `completed` (not `killed`) and derives a terminal incident.
- [ ] A test proves a link row whose workflow resume context cannot be reconstructed is refused with a named reason, not run through `spawnWriteLoop`.

## Documentation updates

- `v2/docs/operator-runbook.md` — `gate_invocation_refused` recovery and link-row resume semantics.
