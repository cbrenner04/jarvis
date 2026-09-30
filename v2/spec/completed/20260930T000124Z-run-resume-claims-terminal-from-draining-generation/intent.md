---
name: run-resume-claims-terminal-from-draining-generation
---

# Run resume claims terminal rows from a live draining generation

Unsplit rationale: the claim-from-peer behavior is implemented entirely in `StateStore.admitRunForResume`; daemon `resume` already calls that store admit after `resolveRunResumeAdmission` passes, and `list`/`wait` `resumable` comes only from the projection gate — no separate stable-routing wrapper.

## Primary implementation surface

- `v2/src/persistence/` run resume admission (`admitRunForResume`)

## Prerequisites

## Problem

After a `v2/src` merge the prior generation keeps draining for hours while terminal rows it stamped stay un-resumable from the stable generation: `admitRunForResume` refuses `owner_alive` whenever a different owner is alive, even when the row is terminal. `run list` still projects `resumable: true` via `resolveRunResumeAdmission` while `jarvis run resume` fails at the second layer (`admitRunForResume`) with `owner_alive`. Pipeline decision verbs already claim from any live draining generation (#4153); run resume has no terminal-row claim path.

## Decisions

- Terminal for this claim path means `isTerminalRunStatus` / `TERMINAL_RUN_STATUSES` only; `paused`, `queued`, `in-progress`, and `budget-soft-stopped` are non-terminal and keep refusing `owner_alive` when a live peer owns the row.
- A terminal row owned by a live peer generation is not in flight; the stable generation may claim it on resume (CAS on `owner_identity`, as today).
- Non-terminal rows owned by a live peer keep refusing `owner_alive`.
- Reuse the existing CAS claim write; no new operator flag.
- Replace or update `state-store.test.ts` `"refuses owner_alive …"` (today pins `status: "failed"` with a live peer) so the suite does not contradict the new terminal-peer admit contract.

## Acceptance criteria

- [ ] A regression test in `v2/src/persistence/state-store.test.ts` proves `admitRunForResume` admits a terminal row whose different owner is alive, re-stamping `owner_identity` and clearing terminal fields; it fails against the pre-fix unconditional `owner_alive` refusal (including the prior `failed` + live-peer pin).
- [ ] A regression test in `v2/src/persistence/state-store.test.ts` proves `admitRunForResume` still refuses `owner_alive` for a non-terminal row (`paused` or `in-progress`) whose different owner is alive, leaving `owner_identity` and status unchanged; it fails if non-terminal peer-owned rows stop refusing.
- [ ] A regression test in `v2/src/persistence/state-store.test.ts` proves concurrent claims of the same terminal peer-owned row admit exactly one caller and return `claim_lost` to the other; it fails against the pre-fix refusal path.
- [ ] A regression test in `v2/src/daemon/daemon-run-resume-owner-stamp.test.ts` proves `run resume` succeeds when `run list` shows `resumable: true` for a terminal peer-owned row; it fails against the pre-fix store `owner_alive` refusal after list already advertised resume.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal run resume claims rows from draining generations via `admitRunForResume`; correct resume-row wording so `resumable` projection (`resolveRunResumeAdmission`) is not conflated with owner-stamp admission.
- `v2/docs/operator-runbook.md` — fix list/wait vs `run resume` admission overclaim (~resume row / owner-stamp layer); align with `admitRunForResume` terminal peer claim; non-terminal peer-owned rows still refuse `owner_alive`.
- `v2/docs/state-store.md` — `admitRunForResume` terminal peer claim behavior (`isTerminalRunStatus` gate).
- `v2/docs/v1-behaviors.md` — run re-admission owner-stamp entry.
