# Verdict

The spec's core direction and the before-base-ref ordering decision are sound. The following refinements are required before it lands. They are mostly decision-record gaps — load-bearing choices an implementer would otherwise guess wrong — plus one real semantic limitation the record never names.

## Must address

1. **Record the regression-masking limitation and the ordering's cost.** An update-snapshots pass blesses whatever the current output is, so a snapshot that fails *because the agent broke the output* goes green after the update exactly like a genuinely stale one — the gate then rejects the blocker and 01's WIP flow absorbs the now-wrong snapshot. Because this gate runs *before* base-ref validation and short-circuits it, a snapshot-shaped regression also skips the base-ref regression check entirely. The two gates are presented as equivalent "rejections" but leave materially different trees (base-ref leaves the tree untouched; the snapshot gate rewrites files). The spec must either (a) add a decision entry naming this risk and explicitly accepting it (rationale: single operator, snapshots ride reviewable WIP commits, and the status-quo alternative — halting on stale snapshots — is the bug under repair), or (b) adopt and record a design that still consults base-ref before accepting a churn reject. Silence is the problem; the intent's stated goal is to "distinguish outdated snapshots from real failures," and the gate cannot currently distinguish stale from agent-broken output — that gap must be on the record.

2. **Pin the `gitEnabled` behavior for the new gate.** The base-ref gate is git-guarded; the snapshot gate (mutate files → re-test → strip section → continue, no commit) does not need git. Whether it fires in a non-git run is a genuine behavioral difference from base-ref and must be stated explicitly as a decision.

3. **Specify the shared-counter reset/path-tracking on reject.** The spec reuses the base-ref gate's per-subspec rejection counter but only says "increment." The base-ref path first sets the subspec-path field (resetting the counter when the active subspec changed) and then increments. The snapshot reject path must mirror that reset-then-increment sequence, or the shared counter goes stale across subspecs. Pin it.

4. **Mirror the `state.iteration` increment on the continue/reject path.** The reused base-ref continue path increments the iteration before returning `continue`. The checklist says "continue the loop" but omits this. State that the snapshot reject path mirrors the same continue semantics.

5. **(01) Define a deterministic detection tie-break.** "Reads the test script and devDependencies and maps the known runner" is ambiguous when signals conflict (e.g. a Bun repo with `vitest` in devDeps, or a `vitest run` script with `jest` also present). This directly determines which `-u` flag fires, and a wrong flag yields false greens or errors. Pin a deterministic precedence (e.g. the test-script command string is authoritative; devDependencies only as fallback).

## Should address (cheap clarity)

6. **(01) Acknowledge the update/re-test scope divergence.** The update pass runs the raw runner (e.g. `bun test --update-snapshots`) while the re-test runs the package script `bun run test`, which may carry different scope/preload/flags. The decision records why `bun run test -- -u` was rejected but not the cost of the chosen split — an under-scoped update could produce a green re-test. Name the risk (the fail-safe limits but does not eliminate it).

7. **State the mixed-failure layering as an intended property.** Stale-snapshot + real-failure together → update pass → re-test still red → seam returns false → fall through to base-ref. Recording this prevents a reader from assuming the gate is all-or-nothing.

## Optional

8. **(01) One sentence that workspace/delegating test scripts (turbo/nx) that don't map to a known runner are unresolved → gate skips → fall through.** Behavior is already correct; only the statement is missing.

## No action

- The `snapshot-churn` telemetry value does **not** require a type change — `exitReason` is already typed as a plain string, so adding a new string value is not a union edit. No refinement needed here.

Rationale: these are the kind of implicit, load-bearing details (counter reset, iteration increment, git guard, detection tie-break) that produce subtle bugs when left unstated, and the regression-masking limitation is a real semantic cost the decision ledger must name rather than omit — per the principle that load-bearing decisions and known limitations belong in the record, not in the implementer's guesswork.