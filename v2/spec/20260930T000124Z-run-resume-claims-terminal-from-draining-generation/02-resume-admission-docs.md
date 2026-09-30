# Resume admission docs separate projection from owner-stamp claim

## Problem

Operator docs currently conflate `run list` / `wait` `resumable` ( `resolveRunResumeAdmission` ) with owner-stamp admission (`admitRunForResume`), implying a row advertising `resumable: true` is always admitted on `run resume`. Terminal rows owned by a still-live draining generation violated that until the store terminal-peer claim path exists.

## Decisions

- Document terminal peer claim only in the durable homes named in the intent; cross-link between daemon-host, operator-runbook, and state-store instead of duplicating full prose; rules out a new standalone doc file.
- Update the existing v1-behaviors run re-admission bullet to note terminal rows may claim from a live peer generation; rules out leaving the baseline claiming every live different owner always refuses.

## Tasks

- [ ] Align `v2/docs/daemon-host.md` resume / supersession wording: projection admission vs `admitRunForResume` terminal peer claim.
- [ ] Fix `v2/docs/operator-runbook.md` list/wait vs `run resume` layers; note non-terminal peer-owned rows still refuse `owner_alive`.
- [ ] Document `admitRunForResume` terminal peer gate in `v2/docs/state-store.md`.
- [ ] Extend `v2/docs/v1-behaviors.md` run re-admission entry for terminal peer claim.

## Acceptance criteria

- [x] `v2/docs/daemon-host.md` states terminal run resume may claim rows from draining generations via `admitRunForResume` and does not conflate `resumable` projection with owner-stamp refusal.
- [x] `v2/docs/operator-runbook.md` distinguishes list/wait projection from owner-stamp admission and matches terminal peer claim plus non-terminal `owner_alive` refusal.
- [x] `v2/docs/state-store.md` documents the `isTerminalRunStatus` gate on live-peer refusal in `admitRunForResume`.
- [x] `v2/docs/v1-behaviors.md` run re-admission entry records terminal peer claim behavior.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal run resume claims rows from draining generations via `admitRunForResume`; correct resume-row wording so `resumable` projection (`resolveRunResumeAdmission`) is not conflated with owner-stamp admission.
- `v2/docs/operator-runbook.md` — fix list/wait vs `run resume` admission overclaim (~resume row / owner-stamp layer); align with `admitRunForResume` terminal peer claim; non-terminal peer-owned rows still refuse `owner_alive`.
- `v2/docs/state-store.md` — `admitRunForResume` terminal peer claim behavior (`isTerminalRunStatus` gate).
- `v2/docs/v1-behaviors.md` — run re-admission owner-stamp entry.
