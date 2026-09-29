---
name: run-resume-claims-terminal-from-draining-generation
---

# Run resume claims terminal rows from a live draining generation

Unsplit rationale: the claim-from-peer behavior is implemented entirely in `StateStore.admitRunForResume`; daemon `resume` and `list`/`wait` already consume dispatch admission plus that store admission without a separate stable-routing wrapper.

## Primary implementation surface

- `v2/src/persistence/` run resume admission (`admitRunForResume`)

## Prerequisites

## Problem

After a `v2/src` merge the prior generation keeps draining for hours while terminal rows it stamped stay un-resumable from the stable generation: `admitRunForResume` refuses `owner_alive` whenever a different owner is alive, even when the row is terminal. `run list` still projects `resumable: true` while `jarvis run resume` returns `owner_alive`. Pipeline decision verbs already claim from any live draining generation (#4153); run resume has no terminal-row claim path.

## Decisions

- A terminal row owned by a live peer generation is not in flight; the stable generation may claim it on resume (CAS on `owner_identity`, as today).
- Non-terminal rows owned by a live peer keep refusing `owner_alive`.
- Reuse the existing CAS claim write; no new operator flag.

## Acceptance criteria

- [ ] A regression test in `v2/src/persistence/state-store.test.ts` proves `admitRunForResume` admits a terminal row whose different owner is alive, re-stamping `owner_identity` and clearing terminal fields; it fails against the pre-fix unconditional `owner_alive` refusal.
- [ ] A regression test in `v2/src/persistence/state-store.test.ts` proves `admitRunForResume` still refuses `owner_alive` for a non-terminal row whose different owner is alive, leaving `owner_identity` and status unchanged; it fails if terminal rows stop refusing.
- [ ] A regression test in `v2/src/persistence/state-store.test.ts` proves concurrent claims of the same terminal peer-owned row admit exactly one caller and return `claim_lost` to the other; it fails against the pre-fix refusal path.
- [ ] A regression test in `v2/src/daemon/` proves `run list` `resumable` and `admitRunForResume` agree for a terminal peer-owned row (both allow resume after the store fix); it fails when list advertises resume but store admission refuses.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal run resume claims rows from draining generations via `admitRunForResume`; non-terminal peer-owned rows still refuse `owner_alive`.
- `v2/docs/operator-runbook.md` — drop any "wait for old generation" guidance for terminal-row `run resume`; align the list/wait vs resume admission wording with the owner-stamp layer.
- `v2/docs/state-store.md` — `admitRunForResume` terminal peer claim behavior.
- `v2/docs/v1-behaviors.md` — run re-admission owner-stamp entry.
