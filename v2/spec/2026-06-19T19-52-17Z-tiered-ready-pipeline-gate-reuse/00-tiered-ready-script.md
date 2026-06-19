# Tiered ready script

`bun run ready` always runs the full pipeline; install runs even when lockfile and
`node_modules` are unchanged.

## Decisions

- Two named tiers in `scripts/ready.ts` — `fast` (`typecheck` → `test`) and `full` (`install` when digest changed → `check:fix` → `typecheck` → `test` → `check`); rules out per-caller ad-hoc step lists elsewhere.
- Operator `bun run ready` (no tier override) runs `full`; rules out changing the default operator entrypoint to `fast`.
- Tier override uses one harness→subprocess transport: `JARVIS_READY_TIER=fast|full` env var, parsed only in `scripts/ready.ts`; harness sets it when spawning `bun run ready`; rules out per-gate argv wiring or duplicate tier lists in `ready-gate.ts`.
- Install skip in `full` when a recomputed digest matches the digest recorded after the last successful install in this repo checkout; rules out always running `bun install --frozen-lockfile`.
- Digest inputs: SHA-256 of root `bun.lock` bytes plus SHA-256 of sorted `name@version` strings from each top-level `node_modules/<pkg>/package.json`; rules out lockfile-only comparison and rules out mtime/size heuristics.
- Force install when `node_modules` is absent, `bun.lock` bytes changed since last recorded digest, or lockfile bytes unchanged but the recomputed `node_modules` identity digest mismatches the recorded value; rules out skipping install on stale, partial, or absent trees.
- Deferred to first consumer: on-disk digest marker path/format — pin when harness tests need a stable contract beyond skip-vs-run behavior.

## Tasks

- [ ] Own `fast` and `full` step lists solely in `scripts/ready.ts`; harness invokes via subprocess only.
- [ ] Parse `JARVIS_READY_TIER` in `scripts/ready.ts`; default `full` when unset or invalid.
- [ ] Implement install digest compare-and-skip in the `full` tier.
- [ ] Add regression tests for tier step sets, install skip/run triggers, and force-install cases.
- [ ] Update ready-script regression that pins install-before-check:fix order to apply to the `full` tier only.

## Acceptance criteria

- [ ] `full` tier runs `check:fix`, `typecheck`, `test`, and `check` in order after any required install; `fast` tier runs only `typecheck` then `test`.
- [ ] `full` tier skips `bun install --frozen-lockfile` when the recomputed digest matches the last successful install digest in the checkout.
- [ ] `full` tier runs install when `node_modules` is absent, when `bun.lock` changed since the last recorded digest, or when lockfile is unchanged but the `node_modules` identity digest mismatches the recorded value.
- [ ] `bun run ready` with no `JARVIS_READY_TIER` executes the `full` tier.
- [ ] Harness subprocess sets `JARVIS_READY_TIER` to the requested tier; `scripts/ready.ts` is the sole parser.
- [ ] Regression tests in `v1/test/ready-script.test.ts` (or colocated `scripts/ready.test.ts`) prove tier step sets and install skip/run/force without invoking the full harness.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- [ ] `v1/docs/run-loop.md`: `bun run ready` is the `full` tier; `fast` vs `full` step definitions; install digest skip inputs and force-install triggers. Cross-link gate tier selection to subspec `01` (do not duplicate gate matrix here).

## Out of scope

- Harness gate tier selection (`01`).
- `v2/docs/v1-behaviors.md` gate-tier bullets (`01` owns parity rewrites).
- Changing what `check:fix` or `check` cover.
- Plan-mode ready transition tier policy (stays default `full` until a caller pins it).
