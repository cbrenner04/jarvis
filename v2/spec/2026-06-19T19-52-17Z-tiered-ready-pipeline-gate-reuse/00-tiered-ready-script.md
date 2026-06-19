# Tiered ready script

`bun run ready` always runs the full pipeline; install runs even when lockfile and
`node_modules` are unchanged.

## Decisions

- Two named tiers in `scripts/ready.ts` — `fast` (`typecheck` → `test`) and `full` (`install` when digest changed → `check:fix` → `typecheck` → `test` → `check`); rules out per-caller ad-hoc step lists elsewhere.
- Operator `bun run ready` (no tier override) runs `full`; rules out changing the default operator entrypoint to `fast`.
- Install skip in `full` when a recomputed digest of lockfile + `node_modules` matches the digest recorded after the last successful install in this repo checkout; rules out always running `bun install --frozen-lockfile`.
- Digest inputs are root `bun.lock` content and `node_modules` install-relevant state; rules out lockfile-only comparison.
- Missing `node_modules` or a lockfile change forces install; rules out skipping install on a stale or absent tree.
- Tier override travels through the existing `runReady` subprocess seam (env or argv parsed only in `scripts/ready.ts`); rules out duplicating tier step lists in `ready-gate.ts`.
- Deferred to first consumer: on-disk digest marker path/format — pin when harness tests need a stable contract beyond skip-vs-run behavior.

## Tasks

- [ ] Export tiered `runReady` (or equivalent) with `fast` and `full` step lists owned solely in `scripts/ready.ts`.
- [ ] Implement install digest compare-and-skip in the `full` tier.
- [ ] Parse tier override from the subprocess seam; default `full` when unset.
- [ ] Add regression tests for tier step sets and install skip/run triggers.
- [ ] Update ready-script regression that pins install-before-check:fix order to apply to the `full` tier only.

## Acceptance criteria

- [ ] `full` tier runs `check:fix`, `typecheck`, `test`, and `check` in order after any required install; `fast` tier runs only `typecheck` then `test`.
- [ ] `full` tier skips `bun install --frozen-lockfile` when lockfile and `node_modules` digest are unchanged since the last successful install in the checkout; a lockfile change runs install.
- [ ] `bun run ready` with no tier override executes the `full` tier.
- [ ] Regression tests in `v1/test/ready-script.test.ts` (or colocated `scripts/ready.test.ts`) prove tier step sets and install skip/run without invoking the full harness.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- [ ] `v1/docs/run-loop.md` notes that `bun run ready` is the `full` tier and that install may skip when the lockfile/`node_modules` digest is unchanged.

## Out of scope

- Harness gate tier selection (`01`).
- Changing what `check:fix` or `check` cover.
- Plan-mode ready transition tier policy (stays default `full` until a caller pins it).
