---
name: run-resume-refused-while-draining-generation-owns-terminal-row
---

# Run resume refused while a draining generation owns the terminal row

## Problem

`StateStore.admitRunForResume` (`v2/src/persistence/state-store.ts` ~2995–3005) refuses `owner_alive` whenever the row's `owner_identity` differs from the current generation and that owner PID is alive — even when the row is terminal. After a v2/src merge the prior generation keeps draining its other admitted work (can take hours), so every terminal row it stamped is un-resumable from the stable generation. `run list` still projects `resumable: true` / `nextAction: resume` (the projection at `daemon-run-lifecycle-handlers.ts` ~601 uses dispatch admission, not owner liveness). Unlike pipeline decisions (`createStablePipelineDecisionHandlers`, #4153), `run_resume` has no claim-from-draining-generation path. No operator flag or verb clears it; only waiting for the old generation to exit.

Evidence (2026-09-29): 3 live generations (58814 oldest, 55502, 47930 stable). Runs `2217f2e1-6838-46f0-a135-fe8210317f96` and `97f49f6e-a7f6-4994-af54-2254b9146b21` (both `failed`/`iteration_timeout`, `resumable: true`) carry `owner_identity = 58814:1790719411185`; `jarvis run resume` on each returned `owner_alive`.

## Decisions

- A terminal row owned by a live peer generation is not in flight; the stable generation may claim it on resume (CAS on `owner_identity`, as today).
- Non-terminal rows owned by a live peer keep refusing `owner_alive`.
- Reuse the #4153 stable-endpoint claim pattern; no new flag.

## Acceptance criteria

- [ ] `admitRunForResume` admits a terminal row whose different owner is alive, rewriting `owner_identity` to the current generation.
- [ ] `admitRunForResume` still refuses `owner_alive` for a non-terminal row whose different owner is alive.
- [ ] Concurrent claim of the same terminal row admits exactly one caller (other gets `claim_lost`).
- [ ] `run list` `resumable` agrees with `admitRunForResume` for a terminal peer-owned row (test covers both).
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — run resume claims terminal rows from draining generations.
- `v2/docs/operator-runbook.md` — drop any "wait for old generation" advice for terminal-row resume.
