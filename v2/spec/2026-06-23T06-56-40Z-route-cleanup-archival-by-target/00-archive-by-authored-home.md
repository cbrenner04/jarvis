# Archive by authored home

`jarvis cleanup` resolves the source spec under a single configured `targetDir` (exact-name match, then
a timestamp-prefix scan of that home for `<targetDir>/<timestamp>-<name>/` off branch `plan/<name>`) and
computes the destination as `<matched home>/completed/<name>` (`v1/src/commands/cleanup.ts`). After the
route-by-target config flip (`targetDir: v1/spec`), v2 specs authored under `v2/spec/` are never located,
and any spec found is archived into the configured home regardless of where it lives. Route archival by
the spec's authored home instead.

## Decisions

- Routing signal = the spec's authored home (declared target), the same signal route-by-target authoring uses — not git-diff classification of the merged implementation. Rules out reconstructing the merged change's diff to classify v1/v2, which is fragile and redundant when specs already live in their target home.
- Destination derives from the home where the source spec is located, not the configured `targetDir`. Rules out keeping `<targetDir>/completed` (the current mis-routing bug).
- Cleanup probes candidate homes `v1/spec` and `v2/spec` in addition to the configured `targetDir`; first match wins. Rules out searching only the single configured `targetDir`, which misses `v2/spec` specs once `targetDir` is `v1/spec`.
- Each home is resolved fully (exact-name, then timestamp-prefix scan) before advancing to the next; homes iterate in configured-`targetDir`, then `v1/spec`, then `v2/spec` order. Rules out interleaving the two-tier resolution across homes, which would make a name present in more than one home resolve ambiguously and break the v1-favoring/mixed→v1 guarantee.
- Mixed v1/v2 → `v1/spec/completed/` is satisfied transitively: route-by-target authored mixed specs under `v1/spec/`, so locating the source there routes correctly. Rules out re-deriving a mixed classification at cleanup time.
- No-match behavior unchanged: when no candidate home resolves the spec, the existing missing-source error fires naming the configured-`targetDir` path. Rules out a new error shape or naming a probe path the operator never configured.
- Default-`spec` projects: `v1/spec`/`v2/spec` are normally absent, so resolution falls back to the configured `targetDir`. The hardcoded probes are a new behavior change for non-jarvis projects — a target repo with a coincidental `v1/spec/` holding a name-matching spec dir would be probed and mis-routed. Accepted under single-operator scope; rules out gating the probes to the jarvis project (heavier, unjustified here).
- Deferred to first consumer: a configurable candidate-home list — pin when another project adopts route-by-target.

## Task checklist

- [ ] Locate the source spec across candidate homes — each resolved fully (exact-name, then timestamp-prefix scan) in configured-`targetDir`, `v1/spec`, `v2/spec` order; derive `completed/` destination from the matched home.
- [ ] Preserve existing guards (reserved `completed` name, missing source naming the configured `targetDir`, destination collision) and default-`spec` behavior.
- [ ] Cover the new routing in `v1/test/cleanup-command.sandbox-unrunnable.test.ts` — add a cross-home case: a **timestamped** v2 spec (`v2/spec/<timestamp>-<name>/`) archiving to `v2/spec/completed/<name>` while configured `targetDir` is `v1/spec`.
- [ ] Update docs (below).

## Acceptance criteria

- [ ] A completed spec located under `v1/spec/<name>` archives to `v1/spec/completed/<name>`.
- [ ] A completed spec located under `v2/spec/<name>` archives to `v2/spec/completed/<name>`, even when the configured `targetDir` is `v1/spec`.
- [ ] A new `cleanup-command.sandbox-unrunnable.test.ts` case pinning a **timestamped** v2 spec (`v2/spec/<timestamp>-<name>/`) archiving to `v2/spec/completed/<name>` while configured `targetDir` is `v1/spec` passes (the real archival path resolves via timestamp-prefix scan, not exact-name match).
- [ ] The archive destination is derived from the home where the source spec is located, not from the configured `targetDir`.
- [ ] In a project whose `targetDir` is the default `spec` (no `v1/spec`/`v2/spec` present), archival still targets `spec/completed/<name>` — existing `cleanup-command.sandbox-unrunnable.test.ts` archival tests stay green (behavior unchanged for that layout).
- [ ] A default-`spec` project with a coincidental `v1/spec/` directory holding a name-matching spec dir is not mis-routed into `v1/spec/completed/` — its spec archives under the configured `targetDir`.
- [ ] When no candidate home resolves the spec, the missing-source error fires naming the configured-`targetDir` path (no new error shape) — the relevant `cleanup-command.sandbox-unrunnable.test.ts` guard stays green.
- [ ] The reserved-`completed` and destination-collision guards in `cleanup-command.sandbox-unrunnable.test.ts` stay green (behavior preserved).
- [ ] `operator-runbook.md` no longer instructs the operator to hand-relocate v1-work specs out of `v2/spec/completed/`.
- [ ] `v2/docs/v1-behaviors.md` records that `cleanup` archives a completed spec into the `completed/` directory of the spec's own home.

## Documentation updates

- `v1/docs/operator-runbook.md`: drop the End-of-session cleanup relocation step and the "known harness gap" callout; state that `cleanup` archives each spec to its matching `vN/spec/completed/` home. Note that a transitional spec authored under the old plain-`spec/` layout (pre-flip) falls outside the probe set and is archived manually — migration of accumulated specs is out of scope. Update the observer-responsibilities mention that references relocating specs.
- `v2/docs/v1-behaviors.md`: add a `cleanup` bullet recording by-home archival routing (destination = the located spec's `completed/`), ending with the catalog-mandated `Sources:` citation (`v1/src/commands/cleanup.ts`).
