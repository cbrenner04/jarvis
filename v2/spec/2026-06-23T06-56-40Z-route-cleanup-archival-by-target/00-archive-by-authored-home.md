# Archive by authored home

`jarvis cleanup` resolves the source spec under a single configured `targetDir` and computes the
destination as `<targetDir>/completed/<name>` (`v1/src/commands/cleanup.ts`). After the route-by-target
config flip (`targetDir: v1/spec`), v2 specs authored under `v2/spec/` are never located, and any spec
found is archived into the configured home regardless of where it lives. Route archival by the spec's
authored home instead.

## Decisions

- Routing signal = the spec's authored home (declared target), the same signal route-by-target authoring uses — not git-diff classification of the merged implementation. Rules out reconstructing the merged change's diff to classify v1/v2, which is fragile and redundant when specs already live in their target home.
- Destination derives from the home where the source spec is located, not the configured `targetDir`. Rules out keeping `<targetDir>/completed` (the current mis-routing bug).
- Cleanup probes candidate homes `v1/spec` and `v2/spec` in addition to the configured `targetDir`; first match wins. Rules out searching only the single configured `targetDir`, which misses `v2/spec` specs once `targetDir` is `v1/spec`.
- Mixed v1/v2 → `v1/spec/completed/` is satisfied transitively: route-by-target authored mixed specs under `v1/spec/`, so locating the source there routes correctly. Rules out re-deriving a mixed classification at cleanup time.
- Default-`spec` projects are unchanged: `v1/spec`/`v2/spec` are absent, so resolution falls back to the configured `targetDir`. Rules out imposing the jarvis route-by-target homes on other projects.
- Deferred to first consumer: a configurable candidate-home list — pin when another project adopts route-by-target.

## Task checklist

- [ ] Locate the source spec across candidate homes (configured `targetDir`, `v1/spec`, `v2/spec`); derive `completed/` destination from the matched home.
- [ ] Preserve existing guards (reserved `completed` name, missing source, destination collision) and default-`spec` behavior.
- [ ] Cover the new routing in `v1/test/cleanup-command.sandbox-unrunnable.test.ts`.
- [ ] Update docs (below).

## Acceptance criteria

- [ ] A completed spec located under `v1/spec/<name>` archives to `v1/spec/completed/<name>`.
- [ ] A completed spec located under `v2/spec/<name>` archives to `v2/spec/completed/<name>`, even when the configured `targetDir` is `v1/spec`.
- [ ] The archive destination is derived from the home where the source spec is located, not from the configured `targetDir`.
- [ ] In a project whose `targetDir` is the default `spec` (no `v1/spec`/`v2/spec` present), archival still targets `spec/completed/<name>` — existing `cleanup-command.sandbox-unrunnable.test.ts` archival tests stay green (behavior unchanged for that layout).
- [ ] The reserved-`completed`, missing-source, and destination-collision guards in `cleanup-command.sandbox-unrunnable.test.ts` stay green (behavior preserved).
- [ ] `operator-runbook.md` no longer instructs the operator to hand-relocate v1-work specs out of `v2/spec/completed/`.
- [ ] `v2/docs/v1-behaviors.md` records that `cleanup` archives a completed spec into the `completed/` directory of the spec's own home.

## Documentation updates

- `v1/docs/operator-runbook.md`: drop the End-of-session cleanup relocation step and the "known harness gap" callout; state that `cleanup` archives each spec to its matching `vN/spec/completed/` home. Update the observer-responsibilities mention that references relocating specs.
- `v2/docs/v1-behaviors.md`: update the `cleanup` entry to record by-home archival routing (destination = the located spec's `completed/`).
