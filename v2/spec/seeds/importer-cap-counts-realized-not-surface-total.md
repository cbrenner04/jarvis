# Importer-discovery cap counts surface-total test files, self-bricking every guard once a surface exceeds 200 test files

## Problem

`resolveKillingTests` (`v2/src/execution/diff-derived-mutation-verifier.ts`, shipped in the resolve-importing-killing-tests spec) discovers direct-importer killing tests by scanning **all** `*.test.ts` files under a changed module's surface-prefix scan root (`v1/src/`, `v2/src/`, `shared/`) and fails closed as `importer-discovery-cap-exceeded` when it would inspect a 201st candidate — **before** it can confirm the co-located tests the guard already has. The cap counts *inspected surface candidates*, not *realized importers*, so once a surface's total `*.test.ts` count crosses `MAX_IMPORTER_DISCOVERY_CANDIDATES_PER_FILE` (200), **every** changed guard in that surface blocks with `importer-discovery-cap-exceeded` — including guards with perfect co-located coverage. This bricks the whole surface's mutation gate as the repo grows.

## Evidence (2026-08-30)

Independent review of the resolve-importing implement (#3195): "the cap being keyed to surface-total rather than realized-importers means the gate self-bricks the whole v2/src surface as the repo grows." Counts at review time: **v2/src at 144 test files (~56 headroom to 200)**; shared at 30. The spec's own AC codifies the behavior (`returns importer-discovery-cap-exceeded without scoped execution when co-located coverage exists`), so it is spec-faithful — the design, not the implementation, is the landmine. Safe today; actively harmful within ~56 new v2/src test files.

## Decisions

- Skip importer discovery entirely for a candidate whose co-located resolution (exact-stem + sibling) is already non-empty — a covered guard never scans importers, so it can never hit the cap. This preserves cost-bounding (no scan when unneeded) and removes the surface-wide self-brick. Rules out always-union-then-cap.
- If importer discovery must run for an uncovered guard, bound cost by realized-importer count or a time budget rather than surface-total inspected candidates, OR raise/relativize the cap — but the skip-when-covered rule above is the primary fix and makes the cap rarely reached. Rules out merely bumping the constant (only defers the brick).
- Update the spec ACs that pin "importer discovery always runs even when co-located coverage exists" and "cap limits inspected candidates" — those two clauses are the landmine's source and must change together.

## Acceptance criteria

- [ ] A verifier test proves a changed guard WITH co-located (exact-stem or sibling) coverage does NOT trigger importer discovery and never returns `importer-discovery-cap-exceeded`, even when its surface holds >200 `*.test.ts` files; it fails against the always-union-then-cap resolver.
- [ ] A verifier test proves an UNCOVERED changed guard still resolves direct-importer tests and still fails closed (`missing-killing-test` for empty, or a bounded cap outcome) — importer discovery is preserved for the case it exists for.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` / `v2/docs/v1-behaviors.md` — importer discovery runs only when co-located coverage is absent; the cap no longer blocks covered guards.

## Sequencing

P1 mutation-gate. Latent today (v2/src ~144/200) but a hard surface-wide gate failure once crossed. Builds on the shipped resolve-importing spec; a focused follow-up, not a rewrite.
