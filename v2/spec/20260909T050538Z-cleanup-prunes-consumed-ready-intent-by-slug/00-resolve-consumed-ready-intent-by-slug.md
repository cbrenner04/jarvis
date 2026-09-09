# 00 - Resolve the consumed ready-intent by slug and bytes

## Problem

Two copies of the same join — `cleanup.ts` `provenIntentPrune` (preview) and `cleanup-artifacts.ts` `archiveCompletedSpec` (apply) — build the path `ready-intents/${spec.name}.md` under the spec home. Spec directories carry a UTC timestamp prefix (`plan.specTimestamp`), ready-intents do not, so the path never exists and `intentPruned` is always false on real archives. The existing tests pass only because their fixtures name the ready-intent after the timestamped directory.

## Decisions

- One resolver, `resolveConsumedReadyIntent(spec, fs)` in `cleanup-artifacts.ts`, is the only place the join lives; both preview and apply call it; rules out two drifting copies.
- Candidate order: `ready-intents/<slug>.md` where `slug` is `spec.name` with a leading `^\d{8}T\d{6}Z-` stripped, then `ready-intents/<spec.name>.md` for unstamped directories; the resolver returns the first candidate whose bytes equal `<spec.source>/intent.md`, else nothing; rules out a filename-only match that could delete an unrelated queue file and rules out a content-only scan of the whole queue.
- External plan artifacts stay out of prune scope, as today.

## Tasks

- Add the resolver and use it from `provenIntentPrune` and `archiveCompletedSpec`.
- Add fixtures with a timestamped spec directory and a slug-named ready-intent to `cleanup-artifacts.test.ts` and the end-to-end `cleanup.test.ts` archive path.

## Acceptance criteria

- [ ] `cleanup-artifacts.test.ts` test `archiveCompletedSpec prunes a slug-named ready-intent for a timestamped spec directory` proves a `20260909T000000Z-example` spec whose `intent.md` byte-matches `ready-intents/example.md` archives with `intentPruned: true` and the queue file gone; it fails against the current `${spec.name}.md` lookup.
- [ ] `cleanup-artifacts.test.ts` test `archiveCompletedSpec leaves a slug-named ready-intent whose bytes differ` proves a differing `ready-intents/example.md` survives with `intentPruned: false`.
- [ ] `cleanup.test.ts` test `dry-run previews and apply prunes the slug-named consumed ready-intent` proves `--dry-run` prints `(prune consumed ready-intent)` and apply prints `(pruned consumed ready-intent)` for a timestamped spec with a slug-named queue file; it fails against the current preview join.
- [ ] Existing unstamped-fixture prune tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the byte-match prune resolves the slug-named ready-intent for timestamped spec directories.
- `v2/docs/v1-behaviors.md` — record the resolver.
